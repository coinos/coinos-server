// meltguard — out-of-band spend limiter for the panic-mode mint.
//
// Sits INLINE between the mint and cl's CLNRest: the mint is pointed at
// MINT_CLNREST_URL=http://meltguard:3011 instead of http://cl:3010. Every melt
// is a POST /v1/pay or /v1/xpay; the guard decodes the invoice amount (via cl's own /v1/decode,
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
// Everything that is not POST /v1/pay|/v1/xpay is proxied through untouched, so mint
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
    // nutshell >= 0.20.3.1 CLNRestWallet pays via /v1/xpay (form field `invstring`,
    // `maxfee`); older versions used /v1/pay (`bolt11`/`invoice`). Guard both, so a
    // backend switch can never route a melt around the caps.
    const isXpay = req.method === "POST" && url.pathname === "/v1/xpay";
    const isPay = isXpay || (req.method === "POST" && url.pathname === "/v1/pay");

    if (isPay) {
      if (isFrozen()) return err(403, "meltguard: FROZEN — operator review required");
      // nutshell's CoreLightningRestWallet (mint-old) posts /v1/pay FORM-encoded
      // with the invoice under `invoice` (old c-lightning-REST dialect); the newer
      // CLNRestWallet uses `bolt11`. Parse form first, fall back to JSON, and
      // accept either field name. (Prior code did req.json()+body.bolt11 only, so
      // it never parsed the mint's form body -> every old-ecash melt was rejected
      // at the amount check.)
      const raw = await req.text();
      let invoice = "";
      const extra: Record<string, string> = {};
      try {
        const p = new URLSearchParams(raw);
        if ([...p.keys()].length) {
          invoice = p.get("invstring") || p.get("invoice") || p.get("bolt11") || "";
          for (const [k, v] of p) if (k !== "invoice" && k !== "bolt11" && k !== "invstring") extra[k] = v;
        }
      } catch {}
      if (!invoice) {
        try {
          const j = JSON.parse(raw);
          invoice = j.invstring || j.bolt11 || j.invoice || "";
          for (const k of Object.keys(j)) if (k !== "invoice" && k !== "bolt11" && k !== "invstring") extra[k] = String(j[k]);
        } catch {}
      }
      const amt = await decodeSat(invoice, rune);
      if (amt == null) return err(400, "meltguard: could not determine invoice amount — refusing to forward");
      if (amt > PER) { log(`REJECT per-melt ${amt} > ${PER}`); return err(403, `meltguard: per-melt cap ${PER} sat exceeded (${amt})`); }
      const cum = readCum();
      if (cum + amt > CUM) { freeze(`cumulative ${cum}+${amt} > ${CUM}`); return err(403, `meltguard: cumulative cap ${CUM} sat — FROZEN, operator review required`); }
      // forward to cl (official CLNREST) as FORM on the SAME endpoint the mint
      // called (`invstring` for xpay, `bolt11` for pay), preserving the mint's
      // other params (maxfee / maxfeepercent / exemptfee). Count cumulative only
      // on cl-reported success.
      const fwd = new URLSearchParams(isXpay ? { invstring: invoice, ...extra } : { bolt11: invoice, ...extra });
      const resp = await fetch(`${CL}${isXpay ? "/v1/xpay" : "/v1/pay"}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(rune ? { Rune: rune } : {}) }, body: fwd.toString() });
      const text = await resp.text();
      if (resp.ok) { writeCum(cum + amt); log(`PAID ${amt} sat via ${isXpay ? "xpay" : "pay"} (cumulative ${cum + amt}/${CUM})`); }
      return new Response(text, { status: resp.status, headers: { "content-type": "application/json" } });
    }

    // transparent proxy for all other CLNRest calls
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const resp = await fetch(`${CL}${url.pathname}${url.search}`, { method: req.method, headers: { ...(req.headers.get("content-type") ? { "content-type": req.headers.get("content-type")! } : {}), ...(rune ? { Rune: rune } : {}) }, body });
    return new Response(await resp.arrayBuffer(), { status: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" } });
  },
});
