import app from "$app.js";
import config from "$config/index.js";
import fs from "fs";
import Imap from "imap";
import { inspect } from "util";
import persist from "./persist.js";
const emails = persist("data/emails.json");
import { rates } from "./store.js";

let imap = new Imap(config.imap);
function openInbox(cb) {
  imap.openBox("INBOX", true, cb);
}

app.post("/contact-sil", (req, res) => {
  const mailgun = require("mailgun-js")(config.mailgun);
  let data = {
    subject: "Contact form",
    text: JSON.stringify(req.body),
    from: "server@coinos.io",
    to: "testsil@coinos.io"
  };

  mailgun.messages().send(data);
  res.send(req.body);
});

app.post("/contact", (req, res) => {
  const mailgun = require("mailgun-js")(config.mailgun);
  let data = {
    subject: "Contact form",
    text: JSON.stringify(req.body),
    from: "server@coinos.io",
    to: "contact@coinos.io"
  };

  mailgun.messages().send(data);
  res.send(req.body);
});

imap.once("ready", function() {
  openInbox(function(err, box) {
    if (err) throw err;
    setInterval(() => {
      let f = imap.seq.fetch(`${box.messages.total - 5}:*`, {
        bodies: ["TEXT"],
        struct: true
      });

      f.on("message", function(msg, seqno) {
        const prefix = "(#" + seqno + ") ";
        msg.on("body", function(stream, info) {
          let buffer = "";
          stream.on("data", function(chunk) {
            //stream.pipe(fs.createWriteStream('msg-' + seqno + '-body.txt', {flags:'a+'});
            buffer += chunk.toString("utf8");
          });
          stream.once("end", async function() {
            let accounts = config.imap.accounts;
            let a = Object.keys(accounts).find(a => buffer.includes(a));
            let user_id = accounts[a];

            if (!emails[seqno] && user_id) {
              let cad = parseFloat(
                buffer
                  .replace(/.*\$(.*)\.\d\d \(CAD\).*/gms, "$1")
                  .replace(",", "")
              );
              emails[seqno] = cad;

              try {
                await db.transaction(async transaction => {
                  const account = await db.Account.findOne({
                    where: {
                      user_id,
                      asset: config.liquid.btcasset,
                      pubkey: null
                    },
                    include: {
                      model: db.User,
                      as: "user"
                    },
                    lock: transaction.LOCK.UPDATE,
                    transaction
                  });

                  let { user } = account;

                  let rate = store.rates["CAD"] * 1.02;
                  let amount = Math.round((cad / rate) * 100000000);

                  await account.increment({ balance: amount }, { transaction });

                  let payment = await db.Payment.create({
                    account_id: account.id,
                    user_id: account.user_id,
                    hash: `Interac deposit: ${cad} CAD`,
                    amount,
                    currency: "CAD",
                    rate,
                    received: true,
                    tip: 0,
                    confirmed: true,
                    address: "",
                    network: "COINOS"
                  });
                  payment = payment.get({ plain: true });
                  payment.account = account.get({ plain: true });

                  emit(user.username, "account", account);
                  emit(user.username, "payment", payment);

                  l(
                    "interac deposit detected for",
                    user.username,
                    cad,
                    amount
                  );
                });
              } catch (e) {
                console.log(e);
              }
            }
          });
        });
        msg.once("end", function() {
          // console.log(prefix + 'Finished');
        });

        imap.seq.addFlags(seqno, ["Seen"]);
      });
    }, 10000);
  });
});

imap.connect();
