import net from "node:net";
import config from "$config";
import { btcNetwork } from "$lib/esplora";
import { err, l, warn } from "$lib/logging";
import { processWatchedTx } from "$lib/payments";
import { Transaction } from "@scure/btc-signer";
import { concatBytes, sha256x2 } from "@scure/btc-signer/utils.js";
import { bytesToHex } from "@noble/hashes/utils";

const zmqHost = config.bitcoin.host || "127.0.0.1";
const zmqRawTxPort = config.bitcoin.zmq?.rawtx || 18507;
const zmqRawBlockPort = config.bitcoin.zmq?.rawblock || 18506;
const RAWTX_URL = `tcp://${zmqHost}:${zmqRawTxPort}`;
const RAWBLOCK_URL = `tcp://${zmqHost}:${zmqRawBlockPort}`;

const TX_OPTS = {
  allowUnknownOutputs: true,
  allowUnknownInputs: true,
  disableScriptCheck: true,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

const reverseHex = (buf: Uint8Array) =>
  bytesToHex(Uint8Array.from(buf).reverse());

const readVarInt = (data: Uint8Array, offset: number) => {
  const first = data[offset];
  if (first < 0xfd) return { value: first, size: 1 };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (first === 0xfd)
    return { value: view.getUint16(offset + 1, true), size: 3 };
  if (first === 0xfe)
    return { value: view.getUint32(offset + 1, true), size: 5 };
  return { value: Number(view.getBigUint64(offset + 1, true)), size: 9 };
};

const rawTxSize = (buf: Uint8Array, start: number) => {
  let offset = start;
  offset += 4; // version

  const marker = buf[offset];
  const flag = buf[offset + 1];
  const segwit = marker === 0x00 && flag !== 0x00;
  if (segwit) offset += 2;

  const vinVar = readVarInt(buf, offset);
  offset += vinVar.size;
  for (let i = 0; i < vinVar.value; i++) {
    offset += 36; // prev_hash(32) + prev_index(4)
    const scriptLen = readVarInt(buf, offset);
    offset += scriptLen.size + scriptLen.value + 4; // script + sequence
  }

  const voutVar = readVarInt(buf, offset);
  offset += voutVar.size;
  for (let i = 0; i < voutVar.value; i++) {
    offset += 8; // value
    const scriptLen = readVarInt(buf, offset);
    offset += scriptLen.size + scriptLen.value;
  }

  if (segwit) {
    for (let i = 0; i < vinVar.value; i++) {
      const itemCount = readVarInt(buf, offset);
      offset += itemCount.size;
      for (let j = 0; j < itemCount.value; j++) {
        const itemLen = readVarInt(buf, offset);
        offset += itemLen.size + itemLen.value;
      }
    }
  }

  offset += 4; // locktime
  return offset - start;
};

const decodeTx = (raw: Uint8Array, confirmed: boolean) => {
  const tx = Transaction.fromRaw(raw, TX_OPTS);
  const vout = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const { amount } = tx.getOutput(i);
    vout.push({
      scriptpubkey_address: tx.getOutputAddress(i, btcNetwork),
      value: Number(amount),
    });
  }
  return { txid: tx.id, vout, status: { confirmed } };
};

const handleRawTx = async (raw: Uint8Array) => {
  await processWatchedTx(decodeTx(raw, false));
};

const handleRawBlock = async (raw: Uint8Array) => {
  const blockHash = reverseHex(sha256x2(raw.subarray(0, 80)));
  l("zmq block", blockHash);

  let offset = 80;
  const txCount = readVarInt(raw, offset);
  offset += txCount.size;

  for (let i = 0; i < txCount.value; i++) {
    const size = rawTxSize(raw, offset);
    const txRaw = raw.subarray(offset, offset + size);
    offset += size;
    try {
      await processWatchedTx(decodeTx(txRaw, true));
    } catch (e) {
      warn("zmq block tx decode failed", i, e.message);
    }
  }
};

// ZMTP 3.0 NULL protocol

const greeting = () => {
  const buf = new Uint8Array(64);
  buf[0] = 0xff;
  buf[9] = 0x7f;
  buf[10] = 3; // major
  buf[11] = 0; // minor
  buf.set(enc.encode("NULL"), 12);
  return buf;
};

