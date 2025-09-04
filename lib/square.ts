// squareSync.ts — Square v40+, per-user OAuth creds from Redis
import { SquareClient, SquareEnvironment, Square } from "square";
import config from "$config";
import { g, s } from "$lib/db";
import { l, warn } from "$lib/logging";

// ----- Types coming from your code -----
type CoinosInv = {
  id: string;
  currency: string | Square.Currency;
  rate: number;          // fiat per BTC captured at invoice time
  items?: Array<any>;
  memo?: string;
};

type CoinosPayment = {
  id: string;            // Coinos payment UUID
  iid: string;           // invoice id
  amount: number;        // sats, excludes tip
  tip: number;           // sats
  rate: number;          // fiat per BTC (final)
  currency: string | Square.Currency;
  type: "bitcoin" | "liquid" | "lightning" | "internal" | string;
  ref?: string;          // on-chain: "...:txid:vout", LN: preimage etc.
  payment_hash?: string; // LN hash if available
  memo?: string;
};

type CoinosUser = { id: string; username?: string };

// ----- Helpers -----
const toBigCents = (n: number) => BigInt(n);
const satsToCents = (sats: number, fiatPerBTC: number) =>
  Math.round((sats / 100_000_000) * fiatPerBTC * 100);

const nowISO = () => new Date().toISOString();
const isPast = (iso?: string, skewSeconds = 60) =>
  !!iso && Date.parse(iso) - skewSeconds * 1000 <= Date.now();

const normalizeCurrency = (c: string | Square.Currency): Square.Currency =>
  (typeof c === "string" ? c : String(c)).toUpperCase() as Square.Currency;

const networkLabel = (t: CoinosPayment["type"]) =>
  t === "lightning" ? "LIGHTNING" : t === "bitcoin" || t === "liquid" ? "ONCHAIN" : "OTHER";

// ----- Per-user Square auth in Redis -----
// Key: `${uid}:square`  ->  JSON: { accessToken, tokenType, expiresAt, merchantId, refreshToken, shortLived, refreshTokenExpiresAt }
type RedisSquareAuth = {
  accessToken: string;
  tokenType: "bearer";
  expiresAt?: string; // ISO
  merchantId?: string;
  refreshToken?: string;
  shortLived?: boolean;
  refreshTokenExpiresAt?: string;
};

async function loadSquareAuth(uid: string): Promise<RedisSquareAuth | null> {
  const raw = await g(`${uid}:square`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as RedisSquareAuth);
}

// Save back (preserve unknown fields)
async function saveSquareAuth(uid: string, next: Partial<RedisSquareAuth>) {
  const current = (await loadSquareAuth(uid)) || ({} as RedisSquareAuth);
  const merged = { ...current, ...next };
  await s(`${uid}:square`, JSON.stringify(merged));
  return merged;
}

