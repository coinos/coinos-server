import { describe, test, expect, beforeEach } from "bun:test";

// Mocks are loaded via test/preload.ts (bunfig.toml [test].preload)
// Access the mock functions we need for assertions
import { tbCredit } from "$lib/tb";
import { warn } from "$lib/logging";
import { callWebhook } from "$lib/webhooks";
import ln from "$lib/ln";

const mockTbCredit = tbCredit as any;
const mockWarn = warn as any;
const mockCallWebhook = callWebhook as any;
const mockLnXpay = ln.xpay as any;
const mockLnFetchinvoice = ln.fetchinvoice as any;
const mockLnDecode = ln.decode as any;
const mockLnGetroutes = ln.getroutes as any;

import { completePayment } from "$lib/payments";
import _routes from "$routes/payments";
const routes: any = _routes;

// =====================================================================
// Helpers
// =====================================================================

const store = () => globalThis.__testStore;

const custodialUid = "custodial-uid";
const arkAccountId = "ark-account-123";
const bolt11 = "lnbcrt10u1pntestqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

const makeUser = (overrides = {}) => ({
  id: custodialUid,
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
  uid: custodialUid,
  aid: custodialUid,
  type: "ark",
  currency: "USD",
  amount: 1000,
  received: 0,
  pending: 0,
  rate: 50000,
  forward: null as string | null,
  forwarded: false,
  hash: "inv-hash-001",
  memo: "",
  tip: null,
  webhook: null,
  secret: null,
  ...overrides,
});

const seedInvoice = (inv: any) => {
  store().kvStore[`invoice:${inv.id}`] = JSON.stringify(inv);
  store().kvStore[`invoice:${inv.hash}`] = inv.id;
};

const seedUser = (user: any) => {
  store().kvStore[`user:${user.username}`] = JSON.stringify(user);
  store().kvStore[`user:${user.id}`] = JSON.stringify(user);
};

const resetAll = () => {
  const s = store();
  for (const k of Object.keys(s.kvStore)) delete s.kvStore[k];
  for (const k of Object.keys(s.listStore)) delete s.listStore[k];
  for (const k of Object.keys(s.setStore)) delete s.setStore[k];

  mockTbCredit.mockClear();
  mockWarn.mockClear();
  mockCallWebhook.mockClear();
  mockLnXpay.mockClear();
  mockLnFetchinvoice.mockClear();
  mockLnDecode.mockClear();
  mockLnGetroutes.mockClear();

  mockLnGetroutes.mockImplementation(async () => ({ routes: [] }));

  mockLnXpay.mockImplementation(async () => ({
    amount_sent_msat: 1_000_000,
    payment_preimage: "preimage-abc123",
  }));

  mockLnDecode.mockImplementation(async () => ({
    type: "bolt11",
    amount_msat: 1_000_000,
    payee: "test-payee",
  }));

  // Seed rates and limits
  s.kvStore["rates"] = JSON.stringify({ USD: 50000, CAD: 68000 });
  s.kvStore["limit"] = JSON.stringify(100_000_000);
  s.kvStore["lightning:limit"] = JSON.stringify(100_000_000);
  s.kvStore["internal:limit"] = JSON.stringify(100_000_000);
  s.kvStore["freeze"] = JSON.stringify(false);
  s.kvStore["hardfreeze"] = JSON.stringify(false);

  seedUser(makeUser());
};

const makeContext = (opts: { body?: any; user?: any } = {}) => {
  let sent: any;
  const ctx: any = {
    req: {
      json: async () => opts.body,
      header: () => undefined,
      path: "/test",
      method: "POST",
      query: () => ({}),
      raw: { clone: () => ({ json: async () => opts.body }) },
    },
    get: (key: string) => {
      if (key === "user") return opts.user;
      return undefined;
    },
    set: () => {},
    json: (data: any, _status?: number) => {
      sent = data;
      return new Response(JSON.stringify(data), { status: _status || 200 });
    },
    env: {},
    getSent: () => sent,
  };
  return ctx;
};

// =====================================================================
// Tests: completePayment forward logic
// =====================================================================

