BitcoinCore = require("@asoltys/bitcoin-core");
fs = require("fs");
config = require("./config");
bc = new BitcoinCore(config.bitcoin);
l = require("pino")();
require("./db");

console.log(db.Payment);

(async () => {
  payments = (
    await db.Payment.findAll({
      attributes: ["hash"],
    })
  ).map((p) => p.hash);
  const transactions = await bc.listTransactions("*", 1000);
  var stream = fs.createWriteStream("exceptions", {
    flags: "a",
    emitClose: true,
  });
  transactions.map((tx) => {
    if (!payments.includes(tx.txid)) {
      l.info("writing", tx.txid);
      stream.write(tx.txid + "\n");
    }
  });
  stream.end();
  stream.on("close", () => {
    l.info("done");
    process.exit();
  });
})();
