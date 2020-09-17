const axios = require("axios");
const crypto = require("crypto");

let fetchAssets;
(fetchAssets = async () => {
  try {
    const { data: assets } = await axios.get(
      "https://assets.blockstream.info/"
    );
    const accounts = await db.Account.findAll({
      group: ["asset"],
    });

    Object.keys(assets).map((a) => (assets[a].registered = true));

    accounts.map((a) => {
      if (!assets[a.asset]) assets[a.asset] = a;
    });

    app.set('assets', assets);
  } catch (e) {
    l.error("error fetching assets", e.message);
    res.status(500).send("error fetching assets");
  }

  setTimeout(fetchAssets, 7200000);
})();

app.get("/assets", ah(async (req, res) => {
  if (app.get('assets')) res.send(app.get('assets'));
  else app.status(500).send('Problem fetching blockstream asset registry data');
}));

app.post("/assets", auth, ah(async (req, res) => {
  try {
    const sha256 = crypto.createHash("sha256");
    const { id: user_id } = req.user;
    const token_address = await lq.getNewAddress("", "legacy");
    const asset_address = await lq.getNewAddress("", "legacy");
    const blind = false;
    const info = await lq.getAddressInfo(asset_address);
    const { pubkey: issuer_pubkey } = info;

    const {
      domain,
      name,
      asset_amount,
      token_amount,
      precision,
      ticker,
    } = req.body;
    const version = 0;

    const contract = {
      entity: { domain },
      issuer_pubkey,
      name,
      precision,
      ticker,
      version,
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
      contract_hash,
    };

    params.asset_amount = asset_amount / (SATS / 10 ** precision);

    l.info("asset_amount", params.asset_amount);
    if (token_amount) {
      params.token_amount = token_amount;
      params.token_address = token_address;
      params.token_amount = parseInt(params.token_amount);
    }

    let ria;
    try {
      ria = await lq.rawIssueAsset(funded.hex, [params]);
    } catch (e) {
      l.info(asset_amount, token_amount, params);
      throw new Error(e.message);
    }

    const { asset, hex, token } = ria[0];
    const brt = await lq.blindRawTransaction(hex, true, [], false);
    const srt = await lq.signRawTransactionWithWallet(brt);
    const allowed = (await lq.testMempoolAccept([srt.hex]))[0].allowed;
    if (allowed) {
      const txid = await lq.sendRawTransaction(srt.hex);

      await db.transaction(async (transaction) => {
        let account = await db.Account.findOne({
          where: {
            user_id,
            asset: config.liquid.btcasset,
            pubkey: null,
          },
          include: {
            model: db.User,
            as: "user",
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });

        let { user } = account;

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
        emit(user.username, "account", account);

        account = await db.Account.create(
          {
            asset,
            contract,
            domain,
            user_id,
            ticker,
            precision,
            name,
            balance: 0,
            network: 'liquid',
            pending: params.asset_amount * SATS,
          },
          { transaction }
        );

        emit(user.username, "account", account);

        const asset_payment = await db.Payment.create(
          {
            account_id: account.id,
            user_id,
            hash: txid,
            amount: params.asset_amount * SATS,
            received: true,
            confirmed: false,
            address: asset_address,
            network: "liquid",
          },
          { transaction }
        );
        emit(user.username, "payment", asset_payment);

        issuances[txid] = {
          user_id,
          asset,
          asset_amount: params.asset_amount,
          asset_payment_id: asset_payment.id,
        };

        if (token_amount) {
          account = await db.Account.create(
            {
              asset: token,
              user_id,
              domain,
              ticker: `${ticker}REISSUANCETOKEN`,
              precision: 8,
              name: `${name} Reissuance Token`,
              balance: 0,
              pending: token_amount * SATS,
            },
            { transaction }
          );
          emit(user.username, "account", account);

          const token_payment = await db.Payment.create(
            {
              account_id: account.id,
              user_id,
              hash: txid,
              amount: token_amount * SATS,
              received: true,
              confirmed: false,
              address: token_address,
              network: "liquid",
            },
            { transaction }
          );
          emit(user.username, "payment", token_payment);

          issuances[txid].token = token;
          issuances[txid].token_amount = token_amount;
          issuances[txid].token_payment_id = token_payment.id;
        }
      });

      res.send(issuances[txid]);
    }
  } catch (e) {
    l.error("asset issuance failed", e.message);
    res.status(500).send(e.message);
  }
}));

app.post("/assets/register", auth, ah(async (req, res) => {
  const { asset } = req.body;
  const account = await db.Account.findOne({
    where: {
      user_id: req.user.id,
      asset,
    },
  });

  try {
    const { data: result } = await axios.post(
      "https://assets.blockstream.info/",
      {
        asset_id: asset,
        contract: account.contract,
      }
    );
    l.info("register asset result", req.user.username, result);
    res.send(result);
  } catch (e) {
    l.error("asset registration failed", e.message);
    res.status(500).send(e.message);
  }
}));
