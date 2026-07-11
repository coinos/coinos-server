import config from "$config";
import { g, s } from "$lib/db";
import { err } from "$lib/logging";
import { sleep } from "$lib/utils";
import got from "got";
import WebSocket from "ws";

export let rate;
let last;
let ws;

// The Iranian market IRR is fetched on its own timer rather than on every binance
// tick — fetching inline hammered the source and, when it's unreachable (recurring
// geo-block / outage), failed + logged on every tick. We cache the last-good value
// and apply it in onmessage; the tick loop never blocks on it.
// Source: Wallex (api.wallex.ir) BTCTMN last price. We switched off Nobitex on
// 2026-07-10 after apiv2.nobitex.ir became unreachable from our egress (its
// Iranian IPs refuse foreign connections); Wallex's API is reachable and its
// BTCTMN cross-checks against BTCUSDT × USDTTMN to <0.1%.
let iranIrr = 0;
let iranIrrTime = 0;
let iranErrLogged = 0;
const connect = async () => {
  if (ws && ws.readyState === 1 && Date.now() - last < 5000) return;
  if (ws) ws.terminate() && (await sleep(Math.round(Math.random() * 1000)));

  ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@miniTicker");

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      const rates = (await g("rates")) || {};
      const { fx } = (await g("fx")) || {};
      if (!fx) return;

      Object.keys(fx).map((symbol) => {
        rates[symbol] = msg.c * fx[symbol];
      });

      // Apply the Iranian market IRR cached by updateIranRate() below (Wallex).
      // iranIrr is stored in Rial, so IRR = iranIrr and Toman = Rial / 10. If the
      // source has been unreachable for over an hour, we leave the fixer official
      // IRR set in the fx loop above rather than serving an ever-staler market rate.
      if (iranIrr > 0 && Date.now() - iranIrrTime < 60 * 60 * 1000) {
        rates.IRR = iranIrr;
        rates.IRT = iranIrr / 10;
      }

      rate = msg.c;
      s("rate", rate);
      s("rates", rates);
      last = Date.now();
    } catch (e) {
      err("binance message error", e.message);
    }
  };

  ws.onerror = async (error) => {
    err("binance socket error", error.message);
  };

  return ws;
};

// Fetch the Iranian market rate from Wallex on its own 60s timer, decoupled from
// the binance tick loop. Wallex quotes BTCTMN in Toman, so IRR (Rial) = price*10.
// Caches the last-good value; on failure (recurring geo-block / outage) throttles
// error logging to once per 5 min instead of spamming on every attempt. A 5s
// request timeout keeps a hung endpoint from piling up.
const updateIranRate = async () => {
  try {
    const data = (await got("https://api.wallex.ir/v1/markets", {
      timeout: { request: 5000 },
    }).json()) as any;
    const tmn = Number(data?.result?.symbols?.BTCTMN?.stats?.lastPrice);
    if (tmn > 0) {
      iranIrr = tmn * 10; // Toman -> Rial
      iranIrrTime = Date.now();
    }
  } catch (e) {
    if (Date.now() - iranErrLogged > 5 * 60 * 1000) {
      err("Iran IRR/IRT rate fetch failed (wallex)", e.message);
      iranErrLogged = Date.now();
    }
  }
  setTimeout(updateIranRate, 60000);
};
updateIranRate();

export const getFx = async () => {
  connect();

  let date = 0;
  let fx = await g("fx");
  if (fx) ({ date, fx } = fx);

  if (Date.now() - date > 24 * 60 * 60 * 1000) {
    date = Date.now();
    try {
      if (config.fixer) {
        ({ rates: fx } = (await got(
          `http://data.fixer.io/api/latest?access_key=${config.fixer}&base=USD`,
        ).json()) as any);
      } else {
        ({ fx } = (await got("https://coinos.io/api/fx").json()) as any);
      }

      const USD = fx.USD;

      Object.keys(fx).map((k) => {
        fx[k] = fx[k] / USD;
      });

      await s("fx", { date, fx });
    } catch (e) {
      err("error fetching rates", e.message);
    }
  }

  setTimeout(getFx, 30000);
};
