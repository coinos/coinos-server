import app from "$lib/app";
import { auth, admin, optional } from "$lib/auth";

import { fillPool } from "$lib/nostr";
import { listenForLightning } from "$lib/lightning";
import { getLocations } from "$lib/locations";
import { catchUp } from "$lib/payments";
import { getRates } from "$lib/rates";
import { sendHeartbeat } from "$lib/sockets";
import { err } from "$lib/logging";

import ecash from "$routes/ecash";
import email from "$routes/email";
import info from "$routes/info";
import locations from "$routes/locations";
import lnurl from "$routes/lnurl";
import nostr from "$routes/nostr";
import rates from "$routes/rates";
import invoices from "$routes/invoices";
import items from "$routes/items";
import users from "$routes/users";
import payments from "$routes/payments";
import requests from "$routes/requests";
import shopify from "$routes/shopify";

try {
  fillPool();
  getLocations();
  getRates();
  catchUp();
} catch (e) {
  console.log(e);
}

setTimeout(listenForLightning, 2000);
setInterval(sendHeartbeat, 2000);

app.get("/balances", info.balances);
app.post("/email", email.send);

app.get("/rate", rates.last);
app.get("/rates", rates.index);

app.get("/nostr.json", nostr.identities);
app.get("/:pubkey/followers", nostr.followers);
app.get("/:pubkey/follows", nostr.follows);
app.get("/:pubkey/notes", nostr.notes);
app.get("/:pubkey/:since/messages", nostr.messages);
app.get("/event/:id", nostr.event);
app.post("/event", nostr.broadcast);

app.get("/locations", locations.list);

app.get("/invoice/:id", invoices.get);
app.post("/invoice", optional, invoices.create);

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

app.post("/subscribe", auth, users.subscribe);
app.post("/password", auth, users.password);
app.post("/pin", auth, users.pin);
app.post("/otpsecret", auth, users.otpsecret);
app.get("/contacts", auth, users.contacts);

app.get("/:id/items", items.list);
app.get("/items/:id", items.get);
app.post("/items", auth, items.create);
app.post("/items/delete", auth, items.del);
app.post("/items/sort", auth, items.sort);

app.get("/request/:id", auth, requests.get);
app.get("/requests", auth, requests.list);
app.post("/requests", auth, requests.create);
app.post("/requests/delete", auth, requests.destroy);

app.post("/shopify/:id", shopify);

app.post("/hidepay", admin, users.hidepay);
app.post("/unlimit", admin, users.unlimit);

app.get("/cash/:id", ecash.get);
app.post("/claim", auth, ecash.claim);
app.post("/mint", auth, ecash.mint);
app.post("/melt", auth, ecash.melt);

let host = process.env.HOST || "0.0.0.0";
let port = process.env.PORT || 3119;

app.listen({ host, port });

let logerr = (e) =>
  e.message.includes("Invalid") ||
  e.message.includes("MASK") ||
  e.message.startsWith("Rate") ||
  console.log(e);

process.on("unhandledRejection", logerr);
process.on("uncaughtException", logerr);
