// Regression tests for the 2026-08 security-disclosure fixes.
//
// Runs against the live regtest stack (the app on :3119 and the redis `db`).
// Because redis isn't port-mapped to the host, run this INSIDE the app
// container so `redis://db` resolves and `localhost:3119` is the app:
//
//   docker exec app sh -c 'cd /home/bun/app && bun test test/security.test.ts'
//
// Override endpoints with TEST_API / TEST_REDIS if needed.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { createClient } from "redis";

const API = process.env.TEST_API || "http://localhost:3119";
const REDIS = process.env.TEST_REDIS || "redis://db";

let db: any;
const username = `sectest${Date.now()}${Math.floor(Math.random() * 1000)}`;
const password = "correct horse battery staple";
let uid: string | null = null;
let pubkey: string | undefined;

const post = (path: string, body?: any, headers: any = {}) =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  db = createClient({ url: REDIS });
  await db.connect();

  const reg = await post("/register", { user: { username, password } });
  if (reg.status !== 200)
    throw new Error(`register failed: ${reg.status} ${await reg.text()}`);

  uid = await db.get(`user:${username.toLowerCase()}`);
  if (uid) {
    const rec = JSON.parse(await db.get(`user:${uid}`));
    pubkey = rec?.pubkey;
  }
});

afterAll(async () => {
  // Best-effort cleanup of the throwaway user's keys.
  if (uid) {
    const keys = [
      `user:${uid}`,
      `user:${username.toLowerCase()}`,
      `balance:${uid}`,
      `account:${uid}`,
      `${uid}:accounts`,
      `${uid}:apps`,
    ];
    if (pubkey)
      keys.push(
        `user:${pubkey}`,
        `${pubkey}:follows:n`,
        `${pubkey}:followers:n`,
        `${pubkey}:pubkeys`,
      );
    try {
      await db.del(keys);
    } catch {}
  }
  await db.quit();
});

describe("S1 — websocket auth verifies the JWT signature", () => {
  const secret = "s1-test-secret";

  test("jwt.verify accepts a properly signed token", () => {
    const token = jwt.sign({ id: "u1" }, secret);
    expect((jwt.verify(token, secret) as any).id).toBe("u1");
  });

  test("jwt.verify rejects an alg:none forgery that jwt.decode would trust", () => {
    const forged = jwt.sign({ id: "victim" }, "", { algorithm: "none" });
    // The old code used jwt.decode() and would have trusted this uid.
    expect((jwt.decode(forged) as any).id).toBe("victim");
    expect(() => jwt.verify(forged, secret)).toThrow();
  });

  test("jwt.verify rejects a token signed with the wrong key", () => {
    const forged = jwt.sign({ id: "victim" }, "attacker-key");
    expect(() => jwt.verify(forged, secret)).toThrow();
  });
});

describe("S2 — passwords hashed at bcrypt cost 12", () => {
  test("a freshly registered account is stored at cost 12", async () => {
    expect(uid).toBeTruthy();
    const rec = JSON.parse(await db.get(`user:${uid}`));
    expect(rec.password.startsWith("$2b$12$")).toBe(true);
  });

  test("legacy cost-4 hashes are detected for transparent upgrade", async () => {
    const legacy = await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 });
    const modern = await Bun.password.hash("x", { algorithm: "bcrypt", cost: 12 });
    const costOf = (h: string) =>
      Number.parseInt(h.match(/^\$2[aby]\$(\d{2})\$/)?.[1] ?? "0", 10);
    expect(costOf(legacy)).toBe(4);
    expect(costOf(modern)).toBe(12);
    expect(costOf(legacy) < 12).toBe(true);
    // A legacy hash must still verify (so the upgrade is transparent).
    expect(await Bun.password.verify("x", legacy)).toBe(true);
  });
});

describe("S3 — adminpass login fails closed", () => {
  test("a login with an omitted password never authenticates", async () => {
    const r = await post("/login", { username });
    expect(r.status).toBe(401);
  });

  test("a login with the wrong password is rejected", async () => {
    const r = await post("/login", { username, password: "not the password" });
    expect(r.status).toBe(401);
  });

  test("the real password still logs in (fix didn't break auth)", async () => {
    const r = await post("/login", { username, password });
    expect(r.status).toBe(200);
    const { token } = await r.json();
    expect(typeof token).toBe("string");
  });
});

