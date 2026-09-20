// mintdemux — transparent two-mint front for mint.coinos.io.
//
// Primary is the current mint (NEW: fresh keys, fully normal). The retired mint
// (OLD: panic mode, recovery-only) is fronted transparently so wallets still
// holding pre-2026-07-20 ecash can MELT it at mint.coinos.io without changing
// their mint URL. Routing:
//   - /v1/keysets            -> UNION of both mints' keysets (wallet sees old + new)
//   - /v1/keys/<id>          -> the mint that owns that keyset
//   - /v1/info, /v1/keys     -> NEW (primary identity + active keys)
//   - /v1/melt/quote/bolt11  -> NEW; remember the invoice keyed by the quote id
//   - /v1/melt/bolt11        -> routed by the submitted proofs' keyset: OLD-keyset
//        proofs get a fresh OLD melt quote (from the remembered invoice) and are
//        executed on OLD (where panic mode blocks blacklisted attacker ecash);
//        change outputs are STRIPPED on that path (wallets blind them to the NEW
//        active keyset, which OLD can't sign — OLD would reject the whole melt),
//        and the OLD quote id in the response is mapped back to the caller's;
//        everything else executes on NEW
//   - GET /v1/melt/quote/bolt11/<id> -> OLD (id rewritten) if that melt was
//        executed on OLD, else NEW — so wallets can poll a recovery melt
//   - /v1/checkstate         -> both mints, merged (spent if either says spent)
//   - /v1/ws                 -> websocket proxy to NEW (subscriptions)
//   - everything else (swap, mint, restore, mint quote) -> NEW
// The OLD mint also stands alone at mintrecovery.coinos.io (direct).
//
// Client-IP forwarding: cloudflared stamps cf-connecting-ip on every request;
// demux forwards it upstream so the mints' per-IP rate limiter buckets by the
// real client instead of lumping all of mint.coinos.io into demux's socket IP.
// Partner hosts that funnel many end users through one IP (lightning-address
// aggregators etc.) can be listed in <LOG_DIR>/whitelist.json:
//   { "ips": ["1.2.3.4", "2600:..."], "pool": 10 }
// Their bucket key rotates across <pool> synthetic keys, so their effective
// allowance is pool x the mint's per-IP limit. Reloaded every 60s, no restart.
//
// Env: NEW_MINT (http://mint:3338), OLD_MINT (http://mint-old:3338),
//      LOG_DIR (/demux), PORT (3341)
import { createHash } from "crypto";
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "fs";

const NEW = process.env.NEW_MINT || "http://mint:3338";
const OLD = process.env.OLD_MINT || "http://mint-old:3338";
const DIR = process.env.LOG_DIR || "/demux";
const PORT = Number(process.env.PORT || 3341);
mkdirSync(DIR, { recursive: true });

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*",
};
const J = { ...CORS, "content-type": "application/json" };
const log = (m: string) => { try { appendFileSync(`${DIR}/demux.log`, `${new Date().toISOString()} ${m}\n`); } catch {} console.log("demux:", m); };
const parse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

// --- keyset ownership, refreshed hourly ---
let newKeysets = new Set<string>();
let oldKeysets = new Set<string>();
// Our own hourly routing refresh — forwarded as loopback so the mints' per-IP
// limiter (which exempts 127.0.0.1) doesn't count it against the demux socket.
const lastKeysets: { NEW?: any[]; OLD?: any[] } = {};
async function fetchKeysets(base: string): Promise<any[]> {
  try {
    const r = await fetch(`${base}/v1/keysets`, { headers: { "cf-connecting-ip": "127.0.0.1" } });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j: any = await r.json(); return (j.keysets || []) as any[];
  }
  catch (e: any) { console.error("keyset fetch failed", base, e.message); return []; }
}
async function refreshKeysets() {
  const [n, o] = await Promise.all([fetchKeysets(NEW), fetchKeysets(OLD)]);
  // This refresh is exempt from the mints' per-IP limiter (loopback key), so it
  // also seeds the last-good lists the client-facing /v1/keysets falls back on
  // when a wallet's own fetch is rate-limited — otherwise a demux restart could
  // serve a list with no old keysets in it until some client fetch succeeded.
  if (n.length) { newKeysets = new Set(n.map((k: any) => String(k.id))); lastKeysets.NEW = n; }
  if (o.length) { oldKeysets = new Set(o.map((k: any) => String(k.id))); lastKeysets.OLD = o; }
}
await refreshKeysets();
setInterval(refreshKeysets, 3600_000);
// Empty routing tables are dangerous: with no old keysets every old-ecash melt
// looks new and goes to the wrong mint. A restart that races the mints coming
// up (a compose restart of both) leaves exactly that, so retry every 15s until
// both sides are known instead of waiting out the hour.
const warmup = setInterval(async () => {
  if (newKeysets.size && oldKeysets.size) return clearInterval(warmup);
  await refreshKeysets();
  if (newKeysets.size && oldKeysets.size) { clearInterval(warmup); log(`keysets warmed: new=[${[...newKeysets]}] old=[${[...oldKeysets]}]`); }
}, 15_000);

