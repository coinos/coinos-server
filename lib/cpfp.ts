import config from "$config";
import { db, gf, s } from "$lib/db";
import { l } from "$lib/logging";
import { CHILD_VSIZE, P2A_VALUE, getP2AAddress, isP2AOutput, calculateBumpReserve } from "$lib/p2a";
import { fail, sats } from "$lib/utils";
import rpc from "@coinos/rpc";

const bc = rpc(config.bitcoin);

export function estimateBumpCost(
  parentFee: number,
  parentVsize: number,
  targetFeeRate: number,
): number {
  const packageVsize = parentVsize + CHILD_VSIZE;
  const requiredPackageFee = Math.ceil(targetFeeRate * packageVsize);
  return Math.max(0, requiredPackageFee - parentFee);
}

export async function createCpfpChild(payment: any, targetFeeRate: number) {
  const { hash: parentTxid, p2aVout, parentVsize, fee: parentFee, bumpReserve } = payment;

  if (p2aVout < 0) fail("no P2A output on this transaction");

  const childFee = estimateBumpCost(parentFee, parentVsize, targetFeeRate);
  if (childFee <= 0) fail("transaction already meets target fee rate");
  if (childFee > bumpReserve) fail("bump cost exceeds reserve");

  // Get a confirmed wallet UTXO to fund the child
  const utxos = await bc.listUnspent(1);
  if (!utxos.length) fail("no confirmed wallet UTXOs available for bump");

  const walletUtxo = utxos[0];
  const walletUtxoValue = sats(walletUtxo.amount);
  const p2aValue = 240;

  const changeValue = walletUtxoValue + p2aValue - childFee;
  if (changeValue < 0) fail("wallet UTXO too small for bump");

  // Get a change address from the wallet
  const changeAddress = await bc.getRawChangeAddress();

  // Build child tx inputs
  const inputs = [
    { txid: parentTxid, vout: p2aVout },
    { txid: walletUtxo.txid, vout: walletUtxo.vout },
  ];

  // Build child tx outputs
  const outputs = [{ [changeAddress]: parseFloat((changeValue / 1e8).toFixed(8)) }];

  // Create raw transaction with nVersion=3 (TRUC child must also be v3)
  let raw = await bc.createRawTransaction(inputs, outputs);
  raw = "03000000" + raw.substring(8);

  // Sign — wallet signs the wallet input, P2A input needs no signature (keyless anchor)
  if ((config.bitcoin as any).walletpass) await bc.walletPassphrase((config.bitcoin as any).walletpass, 300);
  const { hex } = await bc.signRawTransactionWithWallet(raw);

  // Verify child vsize ≤ 1000 (TRUC child limit)
  const decoded = await bc.decodeRawTransaction(hex);
  if (decoded.vsize > 1000) fail("child transaction exceeds TRUC 1kvB limit");

  // Try mempool accept, fall back to package submission
  let childTxid: string;
  try {
    const r = await bc.testMempoolAccept([hex]);
    if (r[0].allowed) {
      childTxid = await bc.sendRawTransaction(hex);
    } else {
      // Parent might not be in mempool — try package submission
      const parentHex = await bc.getRawTransaction(parentTxid);
      const pkg = await bc.submitPackage([parentHex, hex]);
      if (pkg["tx-results"]) {
        const results = Object.values(pkg["tx-results"]) as any[];
        const childResult = results[results.length - 1];
        childTxid = childResult?.txid || decoded.txid;
      } else {
        fail("package submission failed");
      }
    }
  } catch (e) {
    // Try package submission as fallback
    try {
      const parentHex = await bc.getRawTransaction(parentTxid);
      const pkg = await bc.submitPackage([parentHex, hex]);
      if (pkg["tx-results"]) {
        const results = Object.values(pkg["tx-results"]) as any[];
        const childResult = results[results.length - 1];
        childTxid = childResult?.txid || decoded.txid;
      } else {
        fail("package submission failed");
      }
    } catch (e2) {
      fail(`bump failed: ${e2.message}`);
    }
  }

  // Update payment
  payment.childTxid = childTxid;
  payment.bumpedFee = childFee;
  await s(`payment:${payment.id}`, payment);

  l("CPFP bump", parentTxid, "->", childTxid, "fee:", childFee);

  return { txid: childTxid, childFee };
}

async function findStuckParent() {
  const paymentIds = await db.sMembers("outgoing:unconfirmed");

  let best: any = null;
  let bestChangeValue = 0;

  for (const pid of paymentIds) {
    const p = await gf(`payment:${pid}`);
    if (!p || p.confirmed || p.p2aVout < 0 || !p.bumpReserve || p.bumpReserve <= 0) continue;

    // Decode the parent to find its change output
    let parentHex: string;
    try {
      parentHex = await bc.getRawTransaction(p.hash);
    } catch {
      continue;
    }

    const decoded = await bc.decodeRawTransaction(parentHex);
    let changeVout = -1;
    let changeValue = 0;

    for (let i = 0; i < decoded.vout.length; i++) {
      const out = decoded.vout[i];
      if (isP2AOutput(out.scriptPubKey.hex)) continue;
      try {
        const info = await bc.getAddressInfo(out.scriptPubKey.address);
        if (info.ismine) {
          changeVout = i;
          changeValue = sats(out.value);
          break;
        }
      } catch {
        continue;
      }
    }

    if (changeVout < 0 || changeValue === 0) continue;

    // Pick the parent with the largest change (most sats available)
    if (changeValue > bestChangeValue) {
      best = { payment: p, parentHex, changeVout, changeValue };
      bestChangeValue = changeValue;
    }
  }

  return best;
}

