// mintdemux — sits in front of the OLD (panic-mode) mint at mint.coinos.io.
//
// After the 2026-07-30 hostname swap, wallets that minted at the NEW mint during
// its ~1 day at mint.coinos.io still point here. Their proofs reference the new
// mint's keysets, which the old mint doesn't know — instead of a cryptic
// "keyset unknown" they get a clear tell-them-where-to-go error, and each hit is
// logged so we can size the cohort.
//
// Everything else is proxied through to the old mint untouched.
//
// Env: OLD_MINT (http://mint-old:3338), NEW_MINT (http://mint:3338),
//      LOG_DIR (/demux), PORT (3341)
import { appendFileSync, mkdirSync } from "fs";

const OLD = process.env.OLD_MINT || "http://mint-old:3338";
const NEW = process.env.NEW_MINT || "http://mint:3338";
const DIR = process.env.LOG_DIR || "/demux";
const PORT = Number(process.env.PORT || 3341);
mkdirSync(DIR, { recursive: true });

const REDIRECT_DETAIL =
  "This ecash is from the current coinos mint, not the old one. " +
  "Change this mint's URL in your wallet to https://newmint.coinos.io and try again. " +
  "(mint.coinos.io now serves only pre-2026-07-20 ecash recovery)";

// keyset ids of the NEW mint; refreshed hourly in case it rotates
let newKeysets = new Set<string>();
async function refreshKeysets() {
  try {
    const r = await fetch(`${NEW}/v1/keysets`);
    const j: any = await r.json();
    const ids = (j.keysets || []).map((k: any) => String(k.id));
    if (ids.length) newKeysets = new Set(ids);
  } catch (e: any) {
    console.error("keyset refresh failed:", e.message);
  }
}
await refreshKeysets();
setInterval(refreshKeysets, 3600_000);
console.log(`mintdemux on :${PORT} -> ${OLD} | new-mint keysets: [${[...newKeysets].join(", ")}]`);

const log = (m: string) => {
  try { appendFileSync(`${DIR}/newmint-hits.log`, `${new Date().toISOString()} ${m}\n`); } catch {}
  console.log("demux:", m);
};

// endpoints whose bodies carry proof/output keyset ids worth inspecting
const INSPECT = new Set(["/v1/swap", "/v1/melt/bolt11", "/v1/restore", "/v1/mint/bolt11"]);

function findNewMintIds(body: any): string[] {
  const ids = new Set<string>();
  for (const arr of [body?.inputs, body?.outputs, body?.proofs]) {
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      const id = String(it?.id ?? "");
      if (newKeysets.has(id)) ids.add(id);
    }
  }
  return [...ids];
}

Bun.serve({
  port: PORT, hostname: "0.0.0.0", idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && INSPECT.has(url.pathname)) {
      const raw = await req.arrayBuffer();
      let body: any = {};
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch {}
      const hit = findNewMintIds(body);
      if (hit.length) {
        const n = (body.inputs || body.proofs || body.outputs || []).length;
        log(`${url.pathname} blocked: ${n} items on new-mint keyset(s) ${hit.join(",")} ua="${req.headers.get("user-agent") || "?"}"`);
        return new Response(JSON.stringify({ detail: REDIRECT_DETAIL, code: 12002 }),
          { status: 400, headers: { "content-type": "application/json" } });
      }
      const resp = await fetch(`${OLD}${url.pathname}${url.search}`, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") || "application/json" },
        body: raw,
      });
      return new Response(await resp.arrayBuffer(), { status: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" } });
    }

    // transparent proxy for everything else
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const resp = await fetch(`${OLD}${url.pathname}${url.search}`, {
      method: req.method,
      headers: { ...(req.headers.get("content-type") ? { "content-type": req.headers.get("content-type")! } : {}) },
      body,
    });
    return new Response(await resp.arrayBuffer(), { status: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" } });
  },
});