// --- melt quote -> invoice memory (so an OLD-keyset melt can be re-quoted on OLD) ---
const QFILE = `${DIR}/meltquotes.json`;
type QInfo = { invoice: string; unit: string; ts: number };
let quoteMem: Record<string, QInfo> = {};
if (existsSync(QFILE)) quoteMem = parse(readFileSync(QFILE, "utf8")) || {};
const QTTL = 2 * 3600_000;
function rememberQuote(id: string, info: QInfo) {
  quoteMem[id] = info;
  const cut = Date.now() - QTTL;
  for (const k of Object.keys(quoteMem)) if ((quoteMem[k].ts || 0) < cut) delete quoteMem[k];
  try { writeFileSync(QFILE, JSON.stringify(quoteMem)); } catch {}
}

// --- NEW-quote-id -> OLD-quote-id map for melts executed on OLD, so status
// polls (GET /v1/melt/quote/bolt11/<id>) can be routed to the mint that ran
// the melt. Kept long: a pending lightning payment can be polled much later.
const MFILE = `${DIR}/oldmelts.json`;
type MInfo = { old: string; ts: number };
let oldMelts: Record<string, MInfo> = {};
if (existsSync(MFILE)) oldMelts = parse(readFileSync(MFILE, "utf8")) || {};
const MTTL = 7 * 24 * 3600_000;
function rememberOldMelt(newId: string, oldId: string) {
  oldMelts[newId] = { old: oldId, ts: Date.now() };
  const cut = Date.now() - MTTL;
  for (const k of Object.keys(oldMelts)) if ((oldMelts[k].ts || 0) < cut) delete oldMelts[k];
  try { writeFileSync(MFILE, JSON.stringify(oldMelts)); } catch {}
}

// --- dropped old inputs (mixed melts) ---
// The wallet treats these as spent; the mint never took them, so they sit
// UNSPENT on OLD forever. Keep an accounting trail: the Y (hash of the secret)
// identifies a proof to the mint without storing the bearer secret itself.
const DFILE = `${DIR}/dropped-old-inputs.jsonl`;
function recordDropped(proofs: any[], ctx: { ip: string; quote: string }) {
  for (const p of proofs) {
    try {
      const y = createHash("sha256").update(String(p?.secret ?? "")).digest("hex");
      appendFileSync(DFILE, JSON.stringify({
        ts: new Date().toISOString(), ...ctx,
        id: p?.id, amount: p?.amount, secret_sha256: y, dleq: !!p?.dleq,
      }) + "\n");
    } catch {}
  }
}

// --- client-ip forwarding + partner whitelist ---
const WFILE = `${DIR}/whitelist.json`;
let wlIps = new Set<string>();
let wlPool = 10;
function loadWhitelist() {
  if (!existsSync(WFILE)) return;
  const j = parse(readFileSync(WFILE, "utf8"));
  if (!j) return;
  if (Array.isArray(j.ips)) wlIps = new Set(j.ips.map((s: any) => String(s).toLowerCase()));
  if (Number.isFinite(j.pool) && j.pool >= 1) wlPool = Math.floor(j.pool);
}
loadWhitelist();
setInterval(loadWhitelist, 60_000);

const wlCounters: Record<string, number> = {};
function bucketKey(req: Request): string {
  const ip = (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
  ).toLowerCase();
  if (!ip || !wlIps.has(ip)) return ip;
  const n = (wlCounters[ip] = ((wlCounters[ip] || 0) + 1) % wlPool);
  return `${ip}#${n}`;
}
// headers for an upstream fetch: json content-type when a body is sent, and
// the client bucket key as cf-connecting-ip (checked first by the mint's
// rate limiter; the raw socket IP is used when we have nothing to forward)
const fwd = (key: string, hasBody = false): Record<string, string> => ({
  ...(hasBody ? { "content-type": "application/json" } : {}),
  ...(key ? { "cf-connecting-ip": key } : {}),
});

console.log(`mintdemux on :${PORT}  NEW=${NEW} OLD=${OLD}  new=[${[...newKeysets]}] old=[${[...oldKeysets]}]  whitelist=[${[...wlIps]}] pool=${wlPool}`);

const keysetsInBody = (body: any): string[] => {
  const ids = new Set<string>();
  for (const arr of [body?.inputs, body?.proofs]) if (Array.isArray(arr)) for (const it of arr) { const id = String(it?.id ?? ""); if (id) ids.add(id); }
  return [...ids];
};
const respond = (upstream: Response, text: string) =>
  new Response(text, { status: upstream.status, headers: { ...CORS, "content-type": upstream.headers.get("content-type") || "application/json" } });