export async function buildCpfpSend({
  address,
  amount,
  feeRate,
  fees,
}: {
  address: string;
  amount: number;
  feeRate: number;
  fees: any;
}) {
  const parent = await findStuckParent();
  if (!parent) fail("no confirmed UTXOs and no bumpable parent found");

  const { payment: parentPayment, parentHex, changeVout, changeValue } = parent;
  const { hash: parentTxid, p2aVout, parentVsize, fee: parentFee, bumpReserve } = parentPayment;

  const p2aAddress = getP2AAddress();

  // Estimate child vsize: 2-in (P2A + change), 3-out (payment + change + P2A)
  const COMBINED_CHILD_VSIZE = 260;

  // The package fee rate must meet feeRate for the whole package
  const packageVsize = parentVsize + COMBINED_CHILD_VSIZE;
  const requiredPackageFee = Math.ceil(feeRate * packageVsize);
  const totalChildFee = Math.max(0, requiredPackageFee - parentFee);

  // User B pays for the child's own weight at their fee rate
  const userBFee = Math.ceil(feeRate * COMBINED_CHILD_VSIZE);

  // The CPFP subsidy is the extra cost to drag the parent up to feeRate
  const cpfpSubsidy = Math.max(0, totalChildFee - userBFee);

  if (cpfpSubsidy > bumpReserve) fail("parent bump reserve insufficient for CPFP subsidy");

  // If the parent already has a child (sibling eviction), the new child must pay more
  let evictedChildFee = 0;
  if (parentPayment.childTxid) {
    evictedChildFee = parentPayment.bumpedFee || 0;
    if (totalChildFee <= evictedChildFee)
      fail("cannot evict existing child — new fee too low");
  }

  // Calculate change for the child tx
  // Inputs: changeValue + P2A_VALUE
  // Outputs: amount + childChange + P2A_VALUE
  const childChange = changeValue + P2A_VALUE - amount - totalChildFee - P2A_VALUE;
  if (childChange < 0) fail("insufficient funds in parent change for this send");

  // Build inputs
  const inputs = [
    { txid: parentTxid, vout: p2aVout },
    { txid: parentTxid, vout: changeVout },
  ];

  // Build outputs
  const btc = (v: number) => parseFloat((v / 1e8).toFixed(8));
  const outputs: Record<string, number>[] = [{ [address]: btc(amount) }];
  if (childChange >= 547) {
    const changeAddr = await bc.getRawChangeAddress();
    outputs.push({ [changeAddr]: btc(childChange) });
  }
  outputs.push({ [p2aAddress]: btc(P2A_VALUE) });

  // Create v3 raw transaction
  let raw = await bc.createRawTransaction(inputs, outputs);
  raw = "03000000" + raw.substring(8);

  // Sign (only the change input needs signing; P2A is keyless)
  if ((config.bitcoin as any).walletpass) await bc.walletPassphrase((config.bitcoin as any).walletpass, 300);
  const { hex } = await bc.signRawTransactionWithWallet(raw);

  const decoded = await bc.decodeRawTransaction(hex);
  if (decoded.vsize > 1000) fail("combined child exceeds TRUC 1kvB limit");

  // Find the P2A vout in the new child
  let newP2aVout = -1;
  for (let i = 0; i < decoded.vout.length; i++) {
    if (isP2AOutput(decoded.vout[i].scriptPubKey.hex)) {
      newP2aVout = i;
      break;
    }
  }

  // Update the parent payment — charge the CPFP subsidy to the low-baller's reserve
  parentPayment.childTxid = decoded.txid;
  parentPayment.bumpedFee = cpfpSubsidy;
  await s(`payment:${parentPayment.id}`, parentPayment);

  l("CPFP+send via parent", parentTxid, "child:", decoded.txid, "subsidy:", cpfpSubsidy);

  // Calculate User B's bump reserve for this child
  const fastestFee = Math.ceil(fees.fastestFee * 1.5);
  const childBumpReserve = calculateBumpReserve(feeRate, fastestFee, decoded.vsize);

  return {
    hex,
    fee: userBFee,
    parentHex,
    txid: decoded.txid,
    p2aVout: newP2aVout,
    parentVsize: decoded.vsize,
    bumpReserve: childBumpReserve,
    cpfpParentId: parentPayment.id,
    cpfpSubsidy,
  };
}