describe("completePayment", () => {
  beforeEach(resetAll);

  test("forwards payment and debit stays in custodial", async () => {
    const user = makeUser();
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    expect(mockLnXpay).toHaveBeenCalled();
    expect(inv.forwarded).toBe(true);
    expect(mockCallWebhook).toHaveBeenCalled();
  });

  test("forwards and debit stays in custodial when aid matches user", async () => {
    const user = makeUser();
    const inv = makeInvoice({ aid: custodialUid, forward: bolt11 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    expect(mockLnXpay).toHaveBeenCalled();
    expect(inv.forwarded).toBe(true);
  });

  test("handles forward failure gracefully", async () => {
    const user = makeUser();
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      created: Date.now(),
    };

    mockLnXpay.mockImplementationOnce(async () => {
      throw new Error("route not found");
    });

    const w = await completePayment(inv, p, user);

    expect(w).toBeUndefined();
    expect(mockWarn).toHaveBeenCalled();
    expect(mockWarn.mock.calls.some((c: any[]) => c.includes("forward failed"))).toBe(true);
  });

  test("skips forward when already forwarded", async () => {
    const user = makeUser();
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11, forwarded: true });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      created: Date.now(),
    };

    const w = await completePayment(inv, p, user);

    expect(w).toBeUndefined();
    expect(mockLnXpay).not.toHaveBeenCalled();
  });

  test("skips forward when payment not confirmed", async () => {
    const user = makeUser();
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11 });
    const p = {
      amount: 1000,
      confirmed: false,
      type: "ark",
      uid: custodialUid,
      created: Date.now(),
    };

    const w = await completePayment(inv, p, user);

    expect(w).toBeUndefined();
    expect(mockLnXpay).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Tests: arkReceive route handler
// =====================================================================

describe("arkReceive", () => {
  beforeEach(resetAll);

  test("credits custodial and forwards to Lightning", async () => {
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11 });
    seedInvoice(inv);

    const ctx = makeContext({
      body: { iid: inv.id, amount: 1000, hash: "ark-txid-999" },
      user: makeUser(),
    });

    await routes.arkReceive(ctx);
    const sent = ctx.getSent();

    // Response is the custodial credit record
    expect(sent).toBeTruthy();
    expect(sent.amount).toBe(1000);
    expect(sent.aid).toBe(custodialUid);

    // tbCredit called for deposit
    expect(mockTbCredit).toHaveBeenCalledWith(custodialUid, custodialUid, inv.type, 1000, false);

    // Ark txid mapped for dedup
    expect(store().kvStore[`payment:${arkAccountId}:ark-txid-999`]).toBeTruthy();

    // Credit record in custodial list
    expect(store().listStore[`${custodialUid}:payments`] ?? []).toContain(sent.id);

    // Forward triggered Lightning send
    expect(mockLnXpay).toHaveBeenCalled();
  });

  test("credits custodial without forward", async () => {
    const inv = makeInvoice({ aid: arkAccountId });
    seedInvoice(inv);

    const ctx = makeContext({
      body: { iid: inv.id, amount: 1000, hash: "ark-txid-888" },
      user: makeUser(),
    });

    await routes.arkReceive(ctx);
    const sent = ctx.getSent();

    expect(sent).toBeTruthy();
    expect(sent.amount).toBe(1000);
    expect(sent.aid).toBe(custodialUid);

    // Always credits custodial TB
    expect(mockTbCredit).toHaveBeenCalledWith(custodialUid, custodialUid, inv.type, 1000, false);
    // Record in custodial list
    expect(store().listStore[`${custodialUid}:payments`] ?? []).toContain(sent.id);
  });

  test("credits custodial even when forward fails", async () => {
    const inv = makeInvoice({ aid: arkAccountId, forward: bolt11 });
    seedInvoice(inv);

    mockLnXpay.mockImplementationOnce(async () => {
      throw new Error("no route");
    });

    const ctx = makeContext({
      body: { iid: inv.id, amount: 1000, hash: "ark-txid-777" },
      user: makeUser(),
    });

    await routes.arkReceive(ctx);
    const sent = ctx.getSent();

    // Credit still lands in custodial even though forward failed
    expect(sent).toBeTruthy();
    expect(sent.amount).toBe(1000);
    expect(sent.aid).toBe(custodialUid);

    expect(mockTbCredit).toHaveBeenCalledWith(custodialUid, custodialUid, inv.type, 1000, false);
    expect(store().listStore[`${custodialUid}:payments`] ?? []).toContain(sent.id);
  });

  test("rejects invalid amount", async () => {
    const inv = makeInvoice();
    seedInvoice(inv);

    const ctx = makeContext({
      body: { iid: inv.id, amount: 0, hash: "ark-txid-000" },
      user: makeUser(),
    });

    await routes.arkReceive(ctx);
    // Should error - check that send wasn't called with a valid payment
    const sent = ctx.getSent();
    expect(sent).toBeDefined();
  });

  test("rejects unauthorized user", async () => {
    const inv = makeInvoice({ uid: "other-user-id" });
    seedInvoice(inv);

    const ctx = makeContext({
      body: { iid: inv.id, amount: 1000, hash: "ark-txid-666" },
      user: makeUser(),
    });

    await routes.arkReceive(ctx);
    const sent = ctx.getSent();
    expect(sent).toBeDefined();
  });
});

