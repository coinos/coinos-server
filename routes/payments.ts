import config from "$config";
import api from "$lib/api";
import { getArkAddress, sendArk, verifyArkVtxo } from "$lib/ark";
import { requireAccountOwnership, requirePin } from "$lib/auth";
import { archive, db, g, gf, gfAll, s } from "$lib/db";
import { getTx } from "$lib/esplora";
import { generate } from "$lib/invoices";
import { replay } from "$lib/lightning";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import mqtt from "$lib/mqtt";
import { createCpfpChild } from "$lib/cpfp";
import {
  acquireArkLock,
  build,
  completePayment,
  createArkPayment,
  credit,
  debit,
  getUserRate,
  processWatchedTx,
  reverse,
  sendInternal,
  sendLightning,
  sendOnchain,
  syncBitcoinVault,
} from "$lib/payments";
import { emit } from "$lib/sockets";
import {
  getBalance,
  getCredit,
  getFundBalance,
  tbConfirm,
  tbCredit,
  tbFundCredit,
  tbFundDebit,
} from "$lib/tb";
import { PaymentType } from "$lib/types";
import { SATS, bail, fail, fields, getInvoice, getPayment, getUser, pick, sats } from "$lib/utils";
import rpc from "@coinos/rpc";
import got from "got";
import { v4 } from "uuid";

