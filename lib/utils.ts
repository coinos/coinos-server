import config from "$config";
import { g, s } from "$lib/db";
import locales from "$lib/locales/index";
import migrate from "$lib/migrate";
import whitelist from "$lib/whitelist";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { getPublicKey } from "nostr";

const { URL } = process.env;

export const fail = (msg) => {
  throw new Error(msg);
};

export const nada = () => {};

export const sleep = (n) => new Promise((r) => setTimeout(r, n));
export const wait = async (f, s = 300, n = 50) => {
  let i = 0;
  while (!(await f()) && i < s) (await sleep(n)) && i++;
  if (i >= s) fail("timeout");
  return f();
};

export const prod = process.env.NODE_ENV === "production";

export const bail = (res, msg) => res.code(500).send(msg);

export const SATS = 100000000;
export const sats = (n) => Math.round(n * SATS);
export const btc = (n) => parseFloat((n / SATS).toFixed(8));
export const fiat = (n, r) => (n * r) / SATS;

export const uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
export const pick = (O, K) =>
  K.reduce((o, k) => (typeof O[k] !== "undefined" && (o[k] = O[k]), o), {});

export const bip21 = (address, { amount, memo, tip, type }) => {
  if (!(amount || memo)) return address;

  const network = { liquid: "liquidnetwork", bitcoin: "bitcoin" }[type];
  const url = new URLSearchParams();

  if (amount) {
    url.append("amount", btc(amount + tip).toFixed(8));
    if (type === "liquid") url.append("assetid", config.liquid.btc);
  }

  if (memo) url.append("message", memo);

  return `${network}:${address}?${url.toString()}`;
};

export const getUser = async (username, fields) => {
  let update;
  if (username === "undefined") fail("invalid user");
  const user = await migrate(username);
  if (user && !user.anon && !user.nwc) {
    user.nwc = bytesToHex(randomBytes(32));
    await s(getPublicKey(user.nwc), user.id);
    update = true;
  }

  if (user?.profile) {
    user.picture = `https://coinos.io/api/public/${user.profile}.webp`;
    delete user.profile;

    if (user.banner) {
      user.banner = `https://coinos.io/api/public/${user.banner}.webp`;
    }
    update = true;
  }

  if (user?.address) {
    user.about = user.address;
    delete user.address;
    update = true;
  }

  if (update) s(`user:${user.id}`, user);

  return fields && user ? pick(user, fields) : user;
};

export const getInvoice = async (hash) => {
  let iid = await g(`invoice:${hash}`);
  if (iid?.id) iid = iid.id;
  else if (iid?.hash) iid = iid.hash;
  return await g(`invoice:${iid}`);
};

export const getPayment = async (id) => {
  let p = await g(`payment:${id}`);
  if (typeof p === "string") p = await g(`payment:${p}`);
  return p;
};

export const f = (s, currency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  })
    .format(s)
    .replace("CA", "");

export function formatReceipt(items, currency) {
  function wrapText(text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
      if (currentLine.length + word.length + 1 > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine.length > 0 ? " " : "") + word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function calculateColumnWidths(items) {
    let maxQuantityLength = 0;
    let maxPriceLength = 0;

    for (const item of items) {
      const quantityLength = String(item.quantity).length;
      if (quantityLength > maxQuantityLength) {
        maxQuantityLength = quantityLength;
      }

      const priceLength = f(item.price * item.quantity, currency).length;
      if (priceLength > maxPriceLength) {
        maxPriceLength = priceLength;
      }
    }

    // Add padding to the widths for aesthetic spacing
    return {
      quantityColumnWidth: maxQuantityLength + 1, // Space after quantity
      priceColumnWidth: maxPriceLength + 1, // Space before price
    };
  }
  const maxLineWidth = 32;
  const { quantityColumnWidth, priceColumnWidth } =
    calculateColumnWidths(items);
  const nameColumnWidth = maxLineWidth - quantityColumnWidth - priceColumnWidth;

  return items
    .map((item) => {
      const quantityStr = String(item.quantity).padEnd(quantityColumnWidth);
      const priceStr = f(item.price * item.quantity, currency).padStart(
        priceColumnWidth,
      );
      const nameLines = wrapText(item.name, nameColumnWidth);

      // Construct the full line(s) with the first line including the price
      const fullLines = [
        `${quantityStr}${nameLines[0].padEnd(nameColumnWidth)}${priceStr}`,
      ];
      // Add any additional name lines, properly indented
      for (let i = 1; i < nameLines.length; i++) {
        fullLines.push(" ".repeat(quantityColumnWidth) + nameLines[i]);
      }

      return fullLines.join("\n");
    })
    .join("\n");
}

export const t = ({ language = "en" }) => locales[language];

export const time = (() => {
  let count = 0;
  let started = false;
  return (s = "") => {
    if (!started) {
      console.time("");
      started = true;
    }
    console.timeLog("", ++count, s);
  };
})();

export const fmt = (sats) =>
  `⚡️${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    sats,
  )}`;

export const link = (id) => `${URL}/payment/${id}`;

export const fields = [
  "about",
  "anon",
  "banner",
  "banner",
  "currency",
  "display",
  "id",
  "hidepay",
  "lud16",
  "memoPrompt",
  "npub",
  "picture",
  "prompt",
  "pubkey",
  "username",
  "website",
];
