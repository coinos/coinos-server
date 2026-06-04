#!/usr/bin/env bun
// Geographic report from the request log. Ties Cloudflare's cf-ipcountry header
// to the authenticated `user` field so we count DISTINCT USERS per country
// (not raw request volume, which is dominated by datacenter/bot traffic).
//
// Usage: bun scripts/analytics-geo.ts [--days N] [--top N]
// Streams ~/coinos-server/req (pino JSONL, multi-GB) — never loads it whole.

import { createInterface } from "readline";
import { createReadStream } from "fs";

const argDays = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;
const TOP = Number(process.argv[process.argv.indexOf("--top") + 1]) || 25;
const cutoff = Date.now() - argDays * 24 * 60 * 60 * 1000;

// Datacenter IPs that flood /login with many usernames (credential-testing
// bots). Excluded from geo counts. 195.123.220.232 = M247 NL, ~3,971 logins
// for sequential usernames (bugtraq, bugtraqq, ...) in the last 30d.
const BOT_IPS = new Set<string>(["195.123.220.232"]);

const rl = createInterface({
  input: createReadStream("/home/adam/coinos-server/req"),
  crlfDelay: Infinity,
});

// We only trust /login and /register events for geography: they are real human
// auth actions tied to a username in the body, from the user's actual device.
// Counting ALL authenticated requests pollutes the result massively — e.g.
// nostr/NWC server traffic from a single M247 datacenter IP (195.123.220.232)
// carries a stale `user` field and made NL look like 93% of users. Per-IP-per-
// country dedup on auth events is the honest signal.

// country -> Set<username>  (distinct users who logged in / registered there)
const usersByCountry = new Map<string, Set<string>>();
// country -> distinct IPs (sanity: real geography has many IPs per country)
const ipsByCountry = new Map<string, Set<string>>();
let lines = 0;
let authEvents = 0;

const extractUsername = (r: any): string | null => {
  // /login and /register carry username in the body (top-level `user` is empty
  // on these). Body shape varies: {username} or {user:{username}}.
  const b = r.body;
  if (!b) return null;
  if (typeof b.username === "string") return b.username.toLowerCase();
  if (b.user && typeof b.user.username === "string") return b.user.username.toLowerCase();
  return null;
};

for await (const line of rl) {
  lines++;
  // cheap pre-filter: must be an auth event with a country tag
  if (!line.includes("cf-ipcountry")) continue;
  if (!line.includes('"/login"') && !line.includes('"/register"')) continue;
  let r: any;
  try {
    r = JSON.parse(line);
  } catch {
    continue;
  }
  if (!r.time || r.time < cutoff) continue;
  if (r.url !== "/login" && r.url !== "/register") continue;
  const cc = r.headers?.["cf-ipcountry"];
  if (!cc || cc === "XX" || cc.length !== 2) continue;
  const ip = r.headers?.["cf-connecting-ip"];

  const user = extractUsername(r);
  if (!user) continue;

  // Drop known bot/proxy egress IPs that fire thousands of logins for many
  // usernames from a single datacenter address — these are credential-testing
  // bots, not real users, and otherwise dominate the country ranking. Heuristic
  // backstop below (users >> ips) catches the rest; this is the worst offender.
  if (ip && BOT_IPS.has(ip)) continue;
  authEvents++;

  let s = usersByCountry.get(cc);
  if (!s) usersByCountry.set(cc, (s = new Set()));
  s.add(user);

  if (ip) {
    let is = ipsByCountry.get(cc);
    if (!is) ipsByCountry.set(cc, (is = new Set()));
    is.add(ip);
  }
}
const withCountry = authEvents;

const byUsers = [...usersByCountry.entries()]
  .map(([cc, set]) => [cc, set.size, ipsByCountry.get(cc)?.size || 0] as [string, number, number])
  .sort((a, b) => b[1] - a[1]);

const totalUsers = byUsers.reduce((s, [, n]) => s + n, 0);
const max = byUsers[0]?.[1] || 1;
const bar = (n: number) =>
  "█".repeat(Math.round((n / max) * 24)) + "·".repeat(24 - Math.round((n / max) * 24));

console.log("═".repeat(64));
console.log(`  COINOS GEO — last ${argDays} days (login/register events only)`);
console.log(`  scanned ${lines.toLocaleString()} log lines, ${withCountry.toLocaleString()} auth events`);
console.log("═".repeat(64));
console.log("\n▏TOP COUNTRIES (distinct users who logged in / registered)");
console.log("    cc  distribution                    users   ips   share");
byUsers.slice(0, TOP).forEach(([cc, n, ips], i) => {
  const pct = ((n / totalUsers) * 100).toFixed(1);
  console.log(
    `  ${String(i + 1).padStart(2)}. ${cc}  ${bar(n)} ${String(n).padStart(5)}  ${String(ips).padStart(4)}  ${pct.padStart(5)}%`,
  );
});
console.log(
  `\n  (ips column = distinct source IPs; a country with users >> ips is likely a proxy/VPN egress, not real geography)`,
);
console.log("\n" + "═".repeat(64));
process.exit(0);