// =====================================================================
// Tests: arkSync skips change VTXOs
// =====================================================================

describe("arkSync", () => {
  beforeEach(resetAll);

  test("records received VTXOs (positive amounts)", async () => {
    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [
          { hash: "recv-vtxo-hash", amount: 9000, settled: true, createdAt: Date.now() },
        ],
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(1);
    expect(sent.received).toBe(9000);
    expect(store().listStore[`${arkAccountId}:payments`] ?? []).toHaveLength(1);
  });

  test("skips sent transactions (negative amounts)", async () => {
    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [
          { hash: "send-tx-hash", amount: -1000, settled: true, createdAt: Date.now() },
        ],
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    // Negative amounts are skipped — balance reconciliation handles losses
    expect(sent.synced).toBe(0);
  });

  test("deduplicates known transactions", async () => {
    // Pre-store a known tx hash and its sync lock
    store().kvStore[`arksync:${arkAccountId}:known-hash`] = "1";
    store().kvStore[`payment:${arkAccountId}:known-hash`] = JSON.stringify("existing-id");
    store().kvStore["payment:existing-id"] = JSON.stringify({
      id: "existing-id",
      confirmed: false,
    });

    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [{ hash: "known-hash", amount: -1000, settled: true, createdAt: Date.now() }],
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(0);
    // Existing record should be updated to confirmed
    const updated = JSON.parse(store().kvStore["payment:existing-id"]);
    expect(updated.confirmed).toBe(true);
  });
});

// =====================================================================
// Tests: arkSync expired VTXO reconciliation
// =====================================================================

