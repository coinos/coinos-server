import config from "$config";
import { s } from "$lib/db";
import { l } from "$lib/logging";
import { CHILD_VSIZE } from "$lib/p2a";
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