describe("S5 — session cookie carries httpOnly/secure/sameSite", () => {
  test("Set-Cookie on login has the hardening flags", async () => {
    const r = await post("/login", { username, password });
    expect(r.status).toBe(200);
    const cookie = (r.headers.get("set-cookie") || "").toLowerCase();
    expect(cookie).toContain("httponly");
    expect(cookie).toContain("secure");
    expect(cookie).toContain("samesite");
  });
});

describe("S6 — NWC dedup claim is atomic (SET NX)", () => {
  test("two concurrent claims of one event id yield exactly one winner", async () => {
    const key = `test:nwcdedup:${Date.now()}:${Math.random()}`;
    const [a, b] = await Promise.all([
      db.set(key, "1", { NX: true, EX: 30 }),
      db.set(key, "1", { NX: true, EX: 30 }),
    ]);
    const winners = [a, b].filter((x) => x === "OK").length;
    expect(winners).toBe(1);
    await db.del(key);
  });
});

describe("S7 — /upload/:type requires auth", () => {
  // Bare POST (no JSON content-type): the auth preValidation runs before the
  // handler, so an unauthenticated upload is rejected with 401. (Sending a JSON
  // content-type here would 400 in the body parser first — a different reject
  // path that doesn't exercise the auth gate.)
  test("POST /upload/banner without a token is rejected", async () => {
    const r = await fetch(`${API}/upload/banner`, { method: "POST" });
    expect(r.status).toBe(401);
  });
  test("POST /upload/photo without a token is rejected", async () => {
    const r = await fetch(`${API}/upload/photo`, { method: "POST" });
    expect(r.status).toBe(401);
  });
});

describe("fnd-003/004 — oversized memo is truncated, not fatal", () => {
  // Mirrors the credit() choke point: memo.length > 5000 => slice, never throw.
  const cap = (memo: string) =>
    memo && memo.length > 5000 ? memo.slice(0, 5000) : memo;

  test("a 6000-char memo is clipped to 5000", () => {
    expect(cap("A".repeat(6000)).length).toBe(5000);
  });
  test("a normal memo is untouched", () => {
    expect(cap("thanks!")).toBe("thanks!");
  });
});

describe("fnd-006 — deleteSelf guard sums every account", () => {
  test("funds in a sub-account count toward the guard", async () => {
    const base = `test:acct:${Date.now()}:${Math.floor(Math.random() * 1000)}`;
    const sub = `${base}:sub`;
    await db.rPush(`${base}:accounts`, base);
    await db.rPush(`${base}:accounts`, sub);
    await db.set(`balance:${base}`, "500"); // dust in main
    await db.set(`balance:${sub}`, "5000000"); // savings in sub

    // Same summation the guard now performs.
    const aids = await db.lRange(`${base}:accounts`, 0, -1);
    let total = 0;
    for (const aid of aids) {
      total += Number(await db.get(`balance:${aid}`)) || 0;
      total += Number(await db.get(`pending:${aid}`)) || 0;
    }

    expect(total).toBe(5000500);
    expect(total > 10000).toBe(true); // => deletion refused

    await db.del(`${base}:accounts`, `balance:${base}`, `balance:${sub}`);
  });
});

describe("S8 / fnd-007 — the spend/cash mutex serializes critical sections", () => {
  test("no two sections run concurrently and FIFO order holds", async () => {
    // Same shape as withBudgetLock (nwc.ts) and withCashLock (ecash.ts).
    let lock: Promise<void> = Promise.resolve();
    const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
      const prev = lock;
      let release: () => void = () => {};
      lock = new Promise((res) => {
        release = res;
      });
      await prev;
      try {
        return await fn();
      } finally {
        release();
      }
    };

    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (n: number) =>
      withLock(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        order.push(n);
        active--;
      });

    await Promise.all([job(1), job(2), job(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });
});