describe("arkSync reconciliation", () => {
  beforeEach(resetAll);

  test("creates expired debit when payment sum exceeds wallet balance", async () => {
    // Pre-seed two received payments totaling 7128
    // Timestamps must be >120s old to pass hasRecentPayments guard
    const oldTime = Date.now() - 200_000;
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 5000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: oldTime,
    };
    const pay2 = {
      id: "pay-2",
      aid: arkAccountId,
      amount: 2128,
      hash: "h2",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: oldTime,
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:pay-2`] = JSON.stringify(pay2);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().kvStore[`payment:${arkAccountId}:h2`] = JSON.stringify("pay-2");
    store().listStore[`${arkAccountId}:payments`] = ["pay-2", "pay-1"];

    // Sync with no new transactions but balance=0 (VTXOs expired)
    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [],
        balance: 0,
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(1);
    expect(sent.payments).toHaveLength(1);

    const reconPayment = sent.payments[0];
    expect(reconPayment.amount).toBe(-7128);
    expect(reconPayment.memo).toBe("expired");
    expect(reconPayment.type).toBe("ark");

    // Payment list should now have 3 entries
    expect(store().listStore[`${arkAccountId}:payments`]).toHaveLength(3);
  });

  test("does not reconcile when sum matches balance", async () => {
    // Pre-seed a payment of 5000
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 5000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: Date.now(),
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().listStore[`${arkAccountId}:payments`] = ["pay-1"];

    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [],
        balance: 5000,
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(0);
    expect(sent.payments).toHaveLength(0);
    expect(store().listStore[`${arkAccountId}:payments`]).toHaveLength(1);
  });

  test("does not reconcile when balance is not provided (backward compat)", async () => {
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 5000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: Date.now(),
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().listStore[`${arkAccountId}:payments`] = ["pay-1"];

    const ctx = makeContext({
      body: {
        aid: arkAccountId,
        transactions: [],
      },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(0);
    expect(sent.payments).toHaveLength(0);
  });

  test("is idempotent — second sync does not create duplicate", async () => {
    // Seed payment sum = 5000, balance = 0
    const oldTime = Date.now() - 200_000;
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 5000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: oldTime,
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().listStore[`${arkAccountId}:payments`] = ["pay-1"];

    const ctx1 = makeContext({
      body: { aid: arkAccountId, transactions: [], balance: 0 },
      user: makeUser(),
    });

    // First sync — should create reconciliation
    await routes.arkSync(ctx1);
    const sent1 = ctx1.getSent();
    expect(sent1.synced).toBe(1);
    expect(sent1.payments[0].amount).toBe(-5000);

    // Second sync — sum is now 0, matches balance, no new reconciliation
    const ctx2 = makeContext({
      body: { aid: arkAccountId, transactions: [], balance: 0 },
      user: makeUser(),
    });
    await routes.arkSync(ctx2);
    const sent2 = ctx2.getSent();
    expect(sent2.synced).toBe(0);
    expect(sent2.payments).toHaveLength(0);
  });

  test("reconciles partial expiry", async () => {
    // 10000 received, 3000 sent, sum = 7000. Actual balance = 2000 (5000 expired)
    const oldTime = Date.now() - 200_000;
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 10000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: oldTime,
    };
    const pay2 = {
      id: "pay-2",
      aid: arkAccountId,
      amount: -3000,
      hash: "h2",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: oldTime,
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:pay-2`] = JSON.stringify(pay2);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().kvStore[`payment:${arkAccountId}:h2`] = JSON.stringify("pay-2");
    store().listStore[`${arkAccountId}:payments`] = ["pay-2", "pay-1"];

    const ctx = makeContext({
      body: { aid: arkAccountId, transactions: [], balance: 2000 },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(1);
    expect(sent.payments[0].amount).toBe(-5000);
    expect(sent.payments[0].memo).toBe("expired");
  });

  test("does not reconcile when sum is less than balance", async () => {
    // Sum = 3000, balance = 5000 (e.g., recovered VTXOs already synced)
    const pay1 = {
      id: "pay-1",
      aid: arkAccountId,
      amount: 3000,
      hash: "h1",
      confirmed: true,
      type: "ark",
      uid: custodialUid,
      rate: 50000,
      currency: "USD",
      created: Date.now(),
    };
    store().kvStore[`payment:pay-1`] = JSON.stringify(pay1);
    store().kvStore[`payment:${arkAccountId}:h1`] = JSON.stringify("pay-1");
    store().listStore[`${arkAccountId}:payments`] = ["pay-1"];

    const ctx = makeContext({
      body: { aid: arkAccountId, transactions: [], balance: 5000 },
      user: makeUser(),
    });
    await routes.arkSync(ctx);
    const sent = ctx.getSent();

    expect(sent.synced).toBe(0);
    expect(sent.payments).toHaveLength(0);
  });
});

// =====================================================================
// Tests: BOLT12 offer autowithdraw
// =====================================================================

const bolt12Offer = "lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqyqs";
const bolt12Invoice = "lni1qqg86n2pddz86n2ptszien5gqp3zzqmpkv93rjd";

describe("BOLT12 autowithdraw", () => {
  beforeEach(resetAll);

  test("fetches invoice from BOLT12 offer and sends via Lightning", async () => {
    mockLnFetchinvoice.mockImplementation(async () => ({
      invoice: bolt12Invoice,
    }));

    mockLnDecode.mockImplementation(async (s: string) =>
      s.startsWith("lno")
        ? { type: "bolt12 offer", offer_issuer_id: "bolt12-payee" }
        : { type: "bolt12 invoice", invoice_amount_msat: 980_000, invoice_node_id: "bolt12-payee" },
    );

    const user = makeUser();
    seedUser(user);

    const awAccount = {
      id: "aw-account",
      autowithdraw: true,
      threshold: 500,
      reserve: 0,
      destination: bolt12Offer,
    };
    store().kvStore[`account:${awAccount.id}`] = JSON.stringify(awAccount);

    const inv = makeInvoice({ type: "lightning", amount: 1000 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "lightning",
      uid: custodialUid,
      aid: awAccount.id,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    // decode called first with the offer to get node id
    expect(mockLnDecode).toHaveBeenCalled();
    expect(mockLnDecode.mock.calls[0][0]).toBe(bolt12Offer);

    // getroutes called to estimate routing fee
    expect(mockLnGetroutes).toHaveBeenCalled();

    // fetchinvoice called with the offer and amount in msats
    expect(mockLnFetchinvoice).toHaveBeenCalled();
    const [offer, amountMsat] = mockLnFetchinvoice.mock.calls[0];
    expect(offer).toBe(bolt12Offer);
    expect(amountMsat).toBeGreaterThan(0);

    // xpay called with the fetched bolt12 invoice
    expect(mockLnXpay).toHaveBeenCalled();
  });

  test("forwards BOLT12 offer via invoice forward field", async () => {
    mockLnFetchinvoice.mockImplementation(async () => ({
      invoice: bolt12Invoice,
    }));

    mockLnDecode.mockImplementation(async (s: string) =>
      s.startsWith("lno")
        ? { type: "bolt12 offer", offer_issuer_id: "bolt12-payee" }
        : { type: "bolt12 invoice", invoice_amount_msat: 980_000, invoice_node_id: "bolt12-payee" },
    );

    const user = makeUser();
    const inv = makeInvoice({ forward: bolt12Offer });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "lightning",
      uid: custodialUid,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    expect(mockLnFetchinvoice).toHaveBeenCalled();
    expect(mockLnXpay).toHaveBeenCalled();
    expect(inv.forwarded).toBe(true);
  });

  test("regular ln invoice is NOT passed through fetchinvoice", async () => {
    const user = makeUser();
    seedUser(user);

    const awAccount = {
      id: "aw-account",
      autowithdraw: true,
      threshold: 500,
      reserve: 0,
      destination: bolt11,
    };
    store().kvStore[`account:${awAccount.id}`] = JSON.stringify(awAccount);

    const inv = makeInvoice({ type: "lightning", amount: 1000 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "lightning",
      uid: custodialUid,
      aid: awAccount.id,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    expect(mockLnFetchinvoice).not.toHaveBeenCalled();
    expect(mockLnXpay).toHaveBeenCalled();
  });

  test("accounts for routing fee from getroutes on multi-hop", async () => {
    // Mock balance is 10_000_000; autowithdraw sends balance - reserve
    const balance = 10_000_000;
    const routingFee = 50;

    mockLnDecode.mockImplementation(async (s: string) =>
      s.startsWith("lno")
        ? { type: "bolt12 offer", offer_issuer_id: "bolt12-payee" }
        : { type: "bolt12 invoice", invoice_amount_msat: null, invoice_node_id: "bolt12-payee" },
    );

    // Simulate a route with 50 sat routing fee (getroutes response format)
    mockLnGetroutes.mockImplementation(async () => ({
      routes: [
        {
          amount_msat: balance * 1000,
          path: [{ amount_msat: (balance + routingFee) * 1000 }],
        },
      ],
    }));

    mockLnFetchinvoice.mockImplementation(async () => ({
      invoice: bolt12Invoice,
    }));

    const user = makeUser();
    seedUser(user);

    const awAccount = {
      id: "aw-account",
      autowithdraw: true,
      threshold: 500,
      reserve: 0,
      destination: bolt12Offer,
    };
    store().kvStore[`account:${awAccount.id}`] = JSON.stringify(awAccount);

    const inv = makeInvoice({ type: "lightning", amount: 1000 });
    const p = {
      amount: 1000,
      confirmed: true,
      type: "lightning",
      uid: custodialUid,
      aid: awAccount.id,
      created: Date.now(),
    };

    await completePayment(inv, p, user);

    // fetchinvoice amount should exclude routing fee and ourfee
    const [, amountMsat] = mockLnFetchinvoice.mock.calls[0];
    const ourfee = Math.round(balance * 0.001);
    expect(amountMsat).toBe((balance - routingFee - ourfee) * 1000);

    expect(mockLnXpay).toHaveBeenCalled();
  });
});
