process.env.INTEGRATION = "1";

import { describe, test, expect, beforeAll } from "bun:test";

// =====================================================================
// Helpers
// =====================================================================

const APP = "http://localhost:3119";

const api = async (path: string, token: string, opts: any = {}) => {
  const res = await fetch(`${APP}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
    ...opts,
  });
  return res.json();
};

const register = async (username: string, password: string) => {
  const res = await fetch(`${APP}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: { username, password } }),
  });
  if (!res.ok) throw new Error(`register failed: ${await res.text()}`);
  return res.json();
};

const login = async (username: string, password: string) => {
  const res = await fetch(`${APP}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${await res.text()}`);
  return res.json();
};

const createInvoice = (token: string, invoice: any) =>
  api("/invoice", token, {
    method: "POST",
    body: JSON.stringify({ invoice }),
  });

const getPayments = (token: string, aid?: string) =>
  api(`/payments${aid ? `?aid=${aid}` : ""}`, token);

// =====================================================================
// Test state
// =====================================================================

let token: string;
let user: any;
let arkAccountId: string;

const ts = Math.random().toString(36).slice(2, 8);
const username = `arkrec${ts}`;

// =====================================================================
// Setup
// =====================================================================

beforeAll(async () => {
  const result = await register(username, "testpass");
  token = result.token;
  user = result.user;

  // Create an ark account for this user
  const res = await fetch(`${APP}/accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: "ark", name: "ark vault" }),
  });
  if (res.ok) {
    const account = await res.json();
    arkAccountId = account.id;
  } else {
    // Fallback: use user's own ID as the account
    arkAccountId = user.id;
  }
});

// =====================================================================
// Tests
// =====================================================================

describe("ark sync reconciliation", () => {
  test("syncs new transactions and creates payment records", async () => {
    const hash = `test-recv-${Date.now()}`;
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [
          {
            arkTxid: hash,
            commitmentTxid: null,
            amount: 10000,
            settled: true,
            createdAt: Date.now(),
          },
        ],
        balance: 10000,
      }),
    });

    expect(result.synced).toBe(1);
    expect(result.received).toBe(10000);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount).toBe(10000);
  });

  test("deduplicates already-synced transactions", async () => {
    // Sync the same hash again — should be skipped
    const hash = `test-recv-${Date.now()}`;

    // First sync
    await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [
          { arkTxid: hash, amount: 3000, settled: true, createdAt: Date.now() },
        ],
        balance: 13000,
      }),
    });

    // Second sync with same hash
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [
          { arkTxid: hash, amount: 3000, settled: true, createdAt: Date.now() },
        ],
        balance: 13000,
      }),
    });

    expect(result.synced).toBe(0);
    expect(result.payments).toHaveLength(0);
  });

  test("creates expired debit when balance < payment sum", async () => {
    // Current payment sum is 13000 (10000 + 3000 from previous tests)
    // Send balance=0 to simulate all VTXOs expired
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [],
        balance: 0,
      }),
    });

    expect(result.synced).toBe(1);
    expect(result.payments).toHaveLength(1);

    const expired = result.payments[0];
    expect(expired.amount).toBe(-13000);
    expect(expired.memo).toBe("expired");
    expect(expired.type).toBe("ark");
  });

  test("is idempotent — no duplicate expired debit on re-sync", async () => {
    // Sum is now 0 (13000 - 13000), balance is still 0
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [],
        balance: 0,
      }),
    });

    expect(result.synced).toBe(0);
    expect(result.payments).toHaveLength(0);
  });

  test("new receive after expiry works correctly", async () => {
    // Simulate VTXOs recovered and new receive
    const hash = `test-recovery-${Date.now()}`;
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [
          { arkTxid: hash, amount: 5000, settled: true, createdAt: Date.now() },
        ],
        balance: 5000,
      }),
    });

    expect(result.synced).toBe(1);
    expect(result.received).toBe(5000);

    // Sum is now 5000 (13000 - 13000 + 5000), matches balance=5000
    // No reconciliation needed
    expect(
      result.payments.filter((p: any) => p.memo === "expired"),
    ).toHaveLength(0);
  });

  test("partial expiry creates correct debit", async () => {
    // Balance dropped from 5000 to 2000 (3000 worth of VTXOs expired)
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [],
        balance: 2000,
      }),
    });

    expect(result.synced).toBe(1);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount).toBe(-3000);
    expect(result.payments[0].memo).toBe("expired");
  });

  test("matches ark invoice when receiving", async () => {
    // Create an ark invoice first
    const inv = await createInvoice(token, {
      type: "ark",
      amount: 2000,
      aid: arkAccountId,
    });
    expect(inv.id).toBeTruthy();

    const hash = `test-invoice-recv-${Date.now()}`;
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [
          { arkTxid: hash, amount: 2000, settled: true, createdAt: Date.now() },
        ],
        balance: 4000, // previous 2000 + new 2000
      }),
    });

    expect(result.synced).toBe(1);
    expect(result.received).toBe(2000);

    // Payment should be matched to the invoice
    const matched = result.payments.find((p: any) => p.iid === inv.id);
    expect(matched).toBeTruthy();
    expect(matched.amount).toBe(2000);
  });

  test("backward compat — no reconciliation without balance field", async () => {
    // Call without balance field (old client)
    const result = await api("/ark/sync", token, {
      method: "POST",
      body: JSON.stringify({
        aid: arkAccountId,
        transactions: [],
      }),
    });

    expect(result.synced).toBe(0);
    expect(result.payments).toHaveLength(0);
  });
});
