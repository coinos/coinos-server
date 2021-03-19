const fs = require("fs");
const Imap = require("imap"),
  inspect = require("util").inspect;

const persist = require("./persist");
const emails = persist("data/emails.json");

let imap = new Imap(config.imap);
function openInbox(cb) {
  imap.openBox("INBOX", true, cb);
}

imap.once("ready", function() {
  openInbox(function(err, box) {
    if (err) throw err;
    let f = imap.seq.fetch(`${box.messages.total - 5}:*`, {
      bodies: ["TEXT"],
      struct: true
    });
    f.on("message", function(msg, seqno) {
      const prefix = "(#" + seqno + ") ";
      msg.on("body", function(stream, info) {
        let buffer = "";
        stream.on("data", function(chunk) {
          //stream.pipe(fs.createWriteStream('msg-' + seqno + '-body.txt', {flags:'a+'}));
          buffer += chunk.toString("utf8");
        });
        stream.once("end", async function() {
          if (!emails[seqno] && buffer.includes(config.imap.secret)) {
            let amount = buffer.replace(/.*\$(.*)\.\d\d \(CAD\).*/gms, "$1");
            emails[seqno] = amount;
            console.log(
              seqno,
              buffer.replace(/.*\$(.*)\.\d\d \(CAD\).*/gms, "$1")
            );

            try {
              await db.transaction(async transaction => {
                const account = await db.Account.findOne({
                  where: {
                    user_id: config.imap.user_id,
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

                let rate = app.get("rates")["CAD"];
                console.log(rate);

                await account.increment({ balance: amount }, { transaction });
                let payment = await db.Payment.create({
                  account_id: account.id,
                  user_id: account.user_id,
                  hash: `Interac deposit: ${amount} CAD`,
                  amount: Math.round((amount / rate) * 100000000),
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
    setInterval(() => {
      f = imap.seq.fetch(`${box.messages.total - 5}:*`, {
        bodies: ["TEXT"],
        struct: true
      });
    }, 3000);
  });
});

imap.connect();
