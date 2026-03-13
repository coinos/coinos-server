import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource as any;

import config from "$config";
import {
  SingleKey,
  RestArkProvider,
  Batch,
  Transaction,
  CSVMultisigTapscript,
  validateVtxoTxGraph,
  TxTree,
} from "@arkade-os/sdk";
import type {
  BatchStartedEvent,
  TreeSigningStartedEvent,
  TreeNoncesEvent,
  BatchFinalizationEvent,
  SignerSession,
} from "@arkade-os/sdk";
import { hex, base64 } from "@scure/base";
import { db } from "$lib/db";
import { l, warn } from "$lib/logging";
import { getArkAddress } from "$lib/ark";
import { createHash } from "crypto";

const sha256Hash = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash("sha256").update(data).digest());

const { arkServerUrl, delegatorPrivateKey } = config.ark;

let identity: any;
let pubkey: string;
let processing = false;

const getIdentity = () => {
  if (identity) return identity;
  if (!delegatorPrivateKey) return null;
  identity = SingleKey.fromHex(delegatorPrivateKey);
  return identity;
};

const getPubkey = async () => {
  if (pubkey) return pubkey;
  const id = getIdentity();
  if (!id) throw new Error("delegator not configured");
  pubkey = hex.encode(await id.compressedPublicKey());
  return pubkey;
};

export const getDelegateInfo = async () => {
  const pk = await getPubkey();
  const delegatorAddress = await getArkAddress();
  return {
    pubkey: pk,
    fee: "0",
    delegatorAddress,
  };
};

export const receiveDelegation = async (body: any) => {
  const { intent, forfeit_txs, reject_replace } = body;
  const id = crypto.randomUUID();

  // Parse valid_at from the intent message
  let validAt = Date.now();
  try {
    const msg =
      typeof intent.message === "string"
        ? JSON.parse(intent.message)
        : intent.message;
    if (msg.valid_at) validAt = msg.valid_at * 1000;
  } catch {}

  const delegation = {
    id,
    intent,
    forfeitTxs: forfeit_txs,
    rejectReplace: reject_replace ?? false,
    status: "pending",
    createdAt: Date.now(),
    validAt,
  };

  await db.set(`delegation:${id}`, JSON.stringify(delegation));
  await db.zAdd("delegations:pending", [
    { score: delegation.validAt, value: id },
  ]);

  l(
    "delegation received:",
    id,
    "vtxos:",
    forfeit_txs?.length ?? 0,
    "valid_at:",
    new Date(validAt).toISOString(),
  );
};

export const processDelegations = async () => {
  if (processing || !delegatorPrivateKey) return;

  const now = Date.now();
  const dueRaw = await db.zRangeByScore(
    "delegations:pending",
    "-inf",
    String(now),
  );
  const dueIds = dueRaw.map(String);
  if (dueIds.length === 0) return;

  processing = true;
  try {
    for (const id of dueIds) {
      try {
        await processSingleDelegation(id);
        await db.zRem("delegations:pending", id);
      } catch (e: any) {
        warn("delegation processing failed:", id, e.message);
        const raw = await db.get(`delegation:${id}`);
        if (raw) {
          const d = JSON.parse(String(raw));
          d.retries = (d.retries || 0) + 1;
          if (d.retries > 5) {
            d.status = "failed";
            await db.set(`delegation:${id}`, JSON.stringify(d));
            await db.zRem("delegations:pending", id);
            warn("delegation permanently failed after 5 retries:", id);
          } else {
            const retryAt = Date.now() + 5 * 60_000;
            await db.set(`delegation:${id}`, JSON.stringify(d));
            await db.zAdd("delegations:pending", [
              { score: retryAt, value: id },
            ]);
          }
        }
      }
    }
  } finally {
    processing = false;
  }
};

const processSingleDelegation = async (id: string) => {
  const rawVal = await db.get(`delegation:${id}`);
  if (!rawVal) throw new Error("delegation not found");

  const delegation = JSON.parse(String(rawVal));
  const provider = new RestArkProvider(arkServerUrl);
  const delegatorId = getIdentity();

  // The intent from the client is already encoded
  const intent = {
    proof: delegation.intent.proof,
    message: delegation.intent.message,
  };

  // Register the intent with arkd
  const intentId = await provider.registerIntent(intent as any);
  l("delegation", id, "registered intent:", intentId);

  // Create a signing session for the musig2 tree co-signing
  const session = delegatorId.signerSession();
  const delegatorPk = hex.encode(await session.getPublicKey());

  // Build topics: our pubkey + input outpoints from the intent proof
  const topics = [delegatorPk];

  const abortController = new AbortController();
  // Timeout after 5 minutes
  const timeout = setTimeout(() => abortController.abort(), 5 * 60_000);

  try {
    const stream = provider.getEventStream(abortController.signal, topics);

    const handler = createDelegatorBatchHandler(
      intentId,
      delegation,
      delegatorId,
      provider,
      session,
    );

    const commitmentTxid = await Batch.join(stream, handler, {
      abortController,
      skipVtxoTreeSigning: false,
    });

    delegation.status = "completed";
    delegation.commitmentTxid = commitmentTxid;
    await db.set(`delegation:${id}`, JSON.stringify(delegation));

    l("delegation", id, "completed, commitment:", commitmentTxid);
  } finally {
    clearTimeout(timeout);
    abortController.abort();
  }
};

