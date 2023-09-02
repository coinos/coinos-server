import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { fail, wait } from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import dollarsToWords from "dollars-to-words";
import got from "got";
import mqtt from "mqtt";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import EventEmitter from "events";
import crc32 from "buffer-crc32";

export const types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  pot: "pot",
  classic: "classic"
};

export let debit = async (
  hash,
  amount,
  fee = 0,
  memo,
  user,
  type = types.internal,
  id = v4()
) => {
  let ref;
  let { id: uid, currency, username } = user;

  let rate = store.rates[currency];

  let invoice = await g(`invoice:${hash}`);
  if (invoice) {
    ref = invoice.uid;

    let equivalentRate =
      invoice.rate * (store.rates[currency] / store.rates[invoice.currency]);

    if (Math.abs(invoice.rate / store.rates[invoice.currency] - 1) < 0.01) {
      rate = equivalentRate;
    } else {
      warn("rate slipped", hash, invoice.rate, equivalentRate);
    }
  }

  let tip = parseInt(invoice?.tip) || null;

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let ourfee = [types.bitcoin, types.lightning].includes(type)
    ? Math.round(amount * config.fee)
    : 0;

  await t(`balance:${uid}`, async (balance, db) => {
    await t(`credit:${type}:${uid}`, async (credit, db) => {
      let covered = Math.min(credit, ourfee) || 0;
      ourfee -= covered;

      l(
        "debiting",
        user.username,
        balance,
        amount,
        tip,
        fee,
        ourfee,
        amount + fee + ourfee + tip
      );
      if (balance < amount + tip + fee + ourfee) fail("Insufficient funds");
      await db
        .multi()
        .decrBy(`credit:${type}:${uid}`, covered)
        .decrBy(`balance:${uid}`, amount + tip + fee + ourfee)
        .exec();
    });
  });

  let p = {
    id,
    amount: -amount,
    fee,
    ourfee,
    memo,
    uid,
    confirmed: true,
    rate,
    currency,
    type,
    ref,
    tip,
    created: Date.now()
  };

  await s(`payment:${id}`, p);
  await db.lPush(`${uid}:payments`, id);

  l("sent", type, user.username, amount);
  emit(user.id, "payment", p);

  return p;
};

export let credit = async (hash, amount, memo, ref, type = types.internal) => {
  amount = parseInt(amount) || 0;

  let invoice = await g(`invoice:${hash}`);
  if (!invoice) return warn("failed to credit", hash, ", invoice not found");

  let { tip } = invoice;
  tip = parseInt(tip) || 0;

  if (!memo) ({ memo } = invoice);
  if (amount < 0 || tip < 0) fail("Invalid amount");
  if (type === types.internal) amount += tip;

  let user = await g(`user:${invoice.uid}`);

  let { id: uid, currency, username } = user;

  let rate = store.rates[currency];

  let equivalentRate =
    invoice.rate * (store.rates[currency] / store.rates[invoice.currency]);

  if (Math.abs(invoice.rate / store.rates[invoice.currency] - 1) < 0.01) {
    rate = equivalentRate;
  } else {
    warn("rate slipped", hash, invoice.rate, equivalentRate);
  }

  let p = {
    hash,
    amount: parseInt(amount - tip),
    uid,
    rate,
    currency,
    memo,
    ref,
    tip,
    type,
    confirmed: true,
    created: Date.now()
  };

  if (type === types.bitcoin) invoice.pending += amount;
  else invoice.received += amount;

  let balance = "balance";
  if (type === types.bitcoin) {
    let [txid, vout] = ref.split(":").slice(-2);
    p.id = `${txid}:${vout}`;
    p.confirmed = false;
    balance = "pending";
  } else {
    p.id = hash;
  }

  let m = await db.multi();

  if ([types.bitcoin, types.lightning].includes(type))
    m.incrBy(`credit:${type}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${hash}`, JSON.stringify(invoice))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  l("received", type, username, amount, tip);
  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  if (user.hasprinter) {
    let words = dollarsToWords(
      parseFloat(((amount * p.rate) / 100000000).toFixed(2))
    );

    const client = mqtt.connect("mqtt://ln.coinos.io", config.mqtt);
    const raw = `/app/data/uploads/${p.id}-raw.mp3`;
    const out = `/app/data/uploads/${p.id}.mp3`;
    const mimic = spawn("/mimic", [
      "-t",
      words,
      "-voice",
      "/cmu_us_axb.flitevox",
      "-o",
      raw
    ]);
    let connected;

    client.subscribe(username);

    mimic.stdout.on("end", async () => {
      await wait(() => connected);
      client.publish(username, "start");

      let n = 0;
      let t = 0;
      let sz = 480;
      let chunks = [];
      let buf = Buffer.alloc(0);

      let send = n => {
        let chunk = chunks[n];
        if (!chunk) return;

        let num = Buffer.alloc(2);
        num.writeUInt16BE(n, 0);

        let flag = Buffer.from("dddddddd", "hex");
        let checksum = crc32(chunk).reverse();

        let payload = Buffer.concat([flag, num, checksum, chunk]);
        client.publish(username, payload);
      };

      client.on("message", (topic, message) => {
        if (topic !== username) return;
        let m = message.toString();
        if (m.startsWith("missing:")) {
          let missing = m.replace("missing:", "").split(",");

          for (let n of missing) send(chunk);
          client.publish(username, `end:${n}`);
        }

      ffmpeg(raw)
        .audioBitrate(128)
        .audioFrequency(44100)
        .toFormat("mp3")
        .on("error", err => {
          console.log("Error:", err);
        })
        .stream()
        .on("data", data => {
          t += data.length;
          let i = 0;
          buf = Buffer.concat([buf, data]);

          while (i < data.length) {
            chunks[n] = data.slice(i, i + sz);
            send(n);

            n++;
            i += sz;
          }
        })
        .on("end", () => {
          client.publish(username, `end:${chunks.length}`);
        });
    });

    client.on("connect", function() {
      client.publish(
        username,
        `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`
      );
      setTimeout(() => (connected = true), 50);
    });
  });
  }

  return p;
};

export let confirm = async (address, txid, vout) => {
  let id = `payment:${txid}:${vout}`;
  let p = await g(id);
  if (!p) return db.sAdd("missed", id);
  if (p.confirmed) return;

  p.confirmed = true;
  emit(p.uid, "payment", p);

  l("confirming", txid, p.uid);

  await db
    .multi()
    .set(id, JSON.stringify(p))
    .decrBy(`pending:${p.uid}`, p.amount)
    .incrBy(`balance:${p.uid}`, p.amount)
    .exec();
};
