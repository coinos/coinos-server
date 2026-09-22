import config from "$config";
import { g } from "$lib/db";
import ln from "$lib/ln";
import { warn } from "$lib/logging";
import { PaymentType } from "$lib/types";
import { fail } from "$lib/utils";
import { v4 } from "uuid";

// Up-front routing-fee quotes for lightning sends.
//
// xpay routes with askrene's `getroutes`, so asking askrene the same question
// before we debit tells us exactly what the payment will cost — instead of
// reserving a guessed maxfee and refunding the unused part afterwards. We
// mirror what xpay does in plugins/xpay/xpay.c (v26.06): a throwaway private
// layer carrying the invoice's route hints (bolt11) or blinded paths (bolt12,
// via a fake destination node), then getroutes over the same layer stack in
// the same order (auto.localchans, auto.sourcefree, xpay, private, user).

// xpay's fake destination for blinded paths (xpay.c: pubkey 02 || 0..01).
const FAKE_NODE =
  "020000000000000000000000000000000000000000000000000000000000000001";

const XPAY_MAXDELAY = 2016; // xpay's default maxdelay

// Extra layers sendLightning passes to xpay. xpay forwards user layers to
// getroutes verbatim, and getroutes rejects an unknown layer outright, so only
// pass the ones that actually exist on this node (prod has prefer-kappa,
// regtest doesn't). Cached briefly — layers don't come and go.
const WANTED_LAYERS = ["prefer-kappa"];
let layerCache: { at: number; layers: string[] } | undefined;
export const xpayLayers = async (): Promise<string[]> => {
  if (layerCache && Date.now() - layerCache.at < 60_000)
    return layerCache.layers;
  let layers: string[] = [];
  try {
    const r = await ln.call("askrene-listlayers", {});
    const existing = new Set((r?.layers ?? []).map((l: any) => l.layer));
    layers = WANTED_LAYERS.filter((l) => existing.has(l));
  } catch (e: any) {
    warn("askrene-listlayers failed", e?.message ?? String(e));
    return [];
  }
  layerCache = { at: Date.now(), layers };
  return layers;
};

let ourId: string | undefined;
const nodeId = async () => {
  if (!ourId) ({ id: ourId } = await ln.getinfo());
  return ourId;
};

// Channel direction bit as CLN defines it: 0 when the source node id sorts
// before the destination's (node_id_idx). Node ids are same-length lowercase
// hex, so plain string comparison matches the byte comparison.
const dir = (src: string, dst: string) => (src < dst ? 0 : 1);

const isHex66 = (s: any) =>
  typeof s === "string" && /^0[23][0-9a-f]{64}$/.test(s);

// The routing-relevant parts of a decoded invoice: where it goes, the final
// cltv, and the private topology xpay would add. Fails on anything that isn't
// a bolt11 invoice or a bolt12 invoice (offers must be fetched first).
const routingTarget = async (decoded: any) => {
  const me = await nodeId();

  if (decoded.type === "bolt11 invoice") {
    const dest = decoded.payee;
    if (!isHex66(dest)) fail("Invoice has no payee");
    const hints: any[][] = decoded.routes ?? [];
    return {
      dest,
      finalCltv: decoded.min_final_cltv_expiry ?? 18,
      hints,
      paths: [],
      me,
    };
  }

  if (decoded.type === "bolt12 invoice") {
    // decode nests each path's payinfo inside the path (v26); older output
    // put them in a parallel invoice_blindedpay array. Accept both.
    const paths = decoded.invoice_paths ?? [];
    const payinfos = decoded.invoice_blindedpay ?? [];
    return {
      dest: decoded.invoice_node_id,
      finalCltv: 0, // xpay: unknown for blinded paths, payinfo carries the delta
      hints: [],
      paths: paths.map((p: any, i: number) => ({
        path: p,
        payinfo: p.payinfo ?? payinfos[i],
      })),
      me,
    };
  }

  fail(`Cannot quote a ${decoded.type}`);
};

