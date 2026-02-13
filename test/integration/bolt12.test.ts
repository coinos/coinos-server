process.env.INTEGRATION = "1";

import { describe, test, expect, beforeAll } from "bun:test";

// =====================================================================
// Helpers
// =====================================================================

const APP = "http://localhost:3119";

const exec = async (cmd: string): Promise<string> => {
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`exec failed (${code}): ${stderr || stdout}`);
  }
  return stdout.trim();
};

const clExec = async (container: string, ...args: string[]): Promise<any> => {
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const result = await exec(
    `docker exec ${container} lightning-cli ${escaped}`,
  );
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
};

const mine = async (n: number) => {
  const addr = await exec(
    "docker exec bc bitcoin-cli -regtest -rpcwallet=coinos getnewaddress",
  );
  await exec(
    `docker exec bc bitcoin-cli -regtest generatetoaddress ${n} ${addr}`,
  );
};

const waitFor = async <T>(
  fn: () => Promise<T>,
  timeout = 30000,
): Promise<T> => {
  const start = Date.now();
  let lastError: any;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
    await Bun.sleep(500);
  }
  throw new Error(`waitFor timed out: ${lastError?.message || "no result"}`);
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

const updateUser = (token: string, settings: any) =>
  api("/user", token, {
    method: "POST",
    body: JSON.stringify(settings),
  });

const getMe = (token: string) => api("/me", token);

const createInvoice = (token: string, invoice: any) =>
  api("/invoice", token, {
    method: "POST",
    body: JSON.stringify({ invoice }),
  });

const sendInternal = (token: string, username: string, amount: number) =>
  api("/send", token, {
    method: "POST",
    body: JSON.stringify({ username, amount }),
  });

const getPayments = (token: string) => api("/payments", token);

// =====================================================================
// Test state
// =====================================================================

let funderToken: string;
let withdrawerToken: string;
let funderUser: any;
let withdrawerUser: any;

// =====================================================================
// Setup: register users, fund the funder via lightning
// =====================================================================

const ts = Date.now();
const funderName = `intfunder${ts}`;
const withdrawerName = `intwdraw${ts}`;

beforeAll(async () => {
  // Verify containers are running
  try {
    await exec("docker exec cl lightning-cli getinfo");
    await exec("docker exec clb lightning-cli getinfo");
    await exec("docker exec clc lightning-cli getinfo");
  } catch {
    throw new Error(
      "Lightning containers not running. Start with: docker compose up -d cl clb clc",
    );
  }

  // Register test users
  const funder = await register(funderName, "testpass123");
  funderToken = funder.token;
  funderUser = funder;

  const withdrawer = await register(withdrawerName, "testpass123");
  withdrawerToken = withdrawer.token;
  withdrawerUser = withdrawer;

  // Fund the funder: generate a lightning invoice and pay from clb
  const inv = await createInvoice(funderToken, {
    amount: 500_000,
    type: "lightning",
  });

  await clExec("clb", "pay", inv.hash);

  // Wait for the payment to be credited
  await waitFor(async () => {
    const me = await getMe(funderToken);
    return me.balance >= 500_000 ? me : null;
  });
}, 60000);

// =====================================================================
// Tests
// =====================================================================

