// Usernames nobody may register or rename into. A coinos username is also a
// lightning address, so a name that reads as ours lets an account collect
// payments meant for the service: "mint" was claimed within days of the ecash
// redesign freeing it (2026-09-18) and took payments addressed to
// mint@coinos.io until it was renamed.
//
// Checked on registration (lib/register.ts) and on rename (routes/users.ts).
// Names already held by the v3 registrar are refused separately, by
// assertNameFree in lib/names.ts.
export const reserved = [
  "admin",
  "administrator",
  "ark",
  "cash",
  "coinos",
  "ecash",
  "fund",
  "help",
  "info",
  "lightning",
  "mint",
  "pool",
  "root",
  "security",
  "support",
  "system",
  "wallet",
];

export const isReserved = (username: string) =>
  reserved.includes(String(username || "").toLowerCase().replace(/\s/g, ""));