const frame = (flags: number, body: Uint8Array) => {
  if (body.length <= 0xff) {
    const b = new Uint8Array(2 + body.length);
    b[0] = flags;
    b[1] = body.length;
    b.set(body, 2);
    return b;
  }

  const b = new Uint8Array(9 + body.length);
  b[0] = flags | 0x02;
  new DataView(b.buffer).setBigUint64(1, BigInt(body.length));
  b.set(body, 9);
  return b;
};

const command = (name: string, props: Record<string, string> = {}) => {
  const parts: Uint8Array[] = [
    Uint8Array.of(name.length),
    enc.encode(name),
  ];
  for (const [k, v] of Object.entries(props)) {
    const kb = enc.encode(k);
    const vb = enc.encode(v);
    parts.push(Uint8Array.of(kb.length), kb);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, vb.length);
    parts.push(len, vb);
  }
  return frame(0x04, concatBytes(...parts));
};

const subscribeCommand = (topic: string) => {
  const t = enc.encode(topic);
  return frame(
    0x04,
    concatBytes(
      Uint8Array.of(9),
      enc.encode("SUBSCRIBE"),
      Uint8Array.of(t.length),
      t,
    ),
  );
};

const legacySubscribe = (topic: string) =>
  frame(0x00, concatBytes(Uint8Array.of(1), enc.encode(topic)));

const startSub = (
  url: string,
  topic: string,
  onMessage: (b: Uint8Array) => void,
) =>
  new Promise<void>((resolve) => {
    const [host, port] = url.replace("tcp://", "").split(":");
    const socket = net.connect({ host, port: Number(port) });

    let buffer = new Uint8Array(0);
    let handshakeDone = false;
    let frames: Uint8Array[] = [];
    let closed = false;

    const processBuffer = async () => {
      if (!handshakeDone) {
        if (buffer.length < 64) return;
        buffer = buffer.slice(64);
        handshakeDone = true;
        socket.write(command("READY", { "Socket-Type": "SUB" }));
        socket.write(subscribeCommand(topic));
        socket.write(legacySubscribe(topic));
        l("zmq subscribed", topic, url);
      }

      while (buffer.length >= 2) {
        const flags = buffer[0];
        let size: number;
        let header: number;
        if (flags & 0x02) {
          if (buffer.length < 9) return;
          const view = new DataView(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength,
          );
          size = Number(view.getBigUint64(1));
          header = 9;
        } else {
          size = buffer[1];
          header = 2;
        }

        if (buffer.length < header + size) return;
        const body = buffer.slice(header, header + size);
        buffer = buffer.slice(header + size);

        if (flags & 0x04) continue;
        frames.push(body);
        if (flags & 0x01) continue;

        if (frames.length >= 2 && dec.decode(frames[0]) === topic) {
          onMessage(frames[1]);
        }
        frames = [];
      }
    };

    socket.on("connect", () => socket.write(greeting()));
    socket.on("data", (d: Uint8Array) => {
      buffer = concatBytes(buffer, d);
      processBuffer().catch((e) => err("zmq parse error", e.message));
    });
    socket.on("error", (e) => {
      if (closed) return;
      closed = true;
      warn("zmq socket error", e.message);
      resolve();
    });
    socket.on("close", () => {
      if (closed) return;
      closed = true;
      warn("zmq socket closed", url);
      resolve();
    });
  });

export const startZmq = async () => {
  if (process.env.DISABLE_ZMQ === "1") return;
  l("zmq connecting", RAWTX_URL, RAWBLOCK_URL);

  const retry = async (
    url: string,
    topic: string,
    handler: (b: Uint8Array) => Promise<void>,
  ) => {
    let delay = 1000;
    const maxDelay = 30000;
    while (true) {
      await startSub(url, topic, (raw) =>
        handler(raw).catch((e) => warn(`${topic} error`, e.message)),
      );
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(maxDelay, Math.floor(delay * 1.5));
    }
  };

  retry(RAWTX_URL, "rawtx", handleRawTx).catch(() => {});
  retry(RAWBLOCK_URL, "rawblock", handleRawBlock).catch(() => {});
};
