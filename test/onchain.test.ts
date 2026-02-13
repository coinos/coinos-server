import { describe, test, expect, beforeEach } from "bun:test";

import { tbCredit, tbConfirm } from "$lib/tb";
import { emit } from "$lib/sockets";
import { callWebhook } from "$lib/webhooks";

const mockTbCredit = tbCredit as any;
const mockTbConfirm = tbConfirm as any;
const mockEmit = emit as any;
const mockCallWebhook = callWebhook as any;

import { processWatchedTx, credit, catchUp } from "$lib/payments";
import routes from "$routes/payments";
import { PaymentType } from "$lib/types";

// =====================================================================
// Helpers
// =====================================================================

const store = () => globalThis.__testStore;

const uid = "user-uid-001";
const address = "bcrt1qtest123";
const lqAddress = "el1qqtest456";

const makeUser = (overrides = {}) => ({
  id: uid,
  username: "testuser",
  currency: "USD",
  language: "en",
  autowithdraw: false,
  threshold: 0,
  reserve: 0,
  destination: "",
  ...overrides,
});

const makeInvoice = (overrides: any = {}) => ({
  id: "inv-001",
  uid,
  aid: uid,
  type: PaymentType.bitcoin,
  currency: "USD",
  amount: 50000,
  received: 0,
  pending: 0,
  rate: 50000,
  forward: null as string | null,
  forwarded: false,
  hash: address,
  memo: "",
  tip: null,
  webhook: null,
  secret: null,
  ...overrides,
});

const seedInvoice = (inv: any) => {
  store().kvStore[`invoice:${inv.id}`] = JSON.stringify(inv);
  store().kvStore[`invoice:${inv.hash}`] = JSON.stringify(inv.id);
};

const seedUser = (user: any) => {
  store().kvStore[`user:${user.username}`] = JSON.stringify(user);
  store().kvStore[`user:${user.id}`] = JSON.stringify(user);
};

const seedPayment = (p: any) => {
  store().kvStore[`payment:${p.id}`] = JSON.stringify(p);
  if (p.ref) {
    const [txid, vout] = p.ref.split(":");
    store().kvStore[`payment:${txid}:${vout}`] = JSON.stringify(p.id);
  }
};

const resetAll = () => {
  const s = store();
  for (const k of Object.keys(s.kvStore)) delete s.kvStore[k];
  for (const k of Object.keys(s.listStore)) delete s.listStore[k];
  for (const k of Object.keys(s.setStore)) delete s.setStore[k];

  mockTbCredit.mockClear();
  mockTbConfirm.mockClear();
  mockCallWebhook.mockClear();

  // Seed rates and limits
  s.kvStore["rates"] = JSON.stringify({ USD: 50000, CAD: 68000 });
  s.kvStore["limit"] = JSON.stringify(100_000_000);
  s.kvStore["bitcoin:limit"] = JSON.stringify(100_000_000);
  s.kvStore["liquid:limit"] = JSON.stringify(100_000_000);
  s.kvStore["internal:limit"] = JSON.stringify(100_000_000);
  s.kvStore["freeze"] = JSON.stringify(false);
  s.kvStore["hardfreeze"] = JSON.stringify(false);

  // Reset overrides
  delete s.rpcOverride;
  delete s.esploraOverride;

  seedUser(makeUser());
};

const makeRes = () => {
  let sent: any;
  return {
    send: (data: any) => { sent = data; },
    code: (code: number) => ({
      send: (data: any) => { sent = data; },
    }),
    getSent: () => sent,
  };
};

// =====================================================================
// Tests: processWatchedTx — Bitcoin receive via ZMQ
// =====================================================================