// Create an SDK client for any token (or no token for OAuth)
function makeClient(token?: string) {
  return new SquareClient({
    token: token ?? "", // OAuth obtainToken doesn’t require bearer auth
    environment:
      config.env === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
}

// Refresh the user’s access token if needed
async function ensureFreshAccessToken(uid: string): Promise<RedisSquareAuth | null> {
  const auth = await loadSquareAuth(uid);
  if (!auth) return null;

  // If no expiry recorded, just use the token as-is
  if (!auth.expiresAt || !isPast(auth.expiresAt)) return auth;

  // Expired — try to refresh
  if (!auth.refreshToken) {
    warn("Square: token expired and no refresh token present", uid);
    return auth;
  }
  if (!config.square?.clientId || !config.square?.clientSecret) {
    warn("Square: missing clientId/clientSecret for OAuth refresh");
    return auth;
  }

  try {
    const oauth = makeClient().oAuth; // new SDK OAuth resource
    const res = await oauth.obtainToken({
      clientId: config.square.clientId,
      clientSecret: config.square.clientSecret,
      grantType: "refresh_token",
      refreshToken: auth.refreshToken,
    });
    // Update stored creds (Square may rotate fields)
    const updated = await saveSquareAuth(uid, {
      accessToken: res.accessToken!,
      tokenType: (res.tokenType as "bearer") ?? "bearer",
      expiresAt: res.expiresAt,
      merchantId: res.merchantId ?? auth.merchantId,
      refreshToken: res.refreshToken ?? auth.refreshToken,
      // shortLived is optional; keep existing if not provided
      shortLived: typeof (res as any).shortLived === "boolean" ? (res as any).shortLived : auth.shortLived,
      refreshTokenExpiresAt: (res as any).refreshTokenExpiresAt ?? auth.refreshTokenExpiresAt,
    });
    l("Square OAuth refresh ok", { uid, oldExp: auth.expiresAt, newExp: updated.expiresAt });
    return updated;
  } catch (e: any) {
    warn("Square OAuth refresh failed", e?.message || e);
    return auth; // fall back to (expired) auth — caller can decide to skip
  }
}

// Pick/cached location for the seller
async function getOrCacheLocationId(uid: string, client: SquareClient): Promise<string | null> {
  const cacheKey = `${uid}:square:locationId`;
  const fromCache = await g(cacheKey);
  if (typeof fromCache === "string" && fromCache) return fromCache;
  if (fromCache && (fromCache as any).id) return (fromCache as any).id;

  // Query seller’s locations and choose the first ACTIVE (or first if none ACTIVE)
  const list = await client.locations.list();
  // Auto-pagination can return a pager; handle both shapes
  let firstActiveId: string | undefined;
  if (Array.isArray((list as any).data)) {
    const page = (list as any).data as Square.Location[];
    firstActiveId = page.find((loc) => loc.status === "ACTIVE")?.id || page[0]?.id;
  } else {
    const resp = list as { locations?: Square.Location[] };
    firstActiveId = resp.locations?.find((loc) => loc.status === "ACTIVE")?.id || resp.locations?.[0]?.id;
  }

  if (!firstActiveId) {
    warn("Square: no locations found for seller", uid);
    return null;
  }

  await s(cacheKey, firstActiveId);
  return firstActiveId;
}

export async function syncSquare(inv: CoinosInv, p: CoinosPayment, user: CoinosUser) {
  // 1) Load/refresh per-user OAuth creds
  const auth = await ensureFreshAccessToken(user.id);
  if (!auth?.accessToken) {
    warn("Square: no credentials for user; skipping sync", user.id);
    return;
  }

  // 2) Build a client for this seller and find a location
  const client = makeClient(auth.accessToken);
  const locationId = await getOrCacheLocationId(user.id, client);
  if (!locationId) {
    warn("Square: no locationId; skipping sync");
    return;
  }

  // 3) Amounts and currency
  const itemSats = p.amount || 0;
  const tipSats = p.tip || 0;
  const itemCents = satsToCents(itemSats, p.rate);
  const tipCents  = satsToCents(tipSats,  p.rate);
  const totalCents = itemCents + tipCents;
  const cur = normalizeCurrency(p.currency || inv.currency);

  // 4) Create (or reuse) an Order
  const orderResp = await client.orders.create({
    idempotencyKey: `coinos-order-${inv.id}`,
    order: {
      locationId,
      metadata: {
        coinos_invoice_id: inv.id,
        coinos_payment_id: p.id,
        coinos_user_id: user.id,
        coinos_synced_at: nowISO(),
      },
      lineItems: [
        {
          name: inv.memo?.slice(0, 255) || "Coinos Order",
          quantity: "1",
          basePriceMoney: { amount: toBigCents(itemCents), currency: cur },
        },
      ],
      ...(tipCents > 0
        ? {
            serviceCharges: [
              {
                name: "Tip",
                calculationPhase: "TOTAL_PHASE",
                taxable: false,
                amountMoney: { amount: toBigCents(tipCents), currency: cur },
              },
            ],
          }
        : {}),
    },
  });
  const orderId = orderResp.order?.id;
  if (!orderId) throw new Error("Square: create order returned no order.id");

  // 5) Record an EXTERNAL payment (approved, not autocompleted)
  const short = (s?: string, n = 18) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "");
  const refParts = (p.ref || "").split(":");
  const maybeTxid = refParts.length >= 2 ? refParts[refParts.length - 2] : undefined;

  const note = [
    `Coinos invoice ${inv.id}`,
    p.payment_hash ? `hash ${short(p.payment_hash)}` : "",
    maybeTxid ? `txid ${short(maybeTxid)}` : "",
    inv.memo ? `memo ${short(inv.memo, 60)}` : "",
  ].filter(Boolean).join(" | ");

  const payResp = await client.payments.create({
    idempotencyKey: `coinos-pay-${p.id}`,
    locationId,
    orderId,
    sourceId: "EXTERNAL",
    amountMoney: { amount: toBigCents(totalCents), currency: cur },
    autocomplete: false, // keep APPROVED; we’ll pay the order next
    externalDetails: { type: "OTHER", source: `Coinos ${networkLabel(p.type)}` },
    note,
  });
  const paymentId = payResp.payment?.id;
  if (!paymentId) throw new Error("Square: create payment returned no payment.id");

  // 6) Pay the order with our external payment
  await client.orders.pay({
    orderId,
    idempotencyKey: `coinos-payorder-${orderId}-${paymentId}`,
    paymentIds: [paymentId],
  });

  l("Square sync complete", { orderId, paymentId, invoice: inv.id, user: user.id, locationId });
}