const tapLeafHash = (script: Uint8Array): Uint8Array => {
  const leafVersion = 0xc0;
  const data = new Uint8Array(1 + script.length);
  data[0] = leafVersion;
  data.set(script, 1);

  // Bitcoin tagged hash: SHA256(SHA256("TapLeaf") || SHA256("TapLeaf") || data)
  const tag = new TextEncoder().encode("TapLeaf");
  const tagHash = sha256Hash(tag);
  const buf = new Uint8Array(tagHash.length * 2 + data.length);
  buf.set(tagHash, 0);
  buf.set(tagHash, tagHash.length);
  buf.set(data, tagHash.length * 2);
  return sha256Hash(buf);
};

function createDelegatorBatchHandler(
  intentId: string,
  delegation: any,
  delegatorId: any,
  provider: any,
  session: SignerSession,
): Batch.Handler {
  let sweepTapTreeRoot: Uint8Array | undefined;
  let forfeitPubkey: string;

  return {
    onBatchStarted: async (
      event: BatchStartedEvent,
    ): Promise<{ skip: boolean }> => {
      const utf8IntentId = new TextEncoder().encode(intentId);
      const intentIdHash = hex.encode(sha256Hash(utf8IntentId));

      let found = false;
      for (const idHash of event.intentIdHashes) {
        if (idHash === intentIdHash) {
          await provider.confirmRegistration(intentId);
          found = true;
        }
      }

      if (!found) return { skip: true };

      // Build sweep tap tree root for validation
      const info = await provider.getInfo();
      forfeitPubkey = info.forfeitPubkey;

      const sweepTapscript = CSVMultisigTapscript.encode({
        timelock: {
          value: event.batchExpiry,
          type: event.batchExpiry >= 512n ? "seconds" : "blocks",
        },
        pubkeys: [hex.decode(forfeitPubkey)],
      }).script;
      sweepTapTreeRoot = tapLeafHash(sweepTapscript);

      return { skip: false };
    },

    onTreeSigningStarted: async (
      event: TreeSigningStartedEvent,
      vtxoTree: TxTree,
    ): Promise<{ skip: boolean }> => {
      // Check if we're a cosigner in this round
      const xOnlyPublicKeys = event.cosignersPublicKeys.map((k: string) =>
        k.slice(2),
      );
      const signerPublicKey = await session.getPublicKey();
      const xonlySignerPublicKey = signerPublicKey.subarray(1);

      if (!xOnlyPublicKeys.includes(hex.encode(xonlySignerPublicKey))) {
        return { skip: true };
      }

      if (!sweepTapTreeRoot) {
        throw new Error("sweep tap tree root not set");
      }

      // Validate the vtxo tree
      const commitmentTx = Transaction.fromPSBT(
        base64.decode(event.unsignedCommitmentTx),
      );
      validateVtxoTxGraph(vtxoTree, commitmentTx, sweepTapTreeRoot);

      const sharedOutput = commitmentTx.getOutput(0);
      if (!sharedOutput?.amount) {
        throw new Error("shared output not found");
      }

      await session.init(vtxoTree, sweepTapTreeRoot, sharedOutput.amount);

      const pk = hex.encode(await session.getPublicKey());
      const nonces = await session.getNonces();
      await provider.submitTreeNonces(event.id, pk, nonces);

      return { skip: false };
    },

    onTreeNonces: async (
      event: TreeNoncesEvent,
    ): Promise<{ fullySigned: boolean }> => {
      const { hasAllNonces } = await session.aggregatedNonces(
        event.txid,
        event.nonces,
      );
      if (!hasAllNonces) return { fullySigned: false };

      const signatures = await session.sign();
      const pk = hex.encode(await session.getPublicKey());
      await provider.submitTreeSignatures(event.id, pk, signatures);
      return { fullySigned: true };
    },

    onBatchFinalization: async (
      _event: BatchFinalizationEvent,
      _vtxoTree?: TxTree,
      connectorTree?: TxTree,
    ): Promise<void> => {
      // Co-sign the pre-signed forfeit transactions from the delegation
      const signedForfeits: string[] = [];
      const connectorsLeaves = connectorTree?.leaves() || [];
      let connectorIndex = 0;

      for (const forfeitPsbtB64 of delegation.forfeitTxs || []) {
        try {
          // Parse the user's pre-signed forfeit PSBT
          const forfeitTx = Transaction.fromPSBT(base64.decode(forfeitPsbtB64));

          // Add the connector input from the round
          if (connectorIndex < connectorsLeaves.length) {
            const connectorLeaf = connectorsLeaves[connectorIndex];
            const connectorOutput = connectorLeaf.getOutput(0);
            if (connectorOutput?.amount && connectorOutput?.script) {
              forfeitTx.addInput({
                txid: hex.decode(connectorLeaf.id),
                index: 0,
                witnessUtxo: {
                  amount: connectorOutput.amount,
                  script: connectorOutput.script,
                },
              });
            }
            connectorIndex++;
          }

          // Co-sign with the delegator's key (only the first input - the VTXO)
          const signed = await delegatorId.sign(forfeitTx, [0]);
          signedForfeits.push(base64.encode(signed.toPSBT()));
        } catch (e: any) {
          warn("failed to co-sign forfeit tx:", e.message);
        }
      }

      if (signedForfeits.length > 0) {
        await provider.submitSignedForfeitTxs(signedForfeits);
      }
    },
  };
}

// Start processing loop (integrated with existing 60s interval)
if (delegatorPrivateKey) {
  setInterval(processDelegations, 60_000);
  // Initial check after 30s
  setTimeout(processDelegations, 30_000);
  getPubkey()
    .then((pk) => l("delegator service started, pubkey:", pk))
    .catch((e) => warn("delegator service failed to start:", e.message));
}