async function proxy(base: string, method: string, path: string, body?: ArrayBuffer | string, headers?: Record<string, string>): Promise<Response> {
  const r = await fetch(`${base}${path}`, { method, headers, body: body as any });
  return respond(r, await r.text());
}

const WSNEW = NEW.replace(/^http/, "ws");
type WsData = { key: string; up?: WebSocket; q: (string | Uint8Array)[] };

Bun.serve({
  port: PORT, hostname: "0.0.0.0", idleTimeout: 0,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const ps = path + url.search;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const key = bucketKey(req);

    if (path === "/v1/ws") {
      if (server.upgrade(req, { data: { key, q: [] } as WsData })) return undefined as any;
      return new Response(JSON.stringify({ detail: "websocket upgrade required" }), { status: 400, headers: J });
    }

    // --- GET routes ---
    if (req.method === "GET") {
      if (path === "/v1/keysets") {
        // Forward the client's bucket key: without it every wallet's keyset
        // fetch counted against the demux's own socket IP at both mints, the
        // shared 60/min bucket tripped, and the swallowed 429s came back to
        // every wallet as an empty keyset list. A failed upstream now serves
        // that mint's last-good list instead.
        const get = async (base: string) => {
          const r = await fetch(`${base}/v1/keysets`, { headers: fwd(key) });
          if (!r.ok) throw new Error(`status ${r.status}`);
          return (await r.json() as any).keysets as any[];
        };
        const [rn, ro] = await Promise.all([
          get(NEW).then(k => (lastKeysets.NEW = k), e => { console.error("keysets NEW", e.message); return lastKeysets.NEW; }),
          get(OLD).then(k => (lastKeysets.OLD = k), e => { console.error("keysets OLD", e.message); return lastKeysets.OLD; }),
        ]);
        if (!rn && !ro) return new Response(JSON.stringify({ detail: "keysets unavailable" }), { status: 503, headers: J });
        const seen = new Set<string>(); const keysets: any[] = [];
        // NEW mint keysets keep their flags. OLD (recovery) keysets are forced
        // active:false — they're redeem/melt-only, so wallets never mint or swap
        // into them. Prevents advertising two active "sat" keysets at
        // mint.coinos.io (the old mint is panic-locked anyway; this is the
        // client-facing view).
        for (const k of (rn || [])) { const id = String(k.id); if (!seen.has(id)) { seen.add(id); keysets.push(k); } }
        for (const k of (ro || [])) { const id = String(k.id); if (!seen.has(id)) { seen.add(id); keysets.push({ ...k, active: false }); } }
        return new Response(JSON.stringify({ keysets }), { headers: J });
      }
      const km = path.match(/^\/v1\/keys\/(.+)$/);
      if (km) return proxy(oldKeysets.has(km[1]) ? OLD : NEW, "GET", ps, undefined, fwd(key));
      const qm = path.match(/^\/v1\/melt\/quote\/bolt11\/([^/]+)$/);
      if (qm && oldMelts[qm[1]]) {
        const r = await fetch(`${OLD}/v1/melt/quote/bolt11/${oldMelts[qm[1]].old}`, { headers: fwd(key) });
        const txt = await r.text(); const j = parse(txt);
        if (j?.quote) j.quote = qm[1]; // caller knows its own id, not OLD's
        return new Response(j ? JSON.stringify(j) : txt, { status: r.status, headers: J });
      }
      return proxy(NEW, "GET", ps, undefined, fwd(key)); // /v1/info, /v1/keys, anything else GET
    }

    // --- POST routes ---
    const raw = await req.arrayBuffer();
    const body = parse(new TextDecoder().decode(raw));

    if (path === "/v1/checkstate") {
      const [rn, ro] = await Promise.all([
        fetch(`${NEW}/v1/checkstate`, { method: "POST", headers: fwd(key, true), body: raw }).then(r => r.json()).catch(() => ({ states: [] })),
        fetch(`${OLD}/v1/checkstate`, { method: "POST", headers: fwd(key, true), body: raw }).then(r => r.json()).catch(() => ({ states: [] })),
      ]);
      const byY: Record<string, any> = {};
      for (const s of [...((rn as any).states || []), ...((ro as any).states || [])]) { const cur = byY[s.Y]; if (!cur || s.state === "SPENT") byY[s.Y] = s; }
      return new Response(JSON.stringify({ states: Object.values(byY) }), { headers: J });
    }

    if (path === "/v1/melt/quote/bolt11") {
      const r = await fetch(`${NEW}/v1/melt/quote/bolt11`, { method: "POST", headers: fwd(key, true), body: raw });
      const txt = await r.text(); const j = parse(txt);
      if (r.ok && j?.quote && body?.request) rememberQuote(j.quote, { invoice: body.request, unit: body.unit || "sat", ts: Date.now() });
      return respond(r, txt);
    }

    if (path === "/v1/melt/bolt11") {
      const ids = keysetsInBody(body);
      const hasOld = ids.some(id => oldKeysets.has(id));
      const hasNew = ids.some(id => newKeysets.has(id));
      // Mixed selection: a wallet holding leftovers of both eras picks some of
      // each, and the two mints can't co-sign one melt. Rejecting it (the old
      // 12003) left such wallets permanently stuck — the auditor's among them,
      // which is why mint.coinos.io reads "offline". Drop the OLD inputs and
      // melt the NEW ones alone: the old proofs stay UNSPENT at the old mint,
      // but the wallet will consider them spent, so record what was dropped.
      // Old ecash is only redeemable through the panic-mode recovery path
      // anyway (it needs DLEQ + blinding factor, which these inputs lack).
      if (hasOld && hasNew) {
        const ip = req.headers.get("cf-connecting-ip") || "";
        const keep = (arr: any[]) => arr.filter((p: any) => !oldKeysets.has(String(p?.id)));
        const dropped = (body.inputs || []).filter((p: any) => oldKeysets.has(String(p?.id)));
        recordDropped(dropped, { ip, quote: String(body.quote || "") });
        const merged = { ...body, inputs: keep(body.inputs || []) };
        const r = await proxy(NEW, "POST", ps, JSON.stringify(merged), fwd(key, true));
        log(`melt mixed: dropped ${dropped.length} old input(s) worth ${dropped.reduce((a: number, p: any) => a + (p?.amount || 0), 0)} sat, melted ${merged.inputs.length} new on NEW status=${r.status} ip=${ip}`);
        return r;
      }
      if (hasOld) {
        const ip = req.headers.get("cf-connecting-ip") || "";
        const info = quoteMem[body.quote];
        if (!info) { log(`melt->OLD refused (quote unknown/expired) keysets=${ids.join(",")} ip=${ip}`); return new Response(JSON.stringify({ detail: "Melt quote expired or unknown for old-ecash recovery; request a new melt quote and try again.", code: 12004 }), { status: 400, headers: J }); }
        // re-quote on OLD for the same invoice, then execute there (panic mode gates it)
        const oq = await fetch(`${OLD}/v1/melt/quote/bolt11`, { method: "POST", headers: fwd(key, true), body: JSON.stringify({ request: info.invoice, unit: info.unit }) });
        const oqt = await oq.text(); const oqj = parse(oqt);
        if (!oq.ok || !oqj?.quote) { log(`OLD re-quote failed for melt: ${oqt.slice(0, 120)}`); return respond(oq, oqt); }
        rememberOldMelt(String(body.quote), String(oqj.quote));
        // Strip change outputs: wallets blind them to the NEW active keyset,
        // which OLD doesn't know and rejects before even reading the proofs
        // ("keyset id unknown"). Recovery melts forfeit fee-return change.
        const { outputs, ...bodyNoChange } = body;
        const r = await fetch(`${OLD}/v1/melt/bolt11`, { method: "POST", headers: fwd(key, true), body: JSON.stringify({ ...bodyNoChange, quote: oqj.quote }) });
        const txt = await r.text(); const j = parse(txt);
        log(`melt->OLD(recovery) keysets=${ids.join(",")} status=${r.status} ip=${ip}${outputs ? " outputs-stripped" : ""}`);
        if (j?.quote) { j.quote = String(body.quote); return new Response(JSON.stringify(j), { status: r.status, headers: J }); }
        return respond(r, txt);
      }
      // new (or unknown) keysets -> NEW
      return proxy(NEW, "POST", ps, raw, fwd(key, true));
    }

    // swap, mint, mint/quote, restore, everything else -> NEW (normal ops)
    return proxy(NEW, "POST", ps, raw, fwd(key, true));
  },
  // --- /v1/ws: pipe each client websocket to its own upstream connection on
  // NEW, forwarding the bucket key so the mint's ws limiter sees the client ---
  websocket: {
    open(ws) {
      const data = ws.data as WsData;
      const up = new WebSocket(`${WSNEW}/v1/ws`, { headers: fwd(data.key) } as any);
      data.up = up;
      up.onopen = () => { for (const m of data.q) up.send(m); data.q = []; };
      up.onmessage = (e) => { try { ws.send(e.data as any); } catch {} };
      up.onclose = () => { try { ws.close(); } catch {} };
      up.onerror = () => { try { ws.close(); } catch {} };
    },
    message(ws, msg) {
      const data = ws.data as WsData;
      if (data.up && data.up.readyState === 1) data.up.send(msg as any);
      else data.q.push(msg as any);
    },
    close(ws) {
      try { (ws.data as WsData).up?.close(); } catch {}
    },
  },
});
