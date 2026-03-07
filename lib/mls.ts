import config from "$config";
import { db } from "$lib/db";
import { l, warn } from "$lib/logging";
import { getProfile } from "$lib/nostr";
import { Relay } from "nostr-tools/relay";
import type { Event } from "nostr-tools";

const MLS_KEY = "mls:users";
const RELAYS = config.relays.filter((r) => r.startsWith("wss://"));

interface MlsUser {
  pubkey: string;
  name?: string;
  picture?: string;
  nip05?: string;
}

const knownPubkeys = new Set<string>();

async function resolveProfile(pubkey: string): Promise<MlsUser> {
  try {
    const profile = await getProfile(pubkey);
    return {
      pubkey,
      name: profile.display_name || profile.name || undefined,
      picture: profile.picture || undefined,
      nip05: profile.nip05 || undefined,
    };
  } catch {
    return { pubkey };
  }
}

async function addUser(pubkey: string): Promise<void> {
  if (knownPubkeys.has(pubkey)) return;
  knownPubkeys.add(pubkey);
  const user = await resolveProfile(pubkey);
  await db.hSet(MLS_KEY, pubkey, JSON.stringify(user));
}

async function backfill(): Promise<void> {
  // Paginate back 3 weeks
  const threeWeeksAgo = Math.floor(Date.now() / 1000) - 21 * 24 * 60 * 60;
  let until: number | undefined;

  for (let pass = 0; pass < 50; pass++) {
    const filter: any = { kinds: [443], limit: 500 };
    if (until) filter.until = until;

    let events: Event[] = [];
    try {
      events = (
        await Promise.all(
          RELAYS.map(
            (url) =>
              new Promise<Event[]>((resolve) => {
                Relay.connect(url)
                  .then((r) => {
                    const found: Event[] = [];
                    r.subscribe([filter], {
                      onevent(e) { found.push(e); },
                      oneose() { r.close(); resolve(found); },
                    });
                  })
                  .catch(() => resolve([]));
              }),
          ),
        )
      ).flat();
    } catch {
      break;
    }

    if (events.length === 0) break;

    const newPubkeys = [...new Set(events.map((e) => e.pubkey))].filter(
      (pk) => !knownPubkeys.has(pk),
    );

    for (const pk of newPubkeys) {
      await addUser(pk);
    }

    const oldest = Math.min(...events.map((e) => e.created_at));
    if (oldest <= threeWeeksAgo) break;
    until = oldest;

    l(`mls backfill pass ${pass}: ${knownPubkeys.size} users, oldest ${new Date(oldest * 1000).toISOString()}`);
  }

  l(`mls backfill complete: ${knownPubkeys.size} users`);
}

function subscribe(): void {
  for (const url of RELAYS) {
    Relay.connect(url)
      .then((r) => {
        r.subscribe([{ kinds: [443], since: Math.floor(Date.now() / 1000) }], {
          onevent(e) {
            addUser(e.pubkey).catch(() => {});
          },
        });
      })
      .catch((e) => warn(`mls subscribe failed: ${url}`, e.message));
  }
}

export async function initMlsIndex(): Promise<void> {
  // Load existing index into memory
  try {
    const existing = await db.hGetAll(MLS_KEY);
    for (const pk of Object.keys(existing)) knownPubkeys.add(pk);
    l(`mls index loaded: ${knownPubkeys.size} users`);
  } catch {}

  // Subscribe for new key packages
  subscribe();

  // Backfill in background
  backfill().catch((e) => warn("mls backfill error", e.message));
}

export async function getMlsUsers(): Promise<MlsUser[]> {
  const data = await db.hGetAll(MLS_KEY);
  return Object.values(data).map((v) => JSON.parse(v));
}