// Ask askrene what delivering `amount` sats along this invoice would cost.
// Returns the routing fee in sats (rounded up — xpay's maxfee is msat, but
// everything we store is sats, and a cap that's a few msat short fails hard).
export const quoteRoutingFee = async ({
  pr,
  amount,
}: {
  pr: string;
  amount: number;
}) => {
  amount = Number.parseInt(amount as any);
  if (!(amount > 0)) fail("Invalid amount");
  const amountMsat = amount * 1000;

  const decoded = await ln.decode(pr.replace(/\s/g, "").toLowerCase());
  const { dest, finalCltv, hints, paths, me } = await routingTarget(decoded);

  // Self-pay: xpay short-circuits to an inject with no routing at all.
  if (dest === me) return { fee: 0, feeMsat: 0, parts: 0 };

  // Search cap for getroutes. Generous on purpose: this bounds the search,
  // and the caller decides what to do with the answer.
  const cap = Math.max(50_000, Math.ceil(amountMsat * 0.05));
  // xpay sizes its fake hint channels at 100x (amount + maxfee).
  const bigCap = (amountMsat + cap) * 100;

  let destination = dest;
  const fakes: any[] = [];
  for (const route of hints) {
    for (let i = 0; i < route.length; i++) {
      const hop = route[i];
      const next = i + 1 < route.length ? route[i + 1].pubkey : dest;
      // xpay skips hints from ourselves — we know our own channels.
      if (hop.pubkey === me) continue;
      if (hop.pubkey === next) continue; // askrene rejects self-loops
      fakes.push({
        src: hop.pubkey,
        dst: next,
        scid: hop.short_channel_id,
        cap: bigCap,
        htlcMin: 0,
        htlcMax: bigCap,
        base: hop.fee_base_msat ?? 0,
        ppm: hop.fee_proportional_millionths ?? 0,
        delta: hop.cltv_expiry_delta ?? 0,
      });
    }
  }

  if (paths.length) {
    destination = FAKE_NODE;
    let n = 0;
    for (const [i, { path, payinfo }] of paths.entries()) {
      // Only introduction points given as a node id can be resolved here;
      // xpay resolves scid-form ones through gossmap and discards the rest.
      const first = path?.first_node_id;
      if (!isHex66(first) || !payinfo) continue;
      // Earlier paths get more capacity so askrene prefers them, like xpay.
      const c = (amountMsat + cap) * (100 + (paths.length - i));
      fakes.push({
        src: first,
        dst: FAKE_NODE,
        scid: `0x0x${i}`, // block 0 is impossible, so it can't collide
        cap: c,
        htlcMin: payinfo.htlc_minimum_msat ?? 0,
        htlcMax: payinfo.htlc_maximum_msat ?? c,
        base: payinfo.fee_base_msat ?? 0,
        ppm: payinfo.fee_proportional_millionths ?? 0,
        delta: payinfo.cltv_expiry_delta ?? 0,
      });
      n++;
    }
    if (!n) fail("No usable blinded paths");
  }

  const layer = `quote-${v4()}`;
  try {
    await ln.call("askrene-create-layer", { layer, persistent: false });
    for (const f of fakes) {
      await ln.call("askrene-create-channel", {
        layer,
        source: f.src,
        destination: f.dst,
        short_channel_id: f.scid,
        capacity_msat: f.cap,
      });
      await ln.call("askrene-update-channel", {
        layer,
        short_channel_id_dir: `${f.scid}/${dir(f.src, f.dst)}`,
        enabled: true,
        htlc_minimum_msat: f.htlcMin,
        htlc_maximum_msat: f.htlcMax,
        fee_base_msat: f.base,
        fee_proportional_millionths: f.ppm,
        cltv_expiry_delta: f.delta,
      });
    }

    const r = await ln.call("getroutes", {
      source: me,
      destination,
      amount_msat: amountMsat,
      // Same stack and order as xpay: our channels re-added with real fees,
      // then zeroed as the source, then xpay's learned constraints.
      layers: [
        "auto.localchans",
        "auto.sourcefree",
        "xpay",
        layer,
        ...(await xpayLayers()),
      ],
      maxfee_msat: cap,
      final_cltv: finalCltv,
      maxdelay: XPAY_MAXDELAY,
    });

    const routes: any[] = r?.routes ?? [];
    if (!routes.length) fail("No route found");
    const sent = routes.reduce(
      (s, rt) => s + Number(rt.path?.[0]?.amount_msat ?? 0),
      0,
    );
    const delivered = routes.reduce(
      (s, rt) => s + Number(rt.amount_msat ?? 0),
      0,
    );
    if (
      !Number.isFinite(sent) ||
      !Number.isFinite(delivered) ||
      delivered < amountMsat
    )
      fail("No route found");
    const feeMsat = Math.max(0, sent - delivered);
    return { fee: Math.ceil(feeMsat / 1000), feeMsat, parts: routes.length };
  } finally {
    try {
      await ln.call("askrene-remove-layer", { layer });
    } catch (e: any) {
      warn("askrene-remove-layer failed", layer, e?.message ?? String(e));
    }
  }
};

// Platform fee for a lightning send, exactly as debit() will charge it:
// rate × (amount + routing fee), less any free-tier credit, and nothing at
// all on sub-accounts.
export const platformFee = async ({
  uid,
  aid,
  amount,
  fee,
}: {
  uid: string;
  aid: string;
  amount: number;
  fee: number;
}) => {
  if (aid !== uid) return 0;
  let rate = config.fee[PaymentType.lightning];
  if (await g(`ln:nofree:${uid}`)) rate = config.fee.lightningHigh ?? rate;
  const credit = Number.parseInt(await g(`credit:lightning:${uid}`)) || 0;
  const ourfee = Math.round((amount + fee) * rate);
  return Math.max(0, ourfee - Math.min(credit, ourfee));
};

// The most the account can deliver along this invoice such that amount +
// routing fee + platform fee lands exactly on the balance. Both fees grow
// with the amount, so iterate: quote at the balance, subtract the fees, quote
// again at the smaller amount. Each step's fees are ≥ the next step's (fees
// are monotone in amount), so from the second quote on the total never
// exceeds the balance; the extra rounds only shave the last sat or two.
export const quoteMax = async ({
  pr,
  uid,
  aid,
  ceiling,
}: {
  pr: string;
  uid: string;
  aid: string;
  ceiling?: number;
}) => {
  const balance = Number.parseInt(await g(`balance:${aid}`)) || 0;
  let amount = balance;
  if (ceiling > 0) amount = Math.min(amount, Math.floor(ceiling));
  if (amount <= 0) fail("Insufficient funds");

  let fee = 0;
  let ourfee = 0;
  for (let i = 0; i < 5; i++) {
    ({ fee } = await quoteRoutingFee({ pr, amount }));
    ourfee = await platformFee({ uid, aid, amount, fee });
    const next = Math.min(
      balance - fee - ourfee,
      ceiling > 0 ? Math.floor(ceiling) : Number.POSITIVE_INFINITY,
    );
    if (next <= 0) fail("Insufficient funds");
    if (next === amount) break;
    amount = next;
  }

  if (amount + fee + ourfee > balance) fail("Insufficient funds");
  return { amount, fee, ourfee, balance, total: amount + fee + ourfee };
};