describe("processWatchedTx", () => {
  beforeEach(resetAll);

  test("creates pending payment for unconfirmed tx to watched address", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    await processWatchedTx({
      txid: "btctx001",
      vout: [{ scriptpubkey_address: address, value: 50000 }],
      status: { confirmed: false },
    });

    // Payment record created
    const pid = JSON.parse(store().kvStore[`payment:btctx001:0`]);
    expect(pid).toBeTruthy();
    const p = JSON.parse(store().kvStore[`payment:${pid}`]);
    expect(p.amount).toBe(50000);
    expect(p.confirmed).toBe(false);
    expect(p.type).toBe(PaymentType.bitcoin);

    // Invoice pending updated
    const updatedInv = JSON.parse(store().kvStore[`invoice:${inv.id}`]);
    expect(updatedInv.pending).toBe(50000);

    // TB credit called with pending=true
    expect(mockTbCredit).toHaveBeenCalledWith(uid, uid, PaymentType.bitcoin, 50000, true);

    // Address still being watched (not confirmed yet)
    expect(store().setStore["watching"].has(address)).toBe(true);
  });

  test("confirms pending payment when tx is confirmed", async () => {
    const inv = makeInvoice({ pending: 50000 });
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    // Seed existing pending payment
    const pendingPayment = {
      id: "pay-pending-001",
      aid: uid,
      uid,
      amount: 50000,
      confirmed: false,
      type: PaymentType.bitcoin,
      ref: "btctx001:0",
    };
    seedPayment(pendingPayment);

    await processWatchedTx({
      txid: "btctx001",
      vout: [{ scriptpubkey_address: address, value: 50000 }],
      status: { confirmed: true },
    });

    // Payment now confirmed
    const p = JSON.parse(store().kvStore[`payment:${pendingPayment.id}`]);
    expect(p.confirmed).toBe(true);

    // TB confirm called
    expect(mockTbConfirm).toHaveBeenCalledWith(uid, 50000);

    // Invoice received updated, pending cleared
    const updatedInv = JSON.parse(store().kvStore[`invoice:${inv.id}`]);
    expect(updatedInv.received).toBe(50000);
    expect(updatedInv.pending).toBe(0);

    // Address removed from watching
    expect(store().setStore["watching"].has(address)).toBe(false);
  });

  test("creates and immediately confirms payment for already-confirmed tx", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    await processWatchedTx({
      txid: "btctx002",
      vout: [{ scriptpubkey_address: address, value: 75000 }],
      status: { confirmed: true },
    });

    // Payment was created then confirmed
    const pid = JSON.parse(store().kvStore[`payment:btctx002:0`]);
    const p = JSON.parse(store().kvStore[`payment:${pid}`]);
    expect(p.confirmed).toBe(true);

    // TB credit (pending) + confirm both called
    expect(mockTbCredit).toHaveBeenCalled();
    expect(mockTbConfirm).toHaveBeenCalled();

    // Address removed from watching
    expect(store().setStore["watching"].has(address)).toBe(false);
  });

  test("skips outputs below dust threshold (300 sats)", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    await processWatchedTx({
      txid: "btctx003",
      vout: [{ scriptpubkey_address: address, value: 299 }],
      status: { confirmed: false },
    });

    expect(store().kvStore[`payment:btctx003:0`]).toBeUndefined();
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("skips addresses not in watching set", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    // No address in watching set

    await processWatchedTx({
      txid: "btctx004",
      vout: [{ scriptpubkey_address: address, value: 50000 }],
      status: { confirmed: false },
    });

    expect(store().kvStore[`payment:btctx004:0`]).toBeUndefined();
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("deduplicates with setNX lock", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    // Pre-set the lock
    store().kvStore[`lock:btctx005:0`] = "1";

    await processWatchedTx({
      txid: "btctx005",
      vout: [{ scriptpubkey_address: address, value: 50000 }],
      status: { confirmed: false },
    });

    // No payment created because lock was already held
    expect(store().kvStore[`payment:btctx005:0`]).toBeUndefined();
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("skips already-confirmed payment on duplicate notification", async () => {
    const inv = makeInvoice({ pending: 0, received: 50000 });
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    const confirmedPayment = {
      id: "pay-confirmed-001",
      aid: uid,
      uid,
      amount: 50000,
      confirmed: true,
      type: PaymentType.bitcoin,
      ref: "btctx006:0",
    };
    seedPayment(confirmedPayment);

    await processWatchedTx({
      txid: "btctx006",
      vout: [{ scriptpubkey_address: address, value: 50000 }],
      status: { confirmed: true },
    });

    // TB confirm should NOT be called again
    expect(mockTbConfirm).not.toHaveBeenCalled();
  });

  test("handles multiple outputs in same tx", async () => {
    const address2 = "bcrt1qtest456";
    const inv1 = makeInvoice();
    const inv2 = makeInvoice({ id: "inv-002", hash: address2 });
    seedInvoice(inv1);
    seedInvoice(inv2);
    store().setStore["watching"] = new Set([address, address2]);

    await processWatchedTx({
      txid: "btctx007",
      vout: [
        { scriptpubkey_address: address, value: 30000 },
        { scriptpubkey_address: address2, value: 20000 },
      ],
      status: { confirmed: false },
    });

    const pid1 = JSON.parse(store().kvStore[`payment:btctx007:0`]);
    const pid2 = JSON.parse(store().kvStore[`payment:btctx007:1`]);
    expect(pid1).toBeTruthy();
    expect(pid2).toBeTruthy();

    const p1 = JSON.parse(store().kvStore[`payment:${pid1}`]);
    const p2 = JSON.parse(store().kvStore[`payment:${pid2}`]);
    expect(p1.amount).toBe(30000);
    expect(p2.amount).toBe(20000);
  });
});

// =====================================================================
// Tests: /confirm — Liquid receive via walletnotify
// =====================================================================

describe("confirm (liquid)", () => {
  beforeEach(resetAll);

  test("ignores non-liquid types", async () => {
    const req = {
      body: { txid: "btctx100", wallet: "test", type: PaymentType.bitcoin },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect((res as any).getSent()).toEqual({});
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("creates pending payment for unconfirmed liquid receive", async () => {
    const inv = makeInvoice({ type: PaymentType.liquid, hash: lqAddress });
    seedInvoice(inv);

    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 0,
        details: [{
          address: lqAddress,
          amount: 0.0005,
          asset: "test-asset",
          category: "receive",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx001", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect((res as any).getSent()).toEqual({});

    // Payment should be created via credit()
    const pid = JSON.parse(store().kvStore[`payment:lqtx001:0`]);
    expect(pid).toBeTruthy();
    const p = JSON.parse(store().kvStore[`payment:${pid}`]);
    expect(p.type).toBe(PaymentType.liquid);
    expect(p.confirmed).toBe(false);
    expect(mockTbCredit).toHaveBeenCalled();
  });

  test("confirms existing pending liquid payment", async () => {
    const inv = makeInvoice({ type: PaymentType.liquid, hash: lqAddress, pending: 50000 });
    seedInvoice(inv);

    const pendingPayment = {
      id: "lq-pay-001",
      aid: uid,
      uid,
      amount: 50000,
      confirmed: false,
      type: PaymentType.liquid,
      ref: "lqtx002:0",
    };
    seedPayment(pendingPayment);

    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 2,
        details: [{
          address: lqAddress,
          amount: 0.0005,
          asset: "test-asset",
          category: "receive",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx002", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);

    // Payment confirmed
    const p = JSON.parse(store().kvStore[`payment:${pendingPayment.id}`]);
    expect(p.confirmed).toBe(true);

    // TB confirm called
    expect(mockTbConfirm).toHaveBeenCalledWith(uid, 50000);

    // Invoice updated
    const updatedInv = JSON.parse(store().kvStore[`invoice:${inv.id}`]);
    expect(updatedInv.received).toBe(50000);
    expect(updatedInv.pending).toBe(0);
  });

  test("skips send category", async () => {
    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 1,
        details: [{
          address: lqAddress,
          amount: 0.0005,
          asset: "test-asset",
          category: "send",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx003", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect(mockTbCredit).not.toHaveBeenCalled();
    expect(mockTbConfirm).not.toHaveBeenCalled();
  });

  test("skips non-btc asset", async () => {
    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 0,
        details: [{
          address: lqAddress,
          amount: 0.001,
          asset: "wrong-asset-id",
          category: "receive",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx004", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("deduplicates with setNX lock", async () => {
    const inv = makeInvoice({ type: PaymentType.liquid, hash: lqAddress });
    seedInvoice(inv);

    // Pre-set the lock
    store().kvStore[`lock:lqtx005:0`] = "1";

    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 0,
        details: [{
          address: lqAddress,
          amount: 0.0005,
          asset: "test-asset",
          category: "receive",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx005", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect(mockTbCredit).not.toHaveBeenCalled();
  });

  test("skips already-confirmed payment", async () => {
    const inv = makeInvoice({ type: PaymentType.liquid, hash: lqAddress });
    seedInvoice(inv);

    const confirmedPayment = {
      id: "lq-pay-002",
      aid: uid,
      uid,
      amount: 50000,
      confirmed: true,
      type: PaymentType.liquid,
      ref: "lqtx006:0",
    };
    seedPayment(confirmedPayment);

    store().rpcOverride = {
      getTransaction: async () => ({
        confirmations: 3,
        details: [{
          address: lqAddress,
          amount: 0.0005,
          asset: "test-asset",
          category: "receive",
          vout: 0,
        }],
      }),
    };

    const req = {
      body: { txid: "lqtx006", wallet: "test", type: PaymentType.liquid },
    };
    const res = makeRes();

    await routes.confirm(req as any, res as any);
    expect(mockTbConfirm).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Tests: catchUp — recovery after server downtime
// =====================================================================

describe("catchUp", () => {
  beforeEach(resetAll);

  test("picks up missed unconfirmed tx for watched address", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    store().esploraOverride = {
      addressTxs: {
        [address]: [{
          txid: "missed-tx-001",
          vout: [{ scriptpubkey_address: address, value: 40000 }],
          status: { confirmed: false },
        }],
      },
    };

    await catchUp();

    const pid = JSON.parse(store().kvStore[`payment:missed-tx-001:0`]);
    expect(pid).toBeTruthy();
    const p = JSON.parse(store().kvStore[`payment:${pid}`]);
    expect(p.amount).toBe(40000);
    expect(p.confirmed).toBe(false);
    expect(mockTbCredit).toHaveBeenCalled();

    delete store().esploraOverride;
  });

  test("picks up and confirms already-confirmed tx for watched address", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);
    store().setStore["watching"] = new Set([address]);

    store().esploraOverride = {
      addressTxs: {
        [address]: [{
          txid: "missed-tx-002",
          vout: [{ scriptpubkey_address: address, value: 60000 }],
          status: { confirmed: true },
        }],
      },
    };

    await catchUp();

    const pid = JSON.parse(store().kvStore[`payment:missed-tx-002:0`]);
    const p = JSON.parse(store().kvStore[`payment:${pid}`]);
    expect(p.confirmed).toBe(true);
    expect(mockTbCredit).toHaveBeenCalled();
    expect(mockTbConfirm).toHaveBeenCalled();

    delete store().esploraOverride;
  });

  test("confirms inflight non-custodial payment", async () => {
    const aid = "noncustodial-001";

    const inflightPayment = {
      id: "inflight-pay-001",
      aid,
      uid,
      hash: "btctx-inflight",
      amount: 25000,
      confirmed: false,
      type: PaymentType.bitcoin,
    };
    store().kvStore[`payment:${inflightPayment.id}`] = JSON.stringify(inflightPayment);
    store().setStore[`inflight:${aid}`] = new Set([inflightPayment.id]);

    store().esploraOverride = {
      txStatus: { "btctx-inflight": { confirmed: true } },
    };

    await catchUp();

    const p = JSON.parse(store().kvStore[`payment:${inflightPayment.id}`]);
    expect(p.confirmed).toBe(true);

    // Removed from inflight set
    expect(store().setStore[`inflight:${aid}`].has(inflightPayment.id)).toBe(false);

    delete store().esploraOverride;
  });

  test("cleans up already-confirmed inflight entries", async () => {
    const aid = "noncustodial-002";

    const confirmedPayment = {
      id: "inflight-pay-002",
      aid,
      uid,
      hash: "btctx-already-done",
      amount: 15000,
      confirmed: true,
      type: PaymentType.bitcoin,
    };
    store().kvStore[`payment:${confirmedPayment.id}`] = JSON.stringify(confirmedPayment);
    store().setStore[`inflight:${aid}`] = new Set([confirmedPayment.id]);

    await catchUp();

    // Should be removed from inflight without calling getTxStatus
    expect(store().setStore[`inflight:${aid}`].has(confirmedPayment.id)).toBe(false);
    // No TB calls needed
    expect(mockTbConfirm).not.toHaveBeenCalled();
  });

  test("does nothing with empty watching set and no inflight", async () => {
    await catchUp();
    expect(mockTbCredit).not.toHaveBeenCalled();
    expect(mockTbConfirm).not.toHaveBeenCalled();
  });
});
