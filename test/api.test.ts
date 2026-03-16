import { describe, test, expect, beforeAll } from "bun:test";
import app from "$lib/app";
import { auth, optional } from "$lib/auth";
import users from "$routes/users";
import info from "$routes/info";
import invoices from "$routes/invoices";

// Register routes (subset of index.ts — no side effects, no Bun.serve)
app.get("/health", info.health);
app.post("/register", users.create);
app.post("/login", users.login);
app.get("/me", auth, users.me);
app.get("/users/:key", users.get);
app.post("/invoice", optional, invoices.create);
app.get("/invoice/:id", invoices.get);

const post = (path: string, body: any) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Use unique username to avoid collisions with other test files
const USERNAME = `apiuser${Date.now()}`;
const PASSWORD = "testpass123";

beforeAll(() => {
  // Clear any leftover state from other test files
  const store = globalThis.__testStore;
  for (const k of Object.keys(store.kvStore)) delete store.kvStore[k];
  for (const k of Object.keys(store.listStore)) delete store.listStore[k];
  for (const k of Object.keys(store.setStore)) delete store.setStore[k];
});

describe("Health", () => {
  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.healthy).toBe(true);
  });
});

describe("Registration", () => {
  test("creates user with valid credentials", async () => {
    const res = await post("/register", {
      user: { username: USERNAME, password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.username).toBe(USERNAME);
  });

  test("rejects duplicate username", async () => {
    const res = await post("/register", {
      user: { username: USERNAME, password: PASSWORD },
    });
    expect(res.status).toBe(500);
  });

  test("rejects missing user object", async () => {
    const res = await post("/register", { password: PASSWORD });
    expect(res.status).toBe(500);
  });

  test("rejects invalid username", async () => {
    const res = await post("/register", {
      user: { username: "ab!@#", password: PASSWORD },
    });
    expect(res.status).toBe(500);
  });
});

describe("Login", () => {
  test("succeeds with valid credentials", async () => {
    const res = await post("/login", {
      username: USERNAME,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.user).toBeDefined();
  });

  test("fails with wrong password", async () => {
    const res = await post("/login", {
      username: USERNAME,
      password: "wrongpass",
    });
    expect(res.status).toBe(401);
  });

  test("fails with nonexistent user", async () => {
    const res = await post("/login", {
      username: "noone",
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});

describe("Authenticated endpoints", () => {
  test("GET /me returns user data", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBeDefined();
  });
});

describe("User lookup", () => {
  test("GET /users/:key finds registered user", async () => {
    const res = await app.request(`/users/${USERNAME}`);
    expect(res.status).toBe(200);
  });
});

describe("Routing", () => {
  test("unknown route returns 404", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });
});
