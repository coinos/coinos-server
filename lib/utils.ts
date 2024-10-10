import locales from "$lib/locales/index";
import { randomBytes, bytesToHex } from "@noble/hashes/utils";
import migrate from "$lib/migrate";
import { g, s } from "$lib/db";
import config from "$config";
import { getPublicKey } from "nostr";

export let fail = (msg) => {
  throw new Error(msg);
};

export let nada = () => {};

export let sleep = (n) => new Promise((r) => setTimeout(r, n));
export let wait = async (f, s = 300, n = 50) => {
  let i = 0;
  while (!(await f()) && i < s) (await sleep(n)) && i++;
  if (i >= s) fail("timeout");
  return f();
};

export let prod = process.env.NODE_ENV === "production";

export let bail = (res, msg) => res.code(500).send(msg);

export let SATS = 100000000;
export let sats = (n) => Math.round(n * SATS);
export let btc = (n) => parseFloat((n / SATS).toFixed(8));
export let fiat = (n, r) => (n * r) / SATS;

export let uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
export let pick = (O, K) =>
  K.reduce((o, k) => (typeof O[k] !== "undefined" && (o[k] = O[k]), o), {});

export let bip21 = (address, { amount, memo, tip, type }) => {
  if (!(amount || memo)) return address;

  let network = { liquid: "liquidnetwork", bitcoin: "bitcoin" }[type];
  let url = new URLSearchParams();

  if (amount) {
    url.append("amount", btc(amount + tip).toFixed(8));
    if (type === "liquid") url.append("assetid", config.liquid.btc);
  }

  if (memo) url.append("memo", memo);

  return `${network}:${address}?${url.toString()}`;
};

export let fields = [
  "cipher",
  "pubkey",
  "password",
  "username",
  "salt",
  "currency",
  "currencies",
  "fiat",
  "otpsecret",
  "balance",
  "ip",
  "pin",
  "display",
  "haspin",
  "profile",
  "prompt",
  "banner",
];

export let getUser = async (username) => {
  if (username === "undefined") fail("invalid user");
  let user = await migrate(username);
  if (user && !user.anon && !user.nwc) {
    user.nwc = bytesToHex(randomBytes(32));
    await s(getPublicKey(user.nwc), user.id);
    await s(`user:${user.id}`, user);
  }

  return user;
};

export let getInvoice = async (hash) => {
  let iid = await g(`invoice:${hash}`);
  if (iid && iid.id) iid = iid.id;
  else if (iid && iid.hash) iid = iid.hash;
  return await g(`invoice:${iid}`);
};

export let getPayment = async (id) => {
  let p = await g(`payment:${id}`);
  if (typeof p === "string") p = await g(`payment:${p}`);
  return p;
};

export let f = (s, currency) =>
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
    words.forEach((word) => {
      if (currentLine.length + word.length + 1 > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine.length > 0 ? " " : "") + word;
      }
    });
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function calculateColumnWidths(items) {
    let maxQuantityLength = 0;
    let maxPriceLength = 0;

    items.forEach((item) => {
      const quantityLength = String(item.quantity).length;
      if (quantityLength > maxQuantityLength) {
        maxQuantityLength = quantityLength;
      }

      const priceLength = f(item.price * item.quantity, currency).length;
      if (priceLength > maxPriceLength) {
        maxPriceLength = priceLength;
      }
    });

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
      let fullLines = [
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

export let t = ({ language = "en" }) => locales[language];

export let time = (() => {
  let count = 0, started = false;
  return () => {
    if (!started) {
      console.time('');
      started = true;
    }
    console.timeLog('', ++count);
  };
})();
