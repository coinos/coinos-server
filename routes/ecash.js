import { CashuMint, CashuWallet, MintQuoteState } from '@cashu/cashu-ts';

export default {
  async mint({ body }, res) {
    const mintUrl = 'http://mint:3338'; // the mint URL
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint);
    const mintQuote = await wallet.createMintQuote(64);
    console.log(mintQuote)
    // pay the invoice here before you continue...
    const mintQuoteChecked = await wallet.checkMintQuote(mintQuote.quote);
    console.log(mintQuoteChecked)
    if (mintQuoteChecked.state == MintQuoteState.PAID) {
      const { proofs } = await wallet.mintTokens(64, mintQuote.quote);
      console.log(proofs)
    }
  }
}
