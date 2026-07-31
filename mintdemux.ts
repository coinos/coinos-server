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
//        everything else executes on NEW
//   - /v1/checkstate         -> both mints, merged (spent if either says spent)
//   - everything else (swap, mint, restore, mint quote) -> NEW
// The OLD mint also stands alone at mintrecovery.coinos.io (direct).
//
// Env: NEW_MINT (http://mint:3338), OLD_MINT (http://mint-old:3338),
//      LOG_DIR (/demux), PORT (3341)
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
async function fetchKeysets(base: string): Promise<string[]> {
  try { const r = await fetch(`${base}/v1/keysets`); const j: any = await r.json(); return (j.keysets || []).map((k: any) => String(k.id)); }
  catch (e: any) { console.error("keyset fetch failed", base, e.message); return []; }
}
async function refreshKeysets() {
  const [n, o] = await Promise.all([fetchKeysets(NEW), fetchKeysets(OLD)]);
  if (n.length) newKeysets = new Set(n);
  if (o.length) oldKeysets = new Set(o);
}
await refreshKeysets();
setInterval(refreshKeysets, 3600_000);

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

console.log(`mintdemux on :${PORT}  NEW=${NEW} OLD=${OLD}  new=[${[...newKeysets]}] old=[${[...oldKeysets]}]`);

const keysetsInBody = (body: any): string[] => {
  const ids = new Set<string>();
  for (const arr of [body?.inputs, body?.proofs]) if (Array.isArray(arr)) for (const it of arr) { const id = String(it?.id ?? ""); if (id) ids.add(id); }
  return [...ids];
};
const respond = (upstream: Response, text: string) =>
  new Response(text, { status: upstream.status, headers: { ...CORS, "content-type": upstream.headers.get("content-type") || "application/json" } });

async function proxy(base: string, method: string, path: string, body?: ArrayBuffer | string): Promise<Response> {
  const r = await fetch(`${base}${path}`, { method, headers: body != null ? { "content-type": "application/json" } : undefined, body: body as any });
  return respond(r, await r.text());
}

Bun.serve({
  port: PORT, hostname: "0.0.0.0", idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const ps = path + url.search;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // --- GET routes ---
    if (req.method === "GET") {
      if (path === "/v1/keysets") {
        const [rn, ro] = await Promise.all([fetch(`${NEW}/v1/keysets`).then(r => r.json()).catch(() => ({})), fetch(`${OLD}/v1/keysets`).then(r => r.json()).catch(() => ({}))]);
        const seen = new Set<string>(); const keysets: any[] = [];
        for (const k of [...((rn as any).keysets || []), ...((ro as any).keysets || [])]) { const id = String(k.id); if (!seen.has(id)) { seen.add(id); keysets.push(k); } }
        return new Response(JSON.stringify({ keysets }), { headers: J });
      }
      const km = path.match(/^\/v1\/keys\/(.+)$/);
      if (km) return proxy(oldKeysets.has(km[1]) ? OLD : NEW, "GET", ps);
      return proxy(NEW, "GET", ps); // /v1/info, /v1/keys, anything else GET
    }

    // --- POST routes ---
    const raw = await req.arrayBuffer();
    const body = parse(new TextDecoder().decode(raw));

    if (path === "/v1/checkstate") {
      const [rn, ro] = await Promise.all([
        fetch(`${NEW}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: raw }).then(r => r.json()).catch(() => ({ states: [] })),
        fetch(`${OLD}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: raw }).then(r => r.json()).catch(() => ({ states: [] })),
      ]);
      const byY: Record<string, any> = {};
      for (const s of [...((rn as any).states || []), ...((ro as any).states || [])]) { const cur = byY[s.Y]; if (!cur || s.state === "SPENT") byY[s.Y] = s; }
      return new Response(JSON.stringify({ states: Object.values(byY) }), { headers: J });
    }

    if (path === "/v1/melt/quote/bolt11") {
      const r = await fetch(`${NEW}/v1/melt/quote/bolt11`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
      const txt = await r.text(); const j = parse(txt);
      if (r.ok && j?.quote && body?.request) rememberQuote(j.quote, { invoice: body.request, unit: body.unit || "sat", ts: Date.now() });
      return respond(r, txt);
    }

    if (path === "/v1/melt/bolt11") {
      const ids = keysetsInBody(body);
      const hasOld = ids.some(id => oldKeysets.has(id));
      const hasNew = ids.some(id => newKeysets.has(id));
      if (hasOld && hasNew)
        return new Response(JSON.stringify({ detail: "Cannot melt old and new ecash in one operation; melt them separately.", code: 12003 }), { status: 400, headers: J });
      if (hasOld) {
        const info = quoteMem[body.quote];
        if (!info) return new Response(JSON.stringify({ detail: "Melt quote expired or unknown for old-ecash recovery; request a new melt quote and try again.", code: 12004 }), { status: 400, headers: J });
        // re-quote on OLD for the same invoice, then execute there (panic mode gates it)
        const oq = await fetch(`${OLD}/v1/melt/quote/bolt11`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: info.invoice, unit: info.unit }) });
        const oqt = await oq.text(); const oqj = parse(oqt);
        if (!oq.ok || !oqj?.quote) { log(`OLD re-quote failed for melt: ${oqt.slice(0, 120)}`); return respond(oq, oqt); }
        const execBody = JSON.stringify({ ...body, quote: oqj.quote });
        const r = await fetch(`${OLD}/v1/melt/bolt11`, { method: "POST", headers: { "content-type": "application/json" }, body: execBody });
        const txt = await r.text();
        log(`melt->OLD(recovery) keysets=${ids.join(",")} status=${r.status}`);
        return respond(r, txt);
      }
      // new (or unknown) keysets -> NEW
      return proxy(NEW, "POST", ps, raw);
    }

    // swap, mint, mint/quote, restore, everything else -> NEW (normal ops)
    return proxy(NEW, "POST", ps, raw);
  },
});