export default {
  async info(c) {
    return c.json(await ln.getinfo());
  },

  async create(c) {
    const body = await c.req.json();
    const user = c.get("user");

    let { amount, hash, fee, fund, memo, payreq, aid } = body;
    const balance = await getBalance(user.id);

    try {
      if (typeof amount !== "undefined") {
        amount = Number.parseInt(amount);
        if (amount < 0 || amount > SATS || Number.isNaN(amount)) fail("Invalid amount");
      }

      await requirePin({ body, user });

      let p;

      const invoice = await getInvoice(payreq || hash);
      const recipient = invoice ? await getUser(invoice.uid) : undefined;
      if (payreq) {
        if (invoice && recipient.username !== "mint") {
          if (invoice.aid === (aid || user.id)) fail("Cannot send to self");
          hash = payreq;
          if (!amount) ({ amount } = invoice);
        } else {
          p = await sendLightning({ user, pr: payreq, amount, fee, memo });
        }
      }

      if (!p) {
        if (hash) {
          if (invoice?.type === PaymentType.ark) {
            if (!amount) ({ amount } = invoice);
            if (!invoice.text) fail("Missing ark address");
            const tmpHash = v4();
            p = await debit({
              hash: tmpHash,
              amount,
              memo,
              user,
              type: PaymentType.ark,
              aid,
            });
            try {
              const txid = await sendArk(invoice.text, amount);
              p.hash = txid;
              await s(`payment:${p.id}`, p);
              await s(`payment:${txid}`, p.id);

              try {
                const vaultInfo = await g(`arkaddr:${invoice.text}`);
                if (vaultInfo) {
                  const { aid: vaultAid, uid: vaultUid } = vaultInfo;
                  const isForward = await g(`custodial-ark-invoice:${invoice.text}`);
                  const vaultOwner = await g(`user:${vaultUid}`);
                  const { rate: vRate, currency: vCurrency } = await getUserRate(
                    vaultOwner || user,
                  );
                  const vp = await createArkPayment({
                    aid: vaultAid,
                    uid: vaultUid,
                    amount,
                    hash: txid,
                    rate: vRate,
                    currency: vCurrency,
                    extraHashMappings: [txid],
                  });
                  if (!isForward) {
                    l("ark invoice: instant vault credit", vaultAid, txid);
                    emit(vaultUid, "payment", vp);
                  }
                }
              } catch (e) {
                warn("ark invoice: instant vault notification failed", e.message);
              }
            } catch (e) {
              await reverse(p);
              throw e;
            }
          } else {
            const recipientAccount = invoice?.aid ? await g(`account:${invoice.aid}`) : null;
            if (recipientAccount?.pubkey || recipientAccount?.seed) {
              p = await sendOnchain({
                amount: amount || invoice.amount,
                address: invoice.hash,
                user,
              });
            } else {
              p = await sendInternal({
                invoice,
                amount,
                memo,
                recipient,
                sender: user,
              });
            }
          }
        } else if (fund) {
          p = await debit({
            hash: v4(),
            amount,
            memo: fund,
            user,
            type: PaymentType.fund,
          });
          await tbFundCredit(fund, amount);
          await db.lPush(`fund:${fund}:payments`, p.id);
          await db.sAdd(`user:${user.id}:funds`, fund);
          l("funded fund", fund);
        }
      }

      return c.json(p);
    } catch (e) {
      warn(user.username, "payment failed", amount, balance, hash, payreq);
      err(e.message);
      return bail(c, e.message);
    }
  },

  async list(c) {
    const user = c.get("user");
    let { id } = user;
    let aid = c.req.query("aid");
    const start = c.req.query("start");
    const end = c.req.query("end");
    let limit = c.req.query("limit");
    let offset = c.req.query("offset");
    const received = c.req.query("received");

    if (!aid || aid === "undefined") aid = id;

    const index = await db.lPos(`${id}:accounts`, aid);
    if (index === null) fail("unauthorized");

    limit = Number.parseInt(limit);
    offset = Number.parseInt(offset) || 0;

    const range = !limit || received || start || end ? -1 : limit - 1;
    const listKey = `${aid || id}:payments`;
    let payments = (await db.lRange(listKey, 0, range)) || [];

    if (range === -1) {
      const archived = (await archive.lRange(listKey, 0, -1)) || [];
      payments = [...new Set([...payments, ...archived])];
    } else if (limit) {
      const needed = Math.max(0, limit + offset - payments.length);
      if (needed > 0) {
        const archived = (await archive.lRange(listKey, 0, limit + offset - 1)) || [];
        payments = [...new Set([...payments, ...archived])];
      }
    }

    const paymentKeys = payments.map((pid) => `payment:${pid}`);
    const fetched = await gfAll(paymentKeys);

    const missingIds: any[] = [];
    const validPayments: any[] = [];

    for (let i = 0; i < fetched.length; i++) {
      const p = fetched[i];
      if (!p) {
        warn("user", id, "missing payment", payments[i]);
        missingIds.push(payments[i]);
        continue;
      }
      if (received && p.amount < 0) continue;
      if (p.created < start || p.created > end) continue;
      validPayments.push(p);
    }

    if (missingIds.length) {
      for (const pid of missingIds) await db.lRem(listKey, 0, pid);
    }

    const internalRefs = [...new Set(
      validPayments
        .filter((p) => p.type === PaymentType.internal && p.ref)
        .map((p) => p.ref),
    )];

    if (internalRefs.length) {
      const userKeys = internalRefs.map((ref) => `user:${ref}`);
      const users = await gfAll(userKeys);
      const userMap = new Map<string, any>();
      for (let i = 0; i < internalRefs.length; i++) {
        let u = users[i];
        if (typeof u === "string") u = await g(`user:${u}`);
        if (u) userMap.set(internalRefs[i], fields ? pick(u, fields) : u);
      }
      for (const p of validPayments) {
        if (p.type === PaymentType.internal && p.ref) p.with = userMap.get(p.ref);
      }
    }

    payments = validPayments.sort((a, b) => b.created - a.created);

    const fn = (a, b) => ({
      ...a,
      [b.currency]: {
        tips: (a[b.currency] ? a[b.currency].tips : 0) + (b.tip || 0),
        fiatTips: (
          Number.parseFloat(a[b.currency] ? a[b.currency].fiatTips : 0) +
          ((b.tip || 0) * b.rate) / SATS
        ).toFixed(2),
        sats:
          (a[b.currency] ? a[b.currency].sats : 0) +
          (b.amount || 0) +
          (b.tip || 0) -
          (b.fee || 0) -
          (b.ourfee || 0),
        fiat: (
          Number.parseFloat(a[b.currency] ? a[b.currency].fiat : 0) +
          (((b.amount || 0) +
            ((b.amount > 0 ? b.tip : -b.tip) || 0) -
            (b.fee || 0) -
            (b.ourfee || 0)) *
            b.rate) /
            SATS
        ).toFixed(2),
      },
    });

    const incoming = payments.filter((p: any) => p.amount > 0).reduce(fn, {});
    const outgoing = payments.filter((p: any) => p.amount < 0).reduce(fn, {});

    const { length: count } = payments;
    if (limit) payments = payments.slice(offset, offset + limit);

    return c.json({ payments, count, incoming, outgoing });
  },

  async get(c) {
    try {
      const hash = c.req.param("hash");
      const p = await getPayment(hash);
      if (p?.type === PaymentType.internal) p.with = await getUser(p.ref, fields);
      if (p?.type === PaymentType.fund) p.with = await getUser(p.uid, fields);
      return c.json(p);
    } catch (e) {
      console.log(e);
      err("failed to get payment", e.message);
      return bail(c, e.message);
    }
  },

  async parse(c) {
    const body = await c.req.json();
    const { payreq } = body;
    const user = c.get("user");
    try {
      const hour = 1000 * 60 * 60;
      let nodes = await g("nodes");
      const { last } = nodes || {};

      if (!last || last > Date.now() - hour) {
        ({ nodes } = await ln.listnodes());
        nodes.last = Date.now();
        await s("nodes", nodes);
      }

      const decoded = await ln.decode(payreq);

      let amount_msat;
      let payee;

      if (decoded.type.includes("bolt12")) {
        ({ invoice_amount_msat: amount_msat, invoice_node_id: payee } = decoded);
      } else ({ amount_msat, payee } = decoded);

      const node = nodes.find((n) => n.nodeid === payee);
      const alias = node ? node.alias : payee.substr(0, 12);

      const amount = Math.round(amount_msat / 1000);
      let ourfee = Math.round(amount * config.fee[PaymentType.lightning]);
      const creditBal = await getCredit(user.id, "lightning");
      const covered = Math.min(creditBal, ourfee) || 0;
      ourfee -= covered;

      return c.json({ alias, amount, ourfee });
    } catch (e) {
      console.log(e);
      err("problem parsing", e.message);
      return bail(c, e.message);
    }
  },

  async funds(c) {
    const user = c.get("user");
    const fundIds = [...await db.sMembers(`user:${user.id}:funds`)];

    const funds = await Promise.all(
      fundIds.map(async (id) => {
        const amount = await getFundBalance(id);
        if (amount === null) return null;
        const managers = [...await db.sMembers(`fund:${id}:managers`)];
        return { id, amount, managed: managers.includes(user.id), managers: managers.length };
      }),
    );

    return c.json(funds.filter(Boolean));
  },

  async fund(c) {
    const id = c.req.param("id");
    const amount = await getFundBalance(id);
    if (amount === null) return bail(c, "fund not found");
    let payments = (await db.lRange(`fund:${id}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map((hash) => gf(`payment:${hash}`)));

    await Promise.all(payments.map(async (p: any) => (p.user = await getUser(p.uid, fields))));

    payments = payments.filter((p) => p);

    const authIds = await db.lRange(`fund:${id}:authorizations`, 0, -1) || [];
    const allAuths = await Promise.all(authIds.map((authId) => g(`authorization:${authId}`)));
    const authorizations = allAuths.filter((a) => a && !a.claimed);
    return c.json({ amount, authorizations, payments });
  },

  async authorize(c) {
    const user = c.get("user");
    const { id: uid } = user;
    const body = await c.req.json();
    const { id, fiat, currency, amount } = body;

    const managers = [...await db.sMembers(`fund:${id}:managers`)];
    if (managers.length && !managers.includes(uid)) fail("Unauthorized");

    const authId = v4();
    const authorization = {
      authId,
      fundId: id,
      uid,
      currency,
      fiat,
      amount,
      created: Date.now(),
    };

    await s(`authorization:${authId}`, authorization);
    await db.lPush(`fund:${id}:authorizations`, authId);
    return c.json({ authId });
  },

  async listAuthorizations(c) {
    const id = c.req.param("id");
    const authIds = await db.lRange(`fund:${id}:authorizations`, 0, -1) || [];
    const allAuths = await Promise.all(authIds.map((authId) => g(`authorization:${authId}`)));
    const authorizations = allAuths.filter((a) => a && !a.claimed);
    return c.json(authorizations);
  },

  async deleteAuthorization(c) {
    const user = c.get("user");
    const id = c.req.param("id");
    const authId = c.req.param("authId");

    const managers = [...await db.sMembers(`fund:${id}:managers`)];
    if (managers.length && !managers.includes(user.id)) fail("Unauthorized");

    const authorization = await g(`authorization:${authId}`);
    if (!authorization || authorization.fundId !== id) return bail(c, "Authorization not found");
    if (authorization.claimed) return bail(c, "Authorization already claimed");

    await db.lRem(`fund:${id}:authorizations`, 0, authId);
    await db.del(`authorization:${authId}`);
    return c.json({});
  },

  async take(c) {
    const body = await c.req.json();
    const user = c.get("user");
    let { id, amount, invoice: iid, authId } = body;
    try {
      amount = Number.parseInt(amount);
      if (amount <= 0) fail("Invalid amount");

      const rates = await g("rates");

      if (!iid) {
        const inv = await generate({
          invoice: { amount, type: "lightning" },
          user,
        });
        iid = inv.id;
      }

      let authorization;
      if (authId) {
        authorization = await g(`authorization:${authId}`);
        if (authorization && authorization.fundId !== id) authorization = null;
      } else {
        const authIds = await db.lRange(`fund:${id}:authorizations`, 0, -1) || [];
        for (const aid of authIds) {
          const auth = await g(`authorization:${aid}`);
          if (auth && !auth.claimed) {
            authorization = auth;
            authId = aid;
            break;
          }
        }
      }

      if (authorization && !authorization.claimed) {
        const { currency, fiat } = authorization;
        amount = Math.min(amount, sats(fiat / rates[currency]));

        const sender = await getUser(authorization.uid);
        authorization.claimed = true;
        await s(`authorization:${authId}`, authorization);

        const { hash } = await generate({
          invoice: { amount, type: "lightning" },
          user: sender,
        });

        const { id: pid } = await debit({
          hash,
          amount,
          memo: id,
          user: sender,
          type: PaymentType.fund,
        });

        await tbFundCredit(id, amount);
        await db.lPush(`fund:${id}:payments`, pid);
        await db.sAdd(`user:${sender.id}:funds`, id);
        l("funded fund", id);
      }

      const managers = [...await db.sMembers(`fund:${id}:managers`)];
      if (managers.length && !managers.includes(user.id)) fail("Unauthorized");

      const result: any = await tbFundDebit(id, amount, "Insufficient funds");
      if (result.err) fail(result.err);

      const payment = await credit({
        aid: user.id,
        hash: iid,
        amount,
        memo: id,
        ref: id,
        type: PaymentType.fund,
      });

      await db.lPush(`fund:${id}:payments`, payment.id);
      await db.sAdd(`user:${user.id}:funds`, id);

      return c.json(payment);
    } catch (e) {
      warn("problem withdrawing from fund", user.username, e.message);
      return bail(c, e.message);
    }
  },

  async managers(c) {
    const name = c.req.param("name");

    const ids = [...await db.sMembers(`fund:${name}:managers`)];

    const managers = (await Promise.all(ids.map(async (id) => await getUser(id, fields)))).filter(
      Boolean,
    );

    return c.json(managers);
  },

  async addManager(c) {
    const body = await c.req.json();
    const { id, username } = body;
    const user = c.get("user");

    const k = `fund:${id}:managers`;

    let managers: any[] = [...await db.sMembers(k)];
    if (managers.length) {
      if (!managers.includes(user.id)) fail("Unauthorized");
    } else {
      await db.sAdd(k, user.id);
    }

    const u = await getUser(username, fields);
    if (!u) fail("User not found");
    const { id: uid } = u;

    await db.sAdd(k, uid);

    const ids = [...await db.sMembers(k)];
    if (!managers.length)
      managers = await Promise.all(ids.map(async (id) => await getUser(id, fields)));

    return c.json(managers);
  },

  async deleteManager(c) {
    try {
      const name = c.req.param("name");
      const body = await c.req.json();
      const { id: uid } = body;
      const user = c.get("user");

      const k = `fund:${name}:managers`;
      let managers: any[] = [...await db.sMembers(k)];

      if (managers.length) {
        if (!managers.includes(user.id)) fail("Unauthorized");
      }

      await db.sRem(k, uid);

      const ids = [...await db.sMembers(k)];
      managers = await Promise.all(ids.map(async (id) => await getUser(id, fields)));

      return c.json(managers);
    } catch (e) {}
  },

  async confirm(c) {
    const body = await c.req.json();
    const { txid, wallet, type } = body;

    if (type !== PaymentType.liquid) return c.json({});

    try {
      const node = rpc({ ...config[type], wallet });
      const { confirmations, details } = await node.getTransaction(txid);

      for (const { address, amount, asset, category, vout } of details) {
        if (!address) continue;
        if (asset !== config.liquid.btc) continue;

        if (category === "send") continue;

        const p = await getPayment(`${txid}:${vout}`);

        if (!p) {
          await getInvoice(address);
          if (sats(amount) < 300) continue;

          const lockKey = `lock:${txid}:${vout}`;
          const locked = await db.setNX(lockKey, "1");
          if (!locked) continue;
          await db.expire(lockKey, 60);

          await credit({
            hash: address,
            amount: sats(amount),
            ref: `${txid}:${vout}`,
            type,
          });
        } else if (confirmations >= 1) {
          if (p.confirmed) continue;

          const invoice = await getInvoice(address);
          if (!invoice) continue;

          p.confirmed = true;
          invoice.received += Number.parseInt(invoice.pending);
          invoice.pending = 0;

          l("confirming", p.id, p.amount);

          await tbConfirm(p.aid || p.uid, p.amount);

          await db
            .multi()
            .set(`invoice:${invoice.id}`, JSON.stringify(invoice))
            .set(`payment:${p.id}`, JSON.stringify(p))
            .exec();

          const user = await g(`user:${p.uid}`);
          await completePayment(invoice, p, user);
        }
      }
      return c.json({});
    } catch (e) {
      console.log(e);
      warn(`problem processing ${txid}`);
      return bail(c, e.message);
    }
  },

  async txWebhook(c) {
    const body = await c.req.json();
    const { txid, secret } = body || {};
    const headerSecret = c.req.header("x-hook-secret");
    const hookSecret = secret || headerSecret;

    try {
      if (config.txWebhookSecret && hookSecret !== config.txWebhookSecret) fail("unauthorized");
      if (!txid) fail("missing txid");

      const tx = await getTx(txid);
      await processWatchedTx(tx);

      return c.json({});
    } catch (e) {
      warn("problem processing tx webhook", e.message);
      return bail(c, e.message);
    }
  },

  async fee(c) {
    const body = await c.req.json();
    const user = c.get("user");
    try {
      return c.json(await build({ ...body, user }));
    } catch (e) {
      warn("problem estimating fee", e.message, user.username, body.amount, body.address);
      let msg = e.message;
      if (msg.includes("500")) msg = "";
      return bail(c, `Failed to prepare transaction ${msg}`);
    }
  },

  async send(c) {
    const body = await c.req.json();
    const user = c.get("user");
    try {
      await requirePin({ body, user });
      const { hash: txid } = await sendOnchain({ ...body, user });
      const pid = await g(`payment:${txid}`);
      const p = await g(`payment:${pid}`);

      return c.json(p);
    } catch (e) {
      warn(user.username, "payment failed", e.message);
      return c.json(e.message, 500);
    }
  },

  async freeze(c) {
    const body = await c.req.json();
    const { secret } = body;
    try {
      if (secret !== config.adminpass) fail("unauthorized");
      await s("freeze", true);
      return c.json("ok");
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async print(c) {
    const body = await c.req.json();
    const { id } = body;
    const user = c.get("user");
    try {
      const p = await gf(`payment:${id}`);
      if (!p) fail("Payment not found");
      if (p.uid !== user.id) fail("unauthorized");
      emit(user.id, "payment", p);

      const { username } = user;

      mqtt.publish(username, `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`);

      return c.json({ ok: true });
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async lnaddress(c) {
    const body = await c.req.json();
    const user = c.get("user");
    let lnaddress = c.req.param("lnaddress");
    let amount = c.req.param("amount");
    const { fee } = body;
    try {
      lnaddress = decodeURIComponent(lnaddress);
      await requirePin({ body, user });

      const [username, domain] = lnaddress.split("@");
      const { minSendable, maxSendable, callback, metadata } = (await got(
        `https://${domain}/.well-known/lnurlp/${username}`,
      ).json()) as any;

      const memo = metadata["text/plain"] || "";
      if (amount * 1000 < minSendable || amount * 1000 > maxSendable) fail("amount out of range");

      const r: any = await got(`${callback}?amount=${amount * 1000}`).json();
      if (r.reason) fail(r.reason);
      const { pr } = r;

      const { payee } = await ln.decode(pr);
      const { id } = await ln.getinfo();

      let p;
      if (payee === id) {
        p = await debit({ hash: pr, amount, memo, user });
        await credit({ hash: pr, amount, memo, ref: user.id });
      } else p = await sendLightning({ user, pr, amount, fee, memo });

      return c.json(p);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async gateway(c) {
    const body = await c.req.json();
    const { short_channel_id, webhook } = body;

    await s(short_channel_id, webhook);
    return c.json({ ok: true });
  },

  async bump(c) {
    const body = await c.req.json();
    const { id } = body;
    const user = c.get("user");
    try {
      const p = await gf(`payment:${id}`);
      if (!p) fail("Payment not found");
      if (p.uid !== user.id) fail("unauthorized");
      if (p.confirmed) fail("transaction already confirmed");
      if (p.type !== PaymentType.bitcoin) fail("only bitcoin transactions can be bumped");
      if (!p.bumpReserve || p.bumpReserve <= 0) fail("no bump reserve available");

      const fees: any = await fetch(`${api[PaymentType.bitcoin]}/fees/recommended`).then((r) =>
        r.json(),
      );
      const targetFeeRate = Math.max(Math.ceil(fees.fastestFee * 1.5), 4);

      const { txid, childFee } = await createCpfpChild(p, targetFeeRate);

      return c.json({
        txid,
        childFee,
        remaining: p.bumpReserve - childFee,
      });
    } catch (e) {
      err("failed to bump payment", id, e.message);
      return bail(c, e.message);
    }
  },

  async internal(c) {
    const body = await c.req.json();
    const { username, amount } = body;
    const sender = c.get("user");

    const recipient = await getUser(username);
    return c.json(await sendInternal({ amount, sender, recipient }));
  },

  async decode(c) {
    const bolt11 = c.req.param("bolt11");
    return c.json(await ln.decode(bolt11));
  },

  async fetchinvoice(c) {
    const body = await c.req.json();
    const { amount, offer } = body;
    return c.json(await ln.fetchinvoice(offer, amount ? amount * 1000 : null));
  },

  async auth(c) {
    const query = c.req.query();
    console.log(query);
    return c.json(query);
  },

  async order(c) {
    const body = await c.req.json();
    console.log(body);
    return c.json(body);
  },

  async sendinvoice(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      const { invreq } = body;

      const { amount_msat, bolt12, pay_index } = await ln.sendinvoice({
        invreq,
        label: v4(),
      });

      await generate({
        invoice: {
          amount: Math.round(amount_msat / 1000),
          type: "bolt12",
          bolt12,
        },
        user,
      });

      const p = await replay(pay_index);

      return c.json(p);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async ark(c) {
    const body = await c.req.json();
    const user = c.get("user");
    const { address, amount, aid } = body;

    try {
      await requirePin({ body, user });
      await requireAccountOwnership(db, user.id, aid);

      l("ark send", user.username, address, amount);
      const tmpHash = v4();
      const p = await debit({
        hash: tmpHash,
        amount,
        user,
        type: PaymentType.ark,
        aid,
      });

      try {
        const txid = await sendArk(address, amount);
        l("ark send complete", txid);
        p.hash = txid;
        await s(`payment:${p.id}`, p);
        await s(`payment:${txid}`, p.id);

        try {
          const vaultInfo = await g(`arkaddr:${address}`);
          if (vaultInfo) {
            const { aid: vaultAid, uid: vaultUid } = vaultInfo;

            const isForward = await g(`custodial-ark-invoice:${address}`);

            const vaultOwner = await g(`user:${vaultUid}`);
            const { rate, currency } = await getUserRate(vaultOwner || user);
            const vp = await createArkPayment({
              aid: vaultAid,
              uid: vaultUid,
              amount: parseInt(amount),
              hash: txid,
              rate,
              currency,
              extraHashMappings: [txid],
            });
            if (!isForward) {
              l("ark send: instant vault credit", vaultAid, txid);
              emit(vaultUid, "payment", vp);
            }
          }
        } catch (e) {
          warn("ark send: instant vault notification failed", e.message);
        }
      } catch (e) {
        await reverse(p);
        throw e;
      }

      return c.json(p);
    } catch (e) {
      warn(user.username, "ark payment failed", e.message);
      return c.json(e.message, 500);
    }
  },

  async arkVaultSend(c) {
    try {
      const body = await c.req.json();
      const user = c.get("user");
      const { hash, amount, aid } = body;
      await requireAccountOwnership(db, user.id, aid);
      const { rate, currency } = await getUserRate(user);

      const p = await createArkPayment({
        aid,
        uid: user.id,
        amount: -amount,
        hash,
        rate,
        currency,
        mapHashToId: true,
      });

      return c.json(p);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async arkVaultReceive(c) {
    try {
      const body = await c.req.json();
      const user = c.get("user");
      const { amount, hash, aid } = body;
      await requireAccountOwnership(db, user.id, aid);

      if (amount <= 0) fail("Invalid amount");
      await acquireArkLock(hash);
      const { rate, currency } = await getUserRate(user);

      const p = await createArkPayment({
        aid,
        uid: user.id,
        amount,
        hash,
        rate,
        currency,
      });

      return c.json(p);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async arkAddress(c) {
    return c.json(await getArkAddress());
  },

  async arkReceive(c) {
    try {
      const body = await c.req.json();
      const user = c.get("user");
      const { iid, amount, hash } = body;
      const { id: uid } = user;

      if (amount <= 0) fail("Invalid amount");

      const invoice = await getInvoice(iid);
      if (invoice.uid !== user?.id) fail("Unauthorized");

      let { aid, type, currency } = invoice;

      if (hash) {
        await acquireArkLock(hash);

        if (!(aid && aid !== uid)) {
          if (!(await verifyArkVtxo(hash))) fail("VTXO not found in server wallet");
        }
      }

      invoice.received += amount;
      const { rates } = await getUserRate(user);
      const rate = rates[currency];

      await tbCredit(uid, uid, type, amount, false);

      const p = await createArkPayment({
        aid: uid,
        uid,
        amount,
        hash,
        rate,
        currency,
        type,
        iid,
        extraMultiOps: (m, p) => {
          m.set(`invoice:${invoice.id}`, JSON.stringify(invoice));
          if (hash) m.set(`payment:${aid}:${hash}`, p.id);
        },
      });

      await completePayment(invoice, p, user);

      if (invoice.text) await db.del(`custodial-ark-invoice:${invoice.text}`);

      return c.json(p);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async arkSync(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      const { transactions = [], aid } = body;
      const { id: uid } = user;

      await requireAccountOwnership(db, uid, aid);

      const lockKey = `arksynclock:${aid}`;
      const gotLock = await db.set(lockKey, "1", { NX: true, EX: 30 });
      if (!gotLock) return c.json({ synced: 0, received: 0, payments: [] });

      try {
        // Sync ark address if client reports a different one
        if (body.arkAddress) {
          const account = await g(`account:${aid}`);
          if (account && account.arkAddress !== body.arkAddress) {
            if (account.arkAddress) await db.del(`arkaddr:${account.arkAddress}`);
            account.arkAddress = body.arkAddress;
            await s(`account:${aid}`, account);
            await db.set(`arkaddr:${body.arkAddress}`, JSON.stringify({ aid, uid }));
            // arkSync updated arkAddress silently
          }
        }

        const { rate, currency } = await getUserRate(user);

        let synced = 0;
        let received = 0;
        const payments = [];

        for (const tx of transactions) {
          const hashes = [tx.arkTxid, tx.commitmentTxid, tx.hash].filter(Boolean);
          if (!hashes.length) continue;

          let found = false;
          for (const h of hashes) {
            const existingId = await g(`payment:${aid}:${h}`);
            if (existingId) {
              const existing = await g(`payment:${existingId}`);
              if (existing && !existing.confirmed && tx.settled) {
                existing.confirmed = true;
                await s(`payment:${existingId}`, existing);
              }
              found = true;
              break;
            }
          }
          if (found) continue;

          if (tx.amount <= 0) continue;

          const primaryHash = hashes[0];

          const p = await createArkPayment({
            aid,
            uid,
            amount: tx.amount,
            hash: primaryHash,
            rate,
            currency,
            created: tx.createdAt,
            extraHashMappings: hashes,
          });

          payments.push(p);
          synced++;
          if (tx.amount > 0) {
            received += tx.amount;

            const invoiceIds = await db.lRange(`${aid}:invoices`, 0, 20);
            for (const iid of invoiceIds) {
              const inv = await getInvoice(iid);
              if (!inv || inv.type !== "ark") continue;
              if (inv.received >= inv.amount && inv.amount > 0) continue;
              if (inv.amount > 0 && tx.amount < inv.amount) continue;
              inv.received += tx.amount;
              p.iid = iid;
              await s(`invoice:${iid}`, inv);
              await s(`payment:${p.id}`, p);
              emit(uid, "payment", p);
              break;
            }
          }
        }

        const { balance } = body;
        if (typeof balance === "number" && balance >= 0) {
          const paymentIds = await db.lRange(`${aid}:payments`, 0, -1);
          let expectedBalance = 0;
          const now = Date.now();
          let hasRecentPayments = false;
          for (const pid of paymentIds) {
            const pay = await g(`payment:${pid}`);
            if (pay) {
              expectedBalance += pay.amount;
              if (pay.amount > 0 && now - pay.created < 120_000) {
                hasRecentPayments = true;
              }
            }
          }

          if (expectedBalance > balance && !hasRecentPayments) {
            const p = await createArkPayment({
              aid,
              uid,
              amount: balance - expectedBalance,
              hash: `expired-${Date.now()}`,
              rate,
              currency,
              created: Date.now(),
              extraHashMappings: [],
            }) as any;
            p.memo = "expired";
            await s(`payment:${p.id}`, p);
            payments.push(p);
            synced++;
          }
        }

        let forward;
        if (received > 0) {
          const account = await g(`account:${aid}`);
          if (account?.arkAddress) {
            const iid = await g(`custodial-ark-invoice:${account.arkAddress}`);
            if (iid) {
              const inv = await getInvoice(iid);
              if (inv && (inv.received < inv.amount || inv.amount === 0)) {
                const serverArkAddress = await getArkAddress();
                forward = {
                  iid,
                  amount: inv.amount || received,
                  serverArkAddress,
                };
              }
            }
          }
        }

        return c.json({ synced, received, payments, forward });
      } finally {
        await db.del(lockKey);
      }
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async bitcoinSync(c) {
    try {
      const user = c.get("user");
      const { aid } = await c.req.json();
      const { id: uid } = user;

      const pos = await db.lPos(`${uid}:accounts`, aid);
      if (pos === null) return bail(c, "account not found");

      const account = await g(`account:${aid}`);
      if (!account?.pubkey || !account?.fingerprint) return bail(c, "not a bitcoin vault");

      const lockKey = `btcsynclock:${aid}`;
      const gotLock = await db.set(lockKey, "1", { NX: true, EX: 30 });
      if (!gotLock) return c.json({ synced: 0, received: 0, payments: [] });

      try {
        const { pendingTotal, newPayments } = await syncBitcoinVault(account, user);

        let received = 0;
        const payments = [];

        for (const p of newPayments) {
          if (p.amount > 0) {
            received += p.amount;
            payments.push(p);

            const invoiceIds = await db.lRange(`${aid}:invoices`, 0, 20);
            for (const iid of invoiceIds) {
              const inv = await getInvoice(iid);
              if (!inv || inv.type !== "bitcoin") continue;
              if (inv.received >= inv.amount && inv.amount > 0) continue;
              if (inv.amount > 0 && p.amount < inv.amount) continue;
              inv.received = (inv.received || 0) + p.amount;
              p.iid = iid;
              await s(`invoice:${iid}`, inv);
              await s(`payment:${p.id}`, p);
              emit(uid, "payment", p);
              break;
            }
          }
        }

        // Compute balance from payments
        const paymentIds = await db.lRange(`${aid}:payments`, 0, -1);
        const paymentKeys = paymentIds.map((pid) => `payment:${pid}`);
        const allPayments = await gfAll(paymentKeys);
        let balance = 0;
        for (const pay of allPayments) {
          if (pay && pay.confirmed !== false) balance += pay.amount - (pay.fee || 0);
        }
        balance = Math.max(balance, 0);

        return c.json({
          synced: newPayments.length,
          received,
          payments,
          balance,
          pending: pendingTotal,
        });
      } finally {
        await db.del(lockKey);
      }
    } catch (e) {
      return bail(c, e.message);
    }
  },
};
