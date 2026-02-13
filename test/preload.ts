import { mock } from "bun:test";

// This file is loaded before test files via bunfig.toml [test].preload
// Mocks must be set up here to intercept transitive imports

let kvStore: Record<string, string> = {};
let listStore: Record<string, string[]> = {};
let setStore: Record<string, Set<string>> = {};

globalThis.__testStore = { kvStore, listStore, setStore };

const makeMulti = () => {
  const ops: Array<() => Promise<any>> = [];
  const chain: any = {
    set: (k: string, v: string) => {
      ops.push(async () => { globalThis.__testStore.kvStore[k] = v; });
      return chain;
    },
    lPush: (k: string, v: string) => {
      ops.push(async () => {
        const ls = globalThis.__testStore.listStore;
        if (!ls[k]) ls[k] = [];
        ls[k].unshift(v);
      });
      return chain;
    },
    del: (k: string) => {
      ops.push(async () => { delete globalThis.__testStore.kvStore[k]; });
      return chain;
    },
    lRem: (k: string, _count: number, v: string) => {
      ops.push(async () => {
        const ls = globalThis.__testStore.listStore;
        if (ls[k]) {
          const idx = ls[k].indexOf(v);
          if (idx >= 0) ls[k].splice(idx, 1);
        }
      });
      return chain;
    },
    sRem: (k: string, v: string) => {
      ops.push(async () => globalThis.__testStore.setStore[k]?.delete(v));
      return chain;
    },
    exec: async () => {
      for (const op of ops) await op();
      return [];
    },
  };
  return chain;
};

