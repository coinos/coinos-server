const BitcoinCore = require("bitcoin-core");
const createLnrpc = require("../lib/createLnrpc");

(async () => {
  bc = new BitcoinCore(config.bitcoin);
  lq = new BitcoinCore(config.liquid);

  lna = await createLnrpc(config.lna);
  lnb = await createLnrpc(config.lnb);

  seen = [];
  addresses = {};
  await db.User.findAll({
    attributes: ["username", "address", "liquid"]
  }).map(u => {
    addresses[u.address] = u.username;
    if (u.liquid) addresses[u.liquid] = u.username;
  });

  app.post("/lightning/invoice", auth, require("./lightning/invoice"));
  app.post("/lightning/query", auth, require("./lightning/query"));
  app.post("/lightning/send", auth, require("./lightning/send"));
  app.post("/lightning/user", auth, require("./lightning/user"));

  app.post("/bitcoin/send", auth, require("./bitcoin/send"));
  app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));

  app.post("/liquid/send", auth, require("./liquid/send"));
  app.post("/liquid/fee", auth, require("./liquid/fee"));

  app.get("/payments", auth, async (req, res) => {
    const payments = await db.Payment.findAll({
      where: { user_id: req.user.id },
      order: [["id", "DESC"]]
    });

    emit(req.user.username, "payments", payments);
    res.send(payments);
  });
})();
