import config from "$config";
import { createClient } from "redis";
import {
  CashuMint,
  CashuWallet,
  getEncodedTokenV4,
  MintQuoteState,
} from "@cashu/cashu-ts";

const mintUrl = "http://mint:3338"; // the mint URL
const mint = new CashuMint(mintUrl);
const wallet = new CashuWallet(mint);
let amt = 100000;
const mintQuote = await wallet.createMintQuote(amt);
console.log(mintQuote.request);

let interval = setInterval(async () => {
  const mintQuoteChecked = await wallet.checkMintQuote(mintQuote.quote);
  if (mintQuoteChecked.state == MintQuoteState.PAID) {
    const { proofs } = await wallet.mintTokens(amt, mintQuote.quote);

    const token = getEncodedTokenV4({
      token: [{ mint: mintUrl, proofs }],
    });

    let db = createClient({
      url: config.db,
    });

    await db.connect();
    await db.set("cash", token);

    clearInterval(interval);
  }
}, 1000);
