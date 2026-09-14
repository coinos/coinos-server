import { warn } from "$lib/logging";
import { fail } from "$lib/utils";

// The v3 registrar (coinos v3 / halwallet) owns any name it has a record for:
// routes/lnurl.ts serves a claimed name's lightning address from the registrar
// ahead of the local account. So a local account taking a name the registrar
// holds silently hands its incoming payments to whoever holds the v3 name.
// Both places that assign a username — registration and the profile rename —
// must therefore refuse a name the registrar holds, unless the account's own
// nostr key is the holder (a user re-creating their migrated name is fine).
const NAMES_URL = process.env.NAMES_URL || "https://names.coinos.io";
const DOMAIN = "coinos.io";

// Fail CLOSED: if the registrar can't be reached we don't know who owns the
// name, and handing out a squatted name is worse than a retry.
export const assertNameFree = async (username: string, ownPubkey?: string) => {
  const name = username.toLowerCase();
  let body: any;
  try {
    const r = await fetch(
      `${NAMES_URL}/name/${encodeURIComponent(name)}?domain=${DOMAIN}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!r.ok) throw new Error(`registrar said ${r.status}`);
    body = await r.json();
  } catch (e: any) {
    warn("names registrar unreachable checking", name, e?.message);
    fail("Username unavailable right now, please try again");
  }
  // `pubkey` is only present for a real v3 record. `taken` without one means
  // the registrar is echoing our own account list back at us — not a claim.
  const holder = body?.taken && typeof body.pubkey === "string" ? body.pubkey : null;
  if (holder && holder !== ownPubkey) {
    warn("username held by v3 registrar", name, holder.slice(0, 8));
    fail(`Username ${name} taken`);
  }
};
