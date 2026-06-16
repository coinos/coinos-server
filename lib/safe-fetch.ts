// SSRF-resistant wrapper around got for fetching user-supplied URLs (lnurl /
// lightning-address resolution in routes/lnurl.ts). Resolves the target host
// and rejects it if any resolved IP is loopback, private, link-local, CGNAT,
// or cloud-metadata. Re-validates on every redirect hop so a 30x can't bounce
// us into the internal network. (A determined DNS-rebinding attacker still has
// a small TOCTOU window between resolve and connect; acceptable here — the
// dominant risk was unrestricted internal access, which this closes.)
import dns from "node:dns/promises";
import net from "node:net";
import got from "got";

const blockedV4 = (ip: string): boolean => {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10 (incl. tailscale)
  if (a >= 224) return true; // multicast / reserved
  return false;
};

const isBlockedIp = (ip: string): boolean => {
  if (net.isIPv4(ip)) return blockedV4(ip);
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // loopback / unspecified
    const mapped = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return blockedV4(mapped[1]); // IPv4-mapped
    if (/^fe[89ab]/.test(low)) return true; // fe80::/10 link-local
    const head = low.split(":")[0];
    if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 ULA
    return false;
  }
  return true; // not a recognizable IP -> block
};

const assertHostAllowed = async (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 literal brackets
  let ips: string[];
  if (net.isIP(host)) ips = [host];
  else {
    const recs = await dns.lookup(host, { all: true });
    ips = recs.map((r) => r.address);
  }
  if (!ips.length) throw new Error(`cannot resolve ${host}`);
  for (const ip of ips)
    if (isBlockedIp(ip)) throw new Error(`blocked host ${host} -> ${ip}`);
};

// Fetch a user-supplied URL with SSRF protection and return the parsed JSON
// body. Throws on a bad scheme/URL or a host that resolves into a blocked range.
export const safeGot = async (url: string): Promise<any> => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("unsupported scheme");

  await assertHostAllowed(u.hostname);

  return got(url, {
    timeout: { request: 8000 },
    retry: { limit: 0 },
    maxRedirects: 4,
    hooks: {
      beforeRedirect: [
        async (options: any) => {
          await assertHostAllowed(options.url.hostname);
        },
      ],
      afterResponse: [
        (response: any) => {
          const len = Number(response.headers["content-length"] || 0);
          if (len > 2_000_000) throw new Error("response too large");
          return response;
        },
      ],
    },
  }).json();
};
