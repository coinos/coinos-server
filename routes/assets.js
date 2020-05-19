const axios = require("axios");
const crypto = require("crypto");

app.get("/assets", async (req, res) => {
  let assets;
  try {
    assets = await axios.get("https://assets.blockstream.info/");
    res.send(assets.data);
  } catch (e) {
    l.error("error fetching assets", e);
    res.status(500).send("error fetching assets");
  }
});

app.post("/assets", auth, async (req, res) => {
  try {
    const sha256 = crypto.createHash("sha256");
    const { id: user_id } = req.user;
    const token_address = await lq.getNewAddress("", "legacy");
    const asset_address = await lq.getNewAddress("", "legacy");
    const blind = false;
    const info = await lq.getAddressInfo(asset_address);
    const { pubkey: issuer_pubkey } = info;

    const { name, asset_amount, token_amount, precision, ticker } = req.body;
    const domain = "adamsoltys.com";
    const version = 0;

    const contract = {
      entity: { domain },
      issuer_pubkey,
      name,
      precision,
      ticker,
      version
    };

    sha256.update(JSON.stringify(contract));
    const hash = sha256.digest("hex");
    const contract_hash = hash
      .match(/[a-f0-9]{2}/g)
      .reverse()
      .join("");
    const rawtx = await lq.createRawTransaction([], { data: "00" });
    const funded = await lq.fundRawTransaction(rawtx, { feeRate: 0.000003 });
    const params = {
      asset_amount,
      asset_address,
      blind,
      contract_hash
    };

    params.asset_amount = parseInt(params.asset_amount);

    if (token_amount) {
      params.token_amount = token_amount;
      params.token_address = token_address;
      params.token_amount = parseInt(params.token_amount);
    } 

    let ria;
    try {
      ria = await lq.rawIssueAsset(funded.hex, [params]);
    } catch(e) {
      l.info(asset_amount, token_amount, params);
      throw new Error(e.message);
    } 

    const { asset, hex, token } = ria[0];
    const brt = await lq.blindRawTransaction(hex, true, [], false);
    const srt = await lq.signRawTransactionWithWallet(brt);
    const allowed = (await lq.testMempoolAccept([srt.hex]))[0].allowed;
    if (allowed) {
      const txid = await lq.sendRawTransaction(srt.hex);

      await db.transaction(async transaction => {
        let account = await db.Account.findOne({
          where: {
            user_id,
            asset: config.liquid.btcasset
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        if (Math.round(funded.fee * SATS) > account.balance) {
          l.error(
            "amount exceeds balance",
            asset_amount,
            funded.fee,
            account.balance
          );
          throw new Error(`Insufficient funds to pay fee of ${funded.fee} BTC`);
        }

        account.balance -= Math.round(funded.fee * SATS);
        await account.save({ transaction });

        account = await db.Account.create(
          {
            asset,
            user_id,
            ticker,
            precision,
            name,
            balance: 0,
            pending: asset_amount * SATS
          },
          { transaction }
        );

        const asset_payment = await db.Payment.create(
          {
            account_id: account.id,
            user_id,
            hash: txid,
            amount: asset_amount * SATS,
            received: true,
            confirmed: false,
            address: asset_address,
            network: "LBTC"
          },
          { transaction }
        );

        issuances[txid] = {
          user_id,
          asset,
          asset_amount,
          asset_payment_id: asset_payment.id,
        };

        if (token_amount) {
          account = await db.Account.create(
            {
              asset: token,
              user_id,
              ticker: `${ticker}REISSUANCETOKEN`,
              precision: 8,
              name: `${name} Reissuance Token`,
              balance: 0,
              pending: token_amount * SATS
            },
            { transaction }
          );

          const token_payment = await db.Payment.create(
            {
              account_id: account.id,
              user_id,
              hash: txid,
              amount: token_amount * SATS,
              received: true,
              confirmed: false,
              address: token_address,
              network: "LBTC"
            },
            { transaction }
          );

          issuances[txid].token = token;
          issuances[txid].token_amount = token_amount;
          issuances[txid].token_payment_id = token_payment.id;
        }


        let user = await getUserById(user_id, transaction);
        emit(user.username, "user", user);
      });

      res.send(issuances[txid]);
    }
  } catch (e) {
    l.error("asset issuance failed", e.message);
    res.status(500).send(e.message);
  }
});