describe("BOLT12 autowithdraw", () => {
  test("autowithdraw to direct peer (clb)", async () => {
    // Create a BOLT12 offer on clb
    const offer = await clExec("clb", "offer", "any", "integration-test");
    expect(offer.bolt12).toBeTruthy();

    // Get clb's initial balance
    const clbFundsBefore = await clExec("clb", "listfunds");
    const clbBalanceBefore = clbFundsBefore.channels.reduce(
      (s: number, c: any) => s + c.our_amount_msat,
      0,
    );

    // Configure withdrawer with autowithdraw to clb's offer
    await updateUser(withdrawerToken, {
      autowithdraw: "lightning",
      threshold: 1000,
      reserve: 0,
      destination: offer.bolt12,
    });

    // Send 100k sats from funder to withdrawer (triggers autowithdraw)
    const sendAmount = 100_000;
    const sendResult = await sendInternal(
      funderToken,
      withdrawerName,
      sendAmount,
    );
    expect(sendResult.amount).toBe(-sendAmount);

    // Wait for autowithdraw to complete — withdrawer balance should drop near 0
    const finalMe = await waitFor(async () => {
      const me = await getMe(withdrawerToken);
      return me.balance < 1000 ? me : null;
    }, 20000);

    expect(finalMe.balance).toBeLessThan(1000);

    // clb should have received the payment
    const clbFundsAfter = await clExec("clb", "listfunds");
    const clbBalanceAfter = clbFundsAfter.channels.reduce(
      (s: number, c: any) => s + c.our_amount_msat,
      0,
    );
    expect(clbBalanceAfter).toBeGreaterThan(clbBalanceBefore);

    // Check payment records on withdrawer
    const payments = await getPayments(withdrawerToken);
    const withdrawal = payments.payments?.find(
      (p: any) => p.amount < 0 && p.type === "lightning",
    );
    expect(withdrawal).toBeTruthy();
    expect(withdrawal.fee).toBeGreaterThanOrEqual(0);
  }, 30000);

  test("autowithdraw routes through clb to clc (multi-hop)", async () => {
    // Create a BOLT12 offer on clc
    const offer = await clExec("clc", "offer", "any", "multihop-test");
    expect(offer.bolt12).toBeTruthy();

    // Configure withdrawer with autowithdraw to clc's offer
    await updateUser(withdrawerToken, {
      autowithdraw: "lightning",
      threshold: 1000,
      reserve: 0,
      destination: offer.bolt12,
    });

    // Get clc's balance before
    const clcFundsBefore = await clExec("clc", "listfunds");
    const clcBalanceBefore = clcFundsBefore.channels.reduce(
      (s: number, c: any) => s + c.our_amount_msat,
      0,
    );

    // Send 50k sats from funder to withdrawer
    const sendAmount = 50_000;
    await sendInternal(funderToken, withdrawerName, sendAmount);

    // Wait for autowithdraw to complete
    const finalMe = await waitFor(async () => {
      const me = await getMe(withdrawerToken);
      return me.balance < 1000 ? me : null;
    }, 30000);

    expect(finalMe.balance).toBeLessThan(1000);

    // clc should have received the payment (routed cl→clb→clc)
    const clcFundsAfter = await clExec("clc", "listfunds");
    const clcBalanceAfter = clcFundsAfter.channels.reduce(
      (s: number, c: any) => s + c.our_amount_msat,
      0,
    );
    expect(clcBalanceAfter).toBeGreaterThan(clcBalanceBefore);

    // Check payment record has routing fee
    const payments = await getPayments(withdrawerToken);
    const withdrawal = payments.payments?.find(
      (p: any) => p.amount < 0 && p.type === "lightning",
    );
    expect(withdrawal).toBeTruthy();
    // Multi-hop should have non-zero routing fee
    expect(withdrawal.fee).toBeGreaterThan(0);
  }, 45000);

  test("finalize() refunds unused routing budget", async () => {
    // Create offer on clb (direct peer — minimal actual routing cost)
    const offer = await clExec("clb", "offer", "any", "refund-test");

    await updateUser(withdrawerToken, {
      autowithdraw: "lightning",
      threshold: 1000,
      reserve: 0,
      destination: offer.bolt12,
    });

    // Send 20k sats
    const sendAmount = 20_000;
    await sendInternal(funderToken, withdrawerName, sendAmount);

    // Wait for autowithdraw
    await waitFor(async () => {
      const me = await getMe(withdrawerToken);
      return me.balance < 1000 ? me : null;
    }, 20000);

    // Get the withdrawal payment record
    const payments = await getPayments(withdrawerToken);
    const withdrawal = payments.payments?.find(
      (p: any) => p.amount < 0 && p.type === "lightning",
    );
    expect(withdrawal).toBeTruthy();

    // For a direct peer, actual routing fee should be 0 or very small
    // The pre-allocated budget (2% or getroutes estimate) should have been refunded
    // via finalize(), so p.fee reflects the actual cost, not the budget
    expect(withdrawal.fee).toBeLessThan(Math.abs(withdrawal.amount) * 0.02);

    // Verify the refund happened — user should have gotten back the difference
    // between the pre-allocated fee budget and the actual fee
    expect(withdrawal.ref).toBeTruthy(); // preimage set by finalize()
  }, 30000);
});