mock.module("$lib/db", () => {
  const kv = () => globalThis.__testStore.kvStore;
  const ls = () => globalThis.__testStore.listStore;
  const ss = () => globalThis.__testStore.setStore;
  const g = async (k: string) => {
    const v = kv()[k] ?? null;
    if (v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  };
  const s = (k: string, v: any) => {
    if (k === "user:null" || k === "user:undefined") throw new Error("null user");
    kv()[k] = JSON.stringify(v);
  };
  const gf = async (k: string) => {
    const v = kv()[k] ?? null;
    if (v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  };
  return {
    db: {
      get: async (k: string) => kv()[k] ?? null,
      set: async (k: string, v: string, opts?: any) => {
        if (opts?.NX && kv()[k] !== undefined) return null;
        kv()[k] = v;
        return "OK";
      },
      del: async (k: string) => { delete kv()[k]; return 1; },
      exists: async (k: string) => (kv()[k] !== undefined ? 1 : 0),
      lPush: async (k: string, v: string) => {
        if (!ls()[k]) ls()[k] = [];
        ls()[k].unshift(v);
        return ls()[k].length;
      },
      lRem: async (k: string, _count: number, v: string) => {
        if (!ls()[k]) return 0;
        const idx = ls()[k].indexOf(v);
        if (idx >= 0) { ls()[k].splice(idx, 1); return 1; }
        return 0;
      },
      lRange: async (k: string, start: number, end: number) => {
        if (!ls()[k]) return [];
        if (end === -1) return ls()[k].slice(start);
        return ls()[k].slice(start, end + 1);
      },
      lPos: async (k: string, v: string) => {
        if (!ls()[k]) return null;
        const idx = ls()[k].indexOf(v);
        return idx >= 0 ? idx : null;
      },
      sAdd: async (k: string, ...vals: string[]) => {
        if (!ss()[k]) ss()[k] = new Set();
        for (const v of vals) ss()[k].add(v);
        return vals.length;
      },
      sRem: async (k: string, v: string) => ss()[k]?.delete(v) ? 1 : 0,
      sIsMember: async (k: string, v: string) => ss()[k]?.has(v) ?? false,
      sMembers: async (k: string) => (ss()[k] ? [...ss()[k]] : []),
      incrBy: async (k: string, n: number) => {
        const v = Number.parseInt(kv()[k] || "0") + n;
        kv()[k] = String(v);
        return v;
      },
      watch: async () => {},
      multi: makeMulti,
      expire: async () => 1,
      setNX: async (k: string, v: string) => {
        if (kv()[k]) return false;
        kv()[k] = v;
        return true;
      },
      zScore: async () => null,
      zAdd: async () => 1,
      zCard: async () => 0,
      zRemRangeByRank: async () => 0,
      keys: async (pattern: string) => {
        const ss = globalThis.__testStore.setStore;
        const prefix = pattern.replace("*", "");
        return Object.keys(ss).filter((k) => k.startsWith(prefix));
      },
      type: async (k: string) => {
        if (globalThis.__testStore.setStore[k]) return "set";
        if (globalThis.__testStore.listStore[k]) return "list";
        if (globalThis.__testStore.kvStore[k] !== undefined) return "string";
        return "none";
      },
    },
    g, s, gf,
    ga: async () => null,
    archive: { lRange: async () => [] },
  };
});

mock.module("$config", () => ({
  default: {
    bitcoin: { host: "localhost", wallet: "test", user: "u", password: "p", network: "regtest", port: 18443 },
    liquid: { host: "localhost", wallet: "test", user: "u", password: "p", btc: "test-asset", port: 7040 },
    lightning: "/dev/null",
    fee: { bitcoin: 0.004, liquid: 0.001, lightning: 0.001 },
    adminpass: "test",
    ark: { arkPrivateKey: "0000", arkServerUrl: "http://localhost" },
    nostr: "ws://localhost:7777",
    tigerbeetle: { cluster_id: 0n, replica_addresses: ["localhost:3000"] },
    vapid: { pk: "test", sk: "test" },
    support: "test@test.com",
    txWebhookSecret: "test",
  },
}));

mock.module("$lib/tb", () => ({
  getBalance: mock(async () => 10_000_000),
  getCredit: mock(async () => 0),
  tbDebit: mock(async () => 0),
  tbCredit: mock(async () => undefined),
  tbRefund: mock(async () => undefined),
  tbReverse: mock(async () => undefined),
  tbConfirm: mock(async () => undefined),
  tbSetBalance: mock(async () => undefined),
  tbSetPending: mock(async () => undefined),
  fundDebit: mock(async () => ({ err: null })),
  initTigerBeetle: mock(async () => {}),
}));

mock.module("$lib/ln", () => ({
  default: {
    decode: mock(async () => ({ type: "bolt11", amount_msat: 1_000_000, payee: "test-payee" })),
    listpeerchannels: mock(async () => ({ channels: [] })),
    listpays: mock(async () => ({ pays: [] })),
    xpay: mock(async () => ({ amount_sent_msat: 1_000_000, payment_preimage: "preimage-abc" })),
    getinfo: mock(async () => ({ id: "our-node-id" })),
    listinvoices: mock(async () => ({ invoices: [] })),
    listfunds: mock(async () => ({ channels: [] })),
    keysend: mock(async () => ({})),
    fetchinvoice: mock(async () => ({})),
    sendinvoice: mock(async () => ({})),
  },
}));

mock.module("$lib/logging", () => ({ l: () => {}, warn: mock(() => {}), err: () => {} }));
mock.module("$lib/notifications", () => ({ notify: () => {}, nwcNotify: () => {} }));
mock.module("$lib/webhooks", () => ({ callWebhook: mock(() => {}) }));
mock.module("$lib/sockets", () => ({ emit: mock(() => {}), sendHeartbeat: () => {} }));
mock.module("$lib/esplora", () => ({
  btcNetwork: { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  hdVersions: { private: 0x04358394, public: 0x043587cf },
  getAddressTxs: mock(async (address: string) => {
    const txs = globalThis.__testStore.esploraOverride?.addressTxs?.[address];
    return txs || [];
  }),
  getTxStatus: mock(async (txid: string) => {
    const status = globalThis.__testStore.esploraOverride?.txStatus?.[txid];
    return status || { confirmed: false };
  }),
  getAddressUtxos: mock(async () => []),
  getUtxos: mock(async () => []),
  getTxHex: mock(async () => ""),
  getTx: mock(async () => ({})),
  broadcastTx: mock(async () => ({})),
  getFeeEstimates: mock(async () => ({})),
  deriveAddress: mock(() => ({ address: "bcrt1qmock" })),
  deriveAddresses: mock(() => []),
  parseDescriptor: mock(() => ({})),
  findLastUsedIndex: mock(async () => -1),
}));
mock.module("$lib/square", () => ({ squarePayment: () => {} }));
mock.module("$lib/nostr", () => ({
  handleZap: async () => {}, publish: async () => {},
  serverPubkey: "m", serverPubkey2: "m", serverSecret: "m", serverSecret2: "m",
}));
mock.module("$lib/mqtt", () => ({ default: { publish: () => {} } }));
mock.module("$lib/ark", () => ({
  getArkAddress: async () => "ark-addr", sendArk: async () => "ark-txid", getArkBalance: async () => 0, verifyArkVtxo: async () => true,
}));
mock.module("$lib/ecash", () => ({ request: async () => ({}) }));
mock.module("$lib/lightning", () => ({
  replay: async () => ({}), fixBolt12: () => {}, listenForLightning: () => {},
}));
mock.module("$lib/mail", () => ({ mail: async () => {}, templates: {} }));
mock.module("$lib/auth", () => ({
  requirePin: async () => {}, auth: (_r: any, _s: any, n: any) => n(), optional: (_r: any, _s: any, n: any) => n(), admin: (_r: any, _s: any, n: any) => n(),
}));
mock.module("$lib/invoices", () => ({
  generate: mock(async ({ invoice, user }: any) => ({
    id: "gen-inv", hash: "gen-hash", uid: user?.id, received: 0, pending: 0, ...invoice,
  })),
}));
mock.module("$lib/api", () => ({ default: { bitcoin: "http://localhost", liquid: "http://localhost" } }));
mock.module("$lib/store", () => ({ default: { rates: { USD: 50000 } } }));
mock.module("@coinos/rpc", () => ({
  default: () => new Proxy({}, {
    get: (_target, prop) => async (...args: any[]) => {
      const override = globalThis.__testStore.rpcOverride;
      if (override && typeof override[prop] === "function") {
        return override[prop](...args);
      }
      return {};
    },
  }),
}));

mock.module("$lib/utils", () => {
  const SATS = 100_000_000;
  const kv = () => globalThis.__testStore.kvStore;
  return {
    SATS,
    btc: (n: number) => Number.parseFloat((n / SATS).toFixed(8)),
    fail: (msg: string) => { throw new Error(msg); },
    fmt: (n: number) => String(n),
    formatReceipt: () => {},
    getInvoice: async (hash: string) => {
      const raw = kv()[`invoice:${hash}`] ?? null;
      if (!raw) return null;
      let iid;
      try { iid = JSON.parse(raw); } catch { iid = raw; }
      if (iid?.id) iid = iid.id;
      else if (iid?.hash) iid = iid.hash;
      const raw2 = kv()[`invoice:${iid}`] ?? null;
      if (!raw2) return null;
      try { return JSON.parse(raw2); } catch { return raw2; }
    },
    getPayment: async (id: string) => {
      const raw = kv()[`payment:${id}`];
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") {
          const p = kv()[`payment:${parsed}`];
          return p ? JSON.parse(p) : null;
        }
        return parsed;
      } catch { return null; }
    },
    getUser: async (username: string) => {
      const raw = kv()[`user:${username}`];
      return raw ? JSON.parse(raw) : null;
    },
    getAccount: async () => null,
    link: (id: string) => `http://test/${id}`,
    sats: (n: number) => Math.round(n * SATS),
    sleep: async () => {},
    t: () => ({ insufficientFunds: "Insufficient funds" }),
    bail: (res: any, msg: string) => res.code(500).send(msg),
    bip21: () => "",
    fields: [],
    nada: () => {},
    fiat: (n: number, r: number) => (n * r) / SATS,
    f: (s: any) => String(s),
    pick: (O: any, K: string[]) => K.reduce((o: any, k: string) => ((o[k] = O[k]), o), {}),
    prod: false,
    uniq: (a: any[], k: any) => [...new Map(a.map((x: any) => [k(x), x])).values()],
    wait: async () => {},
    time: () => ({ start: () => {}, end: () => {} }),
  };
});
