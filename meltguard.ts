// meltguard — out-of-band spend limiter for the panic-mode mint.
//
// Sits INLINE between the mint and cl's CLNRest: the mint is pointed at
// MINT_CLNREST_URL=http://meltguard:3011 instead of http://cl:3010. Every melt
// is a POST /v1/pay; the guard decodes the invoice amount (via cl's own /v1/decode,
// so no hand-rolled bolt11 parsing) and enforces two caps the mint cannot bypass —
// even if panic mode has a bug or the mint is compromised, it physically cannot
// move money except through this guard:
//
//   1. PER-MELT CAP   — reject any single pay over MELT_MAX_SAT (default 1,000,000).
//   2. CUMULATIVE FREEZE — track total successfully paid; once it would exceed
//      MELT_CUM_MAX_SAT (default 3,000,000), write a STICKY freeze flag and reject
//      ALL further pays until an operator reviews and clears it.
//
// State lives in plain files OUTSIDE any db (like the nobal failsafe), so a db
// compromise can't move them and a restart can't forget them.
//
// Everything that is not POST /v1/pay is proxied through untouched, so mint
// startup (getinfo, listinvoices, waitanyinvoice, invoice, listpays…) works normally.
//
// Env: CL_URL (http://cl:3010), MELT_MAX_SAT, MELT_CUM_MAX_SAT, GUARD_DIR (/guard),
//      PORT (3011). Run: GUARD_DIR=./guard bun meltguard.ts
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "fs";

const CL = process.env.CL_URL || "http://cl:3010";
const PER = Number(process.env.MELT_MAX_SAT || 1_000_000);
const CUM = Number(process.env.MELT_CUM_MAX_SAT || 3_000_000);
const DIR = process.env.GUARD_DIR || "/guard";
const PORT = Number(process.env.PORT || 3011);
mkdirSync(DIR, { recursive: true });
const CUM_FILE = `${DIR}/cumulative_sat`;
const FROZEN_FILE = `${DIR}/FROZEN`;
const LOG = `${DIR}/meltguard.log`;

const readCum = () => (existsSync(CUM_FILE) ? Number(readFileSync(CUM_FILE, "utf8").trim()) || 0 : 0);
const writeCum = (n: number) => writeFileSync(CUM_FILE, String(n));
const isFrozen = () => existsSync(FROZEN_FILE);
const log = (m: string) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {} console.error("meltguard:", m); };
const freeze = (why: string) => { writeFileSync(FROZEN_FILE, why + "\n"); log(`FROZEN — ${why} — operator must review and clear ${FROZEN_FILE}`); };
const err = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });

async function decodeSat(bolt11: string, rune: string | null): Promise<number | null> {
  try {
    const r = await fetch(`${CL}/v1/decode`, { method: "POST", headers: { "content-type": "application/json", ...(rune ? { Rune: rune } : {}) }, body: JSON.stringify({ string: bolt11 }) });
    const j: any = await r.json();
    if (j.amount_msat != null) return Math.ceil(Number(j.amount_msat) / 1000);
    return null; // amountless invoice — no embedded amount to cap on; treat as undecidable
  } catch { return null; }
}

console.log(`meltguard on :${PORT} -> ${CL} | per-melt<=${PER} sat, cumulative freeze at ${CUM} sat | state ${DIR} | frozen=${isFrozen()} cum=${readCum()}`);

Bun.serve({
  port: PORT, hostname: "0.0.0.0", idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const rune = req.headers.get("Rune");
    const isPay = req.method === "POST" && url.pathname === "/v1/pay";

    if (isPay) {
      if (isFrozen()) return err(403, "meltguard: FROZEN — operator review required");
      const body: any = await req.json().catch(() => ({}));
      const amt = await decodeSat(body.bolt11 || "", rune);
      if (amt == null) return err(400, "meltguard: could not determine invoice amount — refusing to forward");
      if (amt > PER) { log(`REJECT per-melt ${amt} > ${PER}`); return err(403, `meltguard: per-melt cap ${PER} sat exceeded (${amt})`); }
      const cum = readCum();
      if (cum + amt > CUM) { freeze(`cumulative ${cum}+${amt} > ${CUM}`); return err(403, `meltguard: cumulative cap ${CUM} sat — FROZEN, operator review required`); }
      // forward the pay; count toward cumulative only if cl reports success
      const resp = await fetch(`${CL}/v1/pay`, { method: "POST", headers: { "content-type": "application/json", ...(rune ? { Rune: rune } : {}) }, body: JSON.stringify(body) });
      const text = await resp.text();
      if (resp.ok) { writeCum(cum + amt); log(`PAID ${amt} sat (cumulative ${cum + amt}/${CUM})`); }
      return new Response(text, { status: resp.status, headers: { "content-type": "application/json" } });
    }

    // transparent proxy for all other CLNRest calls
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const resp = await fetch(`${CL}${url.pathname}${url.search}`, { method: req.method, headers: { ...(req.headers.get("content-type") ? { "content-type": req.headers.get("content-type")! } : {}), ...(rune ? { Rune: rune } : {}) }, body });
    return new Response(await resp.arrayBuffer(), { status: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" } });
  },
});
