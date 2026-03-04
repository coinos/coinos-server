import config from "$config";
import { db, g, s } from "$lib/db";
import ln from "$lib/ln";
import { l, warn } from "$lib/logging";
import { v4 } from "uuid";
import { PaymentType } from "$lib/types";

const { CF_EMAIL, CF_API_KEY, CF_ZONE_ID } = process.env;
const cfApi = "https://api.cloudflare.com/client/v4";
const cfHeaders = {
  "X-Auth-Email": CF_EMAIL,
  "X-Auth-Key": CF_API_KEY,
  "Content-Type": "application/json",
};

const createDnsRecord = async (username: string, bolt12: string) => {
  if (!CF_API_KEY || !CF_ZONE_ID) return;

  const name = `${username}.user._bitcoin-payment.${config.hostname}`;
  const content = `bitcoin:?lno=${bolt12}`;

  const listRes = await fetch(
    `${cfApi}/zones/${CF_ZONE_ID}/dns_records?type=TXT&name=${name}`,
    { headers: cfHeaders },
  );
  const listData = (await listRes.json()) as any;

  if (listData.result?.length) {
    const recordId = listData.result[0].id;
    await fetch(`${cfApi}/zones/${CF_ZONE_ID}/dns_records/${recordId}`, {
      method: "PUT",
      headers: cfHeaders,
      body: JSON.stringify({ type: "TXT", name, content, ttl: 3600 }),
    });
  } else {
    await fetch(`${cfApi}/zones/${CF_ZONE_ID}/dns_records`, {
      method: "POST",
      headers: cfHeaders,
      body: JSON.stringify({ type: "TXT", name, content, ttl: 3600 }),
    });
  }
};

const deleteDnsRecord = async (username: string) => {
  if (!CF_API_KEY || !CF_ZONE_ID) return;

  const name = `${username}.user._bitcoin-payment.${config.hostname}`;
  const listRes = await fetch(
    `${cfApi}/zones/${CF_ZONE_ID}/dns_records?type=TXT&name=${name}`,
    { headers: cfHeaders },
  );
  const listData = (await listRes.json()) as any;

  for (const record of listData.result || []) {
    await fetch(`${cfApi}/zones/${CF_ZONE_ID}/dns_records/${record.id}`, {
      method: "DELETE",
      headers: cfHeaders,
    });
  }
};

export const setupBip353 = async (user) => {
  const existing = await g(`bip353:${user.username}`);
  if (existing) {
    await createDnsRecord(user.username, existing.bolt12);
    return;
  }

  const r = await ln.offer({
    amount: "any",
    label: `bip353 ${user.username}`,
    description: `Pay ${user.username}`,
  });

  await s(`bip353:${user.username}`, {
    offer_id: r.offer_id,
    bolt12: r.bolt12,
  });

  // Template invoice so the lightning listener can route payments
  const id = v4();
  const rates = await g("rates");
  const currency = user.currency || "USD";

  const inv = {
    id,
    aid: user.id,
    amount: 0,
    currency,
    hash: r.bolt12,
    rate: rates?.[currency] || 0,
    memo: "",
    path: null,
    pending: 0,
    received: 0,
    tip: 0,
    type: PaymentType.bolt12,
    uid: user.id,
    created: Date.now(),
  };

  await s(`invoice:${r.offer_id}`, id);
  await s(`invoice:${id}`, inv);

  await createDnsRecord(user.username, r.bolt12);
  l("BIP 353 setup complete for", user.username);
};

export const teardownBip353 = async (user) => {
  const existing = await g(`bip353:${user.username}`);
  if (!existing) return;

  if (existing.offer_id) {
    await ln.disableoffer(existing.offer_id).catch(() => {});
    await db.del(`invoice:${existing.offer_id}`);
  }

  await db.del(`bip353:${user.username}`);
  await deleteDnsRecord(user.username);
  l("BIP 353 teardown complete for", user.username);
};
