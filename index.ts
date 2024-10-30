import app from "$lib/app";
import { auth, admin, optional } from "$lib/auth";

import { listenForLightning } from "$lib/lightning";
import { getLocations } from "$lib/locations";
import { catchUp, check } from "$lib/payments";
import { getFx } from "$lib/rates";
import { sendHeartbeat } from "$lib/sockets";
import nwc from "$lib/nwc";

import ecash from "$routes/ecash";
import email from "$routes/email";
import info from "$routes/info";
import invoices from "$routes/invoices";
import items from "$routes/items";
import lnurl from "$routes/lnurl";
import locations from "$routes/locations";
import nostr from "$routes/nostr";
import payments from "$routes/payments";
import rates from "$routes/rates";
import shopify from "$routes/shopify";
import users from "$routes/users";

try {
  getLocations();
  getFx();
  catchUp();
  nwc();
  check();
} catch (e) {
  console.log(e);
}

setTimeout(listenForLightning, 2000);
setInterval(sendHeartbeat, 2000);

app.get("/balances", info.balances);
app.post("/email", email.send);

app.get("/fx", rates.fx);
app.get("/rate", rates.last);
app.get("/rates", rates.index);

app.get("/locations", locations.list);

app.get("/invoice/:id", invoices.get);
app.post("/invoice", optional, invoices.create);

app.get("/nostr.json", nostr.identities);
app.get("/:pubkey/count", nostr.count);
app.get("/:pubkey/followers", nostr.followers);
app.get("/:pubkey/follows", nostr.follows);
app.get("/event/:id", nostr.event);
app.post("/event", auth, nostr.publish);

app.get("/info", payments.info);
app.post("/payments", auth, payments.create);
app.get("/payments", auth, payments.list);
app.get("/payments/:hash", auth, payments.get);
app.post("/parse", auth, payments.parse);
app.get("/fund/:name", payments.fund);
app.get("/fund/:name/withdraw", payments.withdraw);
app.post("/take", auth, payments.take);
app.post("/print", auth, payments.print);
app.post("/send/:lnaddress/:amount", auth, payments.lnaddress);
app.post("/send", auth, payments.internal);
app.post("/gateway", payments.gateway);
app.post("/replace", auth, payments.replace);

app.get("/encode", lnurl.encode);
app.get("/decode", lnurl.decode);
app.get("/lnurl/verify/:id", lnurl.verify);
app.get("/lnurlp/:username", lnurl.lnurlp);
app.get("/lnurl/:id", lnurl.lnurl);

app.post("/freeze", payments.freeze);

app.post("/confirm", payments.confirm);
app.post("/bitcoin/fee", auth, payments.fee);
app.post("/bitcoin/send", auth, payments.send);

app.get("/account/:id", auth, users.account);
app.post("/account/:id", auth, users.updateAccount);
app.get("/accounts", auth, users.accounts);
app.post("/accounts", auth, users.createAccount);
app.post("/account/delete", auth, users.deleteAccount);

app.get("/users", auth, users.list);
app.get("/me", auth, users.me);
app.get("/users/:key", users.get);
app.post("/register", users.create);
app.post("/disable2fa", auth, users.disable2fa);
app.post("/2fa", auth, users.enable2fa);
app.post("/user", auth, users.update);
app.post("/reset", optional, users.reset);
app.post("/upload/:type", users.upload);
app.get("/users/delete/:username", users.del);
app.post("/acl", users.acl);
app.post("/superuser", users.superuser);
app.get("/verify/:code", users.verify);
app.post("/request", auth, users.request);
app.post("/forgot", users.forgot);
app.post("/login", users.login);

app.get("/subscriptions", auth, users.subscriptions);
app.post("/subscription", auth, users.subscription);
app.post("/subscription/delete", auth, users.deleteSubscription);
app.post("/password", auth, users.password);
app.post("/pin", auth, users.pin);
app.post("/otpsecret", auth, users.otpsecret);
app.get("/contacts", auth, users.contacts);

app.get("/:id/items", items.list);
app.get("/items/:id", items.get);
app.post("/items", auth, items.create);
app.post("/items/delete", auth, items.del);
app.post("/items/sort", auth, items.sort);

app.post("/shopify/:id", shopify);

app.post("/hidepay", admin, users.hidepay);
app.post("/unlimit", admin, users.unlimit);

app.get("/cash/:id/:version", ecash.get);
app.post("/cash", ecash.save);
app.post("/claim", auth, ecash.claim);
app.post("/mint", auth, ecash.mint);
app.post("/melt", auth, ecash.melt);

app.post("/echo", (req, res) => {
  console.log("echo", req.body);
  res.send(req.body);
});

let host: string = process.env["HOST"] || "0.0.0.0";
let port: number = parseInt(process.env["PORT"]) || 3119;

app.listen({ host, port });

let logerr = (e: Error) =>
  // (e &&
  //   e.message &&
  //   (e.message.includes("Invalid") ||
  //     e.message.includes("MASK") ||
  //     e.message.includes("Rate"))) ||
  console.log(e);

process.on("unhandledRejection", logerr);
process.on("uncaughtException", logerr);
