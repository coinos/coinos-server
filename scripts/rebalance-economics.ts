#!/usr/bin/env bun
// Models whether the lightning->liquid "bridge" usage is fee-positive for us
// at a given rebalance batch size.
//
// The mechanic:
//  - A user funds via Lightning (we receive into our LN channels) and withdraws
//    via Liquid (we pay out of our Liquid hot wallet). Net: LN balance grows,
//    Liquid balance shrinks. We charge config.fee.liquid (0.1%) on the liquid
//    send, NOT offset by their credit:liquid (they bank credit:lightning from
//    the receive, which is a different key) — so we collect ~0.1% of throughput.
//  - To refill Liquid we must rebalance: close LN channels (on-chain BTC back to
//    our cl wallet) then peg-in to Liquid. That costs on-chain fees, amortized
//    over how much we move per rebalance.
//
// Revenue from bridging X sats of throughput = X * liquid_fee.
// Cost to rebalance that X = (channel closes to free X) + 1 peg-in tx.
// Break-even: revenue >= cost.
//
// Usage: bun scripts/rebalance-economics.ts [--feerate SAT_VB] [--avg-channel BTC] [--liquid-fee 0.001]

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};

const SATS = 100_000_000;
const liquidFee = arg("--liquid-fee", 0.001); // config.fee.liquid = 0.1%
const feerate = arg("--feerate", 1.01); // sat/vB; current mutual_close ~1.01
const avgChannelBtc = arg("--avg-channel", 0.3); // avg local balance freed per close

// tx vsizes (vBytes)
const MUTUAL_CLOSE_VB = 170; // 1 funding input + 2 outputs
const PEGIN_VB = 150; // consolidate freed outputs -> 1 peg-in send (BTC side)

function closesNeeded(btc: number) {
  return Math.max(1, Math.ceil(btc / avgChannelBtc));
}

function rebalanceCostSats(btc: number) {
  const closes = closesNeeded(btc);
  const closeFees = closes * MUTUAL_CLOSE_VB * feerate;
  const peginFee = PEGIN_VB * feerate; // one batched peg-in per rebalance
  return { closes, closeFees, peginFee, total: closeFees + peginFee };
}

function revenueSats(btc: number) {
  return btc * SATS * liquidFee;
}

console.log("═".repeat(70));
console.log("  LIGHTNING -> LIQUID BRIDGE ECONOMICS");
console.log(`  liquid fee ${(liquidFee * 100).toFixed(2)}% | close feerate ${feerate} sat/vB | avg channel ${avgChannelBtc} BTC`);
console.log("═".repeat(70));
console.log(
  "\n  batch     revenue      closes  close+pegin cost   net        margin",
);
console.log("  " + "-".repeat(64));

for (const btc of [0.1, 0.25, 0.5, 1, 2, 5, 10]) {
  const rev = revenueSats(btc);
  const c = rebalanceCostSats(btc);
  const net = rev - c.total;
  const margin = (net / rev) * 100;
  const tag = net >= 0 ? "PROFIT" : "LOSS";
  console.log(
    `  ${(btc + " BTC").padEnd(8)} ${(Math.round(rev) + "").padStart(9)}s   ${(c.closes + "").padStart(4)}    ${(Math.round(c.total) + "").padStart(10)}s     ${(Math.round(net) + "").padStart(8)}s   ${margin.toFixed(1).padStart(6)}%  ${tag}`,
  );
}

// Break-even batch size: revenue(btc) = cost(btc). With closes ~ btc/avgChannel,
// cost grows ~linearly too, so solve numerically.
let beBtc = 0;
for (let b = 0.001; b <= 50; b += 0.001) {
  if (revenueSats(b) >= rebalanceCostSats(b).total) {
    beBtc = b;
    break;
  }
}
console.log("\n  " + "-".repeat(64));
if (beBtc) {
  console.log(`  Break-even: rebalancing >= ${beBtc.toFixed(3)} BTC per batch is fee-positive.`);
} else {
  console.log(`  Never breaks even in range — cost scales with throughput as fast as revenue.`);
}

// The deeper truth: because closes scale with throughput, per-sat margin is
// roughly constant. Show the asymptotic per-BTC economics.
const big = rebalanceCostSats(10);
const bigRev = revenueSats(10);
console.log(
  `\n  At scale (per 1 BTC bridged): revenue ${Math.round(revenueSats(1))}s, ` +
    `rebalance cost ~${Math.round(rebalanceCostSats(1).total)}s, ` +
    `net ~${Math.round(revenueSats(1) - rebalanceCostSats(1).total)}s`,
);
console.log("═".repeat(70));
process.exit(0);
