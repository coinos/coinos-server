import config from "$config";
import app from "$lib/app";
import { sendArk } from "$lib/ark";
import { admin, auth, optional } from "$lib/auth";
import { g, s } from "$lib/db";

import { fixBolt12, listenForLightning, replay } from "$lib/lightning";
import { l } from "$lib/logging";
import { startHealthCheck } from "$lib/health";
import { getLocations } from "$lib/locations";
import {
  hashPins,
  migrateAccounts,
  migrateAutowithdraw,
  migrateBalancesToTB,
  migrateFundsToTB,
  migrateToMicrosats,
} from "$lib/migrate";
import nwc from "$lib/nwc";
import { catchUp, check } from "$lib/payments";
import { getFx } from "$lib/rates";
import { sendHeartbeat, websocket } from "$lib/sockets";
import { initTigerBeetle } from "$lib/tb";
import { startZmq } from "$lib/zmq";
import { listenForDMs } from "$lib/dmNotifications";
import { initMlsIndex } from "$lib/mls";

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
import square from "$routes/square";
import users from "$routes/users";

try {
  await initTigerBeetle();
  getLocations();
  getFx();
  nwc();
  check();
  startHealthCheck();
  startZmq();
  catchUp();
  migrateAccounts().then((n) => n && console.log(`Migrated ${n} accounts`));
  migrateBalancesToTB().then((n) => n && console.log(`Migrated ${n} balances to TB`));
  migrateToMicrosats().then((n) => n && console.log(`Migrated ${n} users to microsats`));
  migrateAutowithdraw().then((n) => n && console.log(`Migrated autowithdraw to ${n} accounts`));
  migrateFundsToTB().then((n) => n && console.log(`Migrated ${n} funds to TB`));
  hashPins().then((n) => n && console.log(`Hashed ${n} user PINs`));
} catch (e) {
  console.log(e);
}

setTimeout(listenForLightning, 2000);
listenForDMs();
initMlsIndex();
setInterval(sendHeartbeat, 2000);

app.get("/balances", info.balances);
app.get("/health", info.health);
app.post("/email", email.send);

app.get("/fx", rates.fx);
app.get("/rate", rates.last);
app.get("/rates", rates.index);

app.get("/locations", locations.list);
app.get("/locations/nearby", locations.nearby);

app.get("/invoice/:id", invoices.get);
app.get("/invoices", auth, invoices.list);
app.post("/invoice", optional, invoices.create);
app.post("/invoice/:id", optional, invoices.update);
app.post("/sign", auth, invoices.sign);

app.get("/assetlinks.json", (_c) => {
  return new Response(Bun.file("assetlinks.json"));
});
app.get("/mls/users", nostr.mlsUsers);
app.get("/nostr.json", nostr.identities);
app.get("/profile/:profile", nostr.profile);
app.get("/:pubkey/count", nostr.count);
app.get("/:pubkey/followers", nostr.followers);
app.get("/:pubkey/follows", nostr.follows);
app.get("/:pubkey/events", nostr.events);
app.get("/event/:id", nostr.event);
app.get("/event/:id/full", nostr.event);
app.post("/event", auth, nostr.publish);
app.post("/parseEvent", nostr.parse);
app.get("/zaps/:id", nostr.zaps);
app.post("/zap", auth, nostr.zap);
app.post("/zapRequest", auth, nostr.zapRequest);
app.get("/thread/:id", nostr.thread);

app.get("/info", payments.info);
app.post("/sendinvoice", auth, payments.sendinvoice);
app.post("/payments", auth, payments.create);
app.get("/payments", auth, payments.list);
app.get("/payments/:hash", payments.get);
app.post("/parse", auth, payments.parse);
app.get("/funds", auth, payments.funds);
app.get("/fund/:id", payments.fund);
app.get("/fund/:name/managers", payments.managers);
app.post("/fund/managers", auth, payments.addManager);
app.post("/fund/:name/managers/delete", auth, payments.deleteManager);
app.post("/authorize", auth, payments.authorize);
app.get("/fund/:id/authorizations", payments.listAuthorizations);
app.post("/fund/:id/authorization/:authId/delete", auth, payments.deleteAuthorization);
app.post("/take", auth, payments.take);
app.post("/print", auth, payments.print);
app.post("/send/:lnaddress/:amount", auth, payments.lnaddress);
app.post("/send", auth, payments.internal);
app.post("/gateway", payments.gateway);
app.post("/bump", auth, payments.bump);
app.post("/bump/estimate", auth, payments.bumpEstimate);
app.get("/decode/:bolt11", payments.decode);
app.post("/fetchinvoice", payments.fetchinvoice);
app.get("/ark/address", payments.arkAddress);
app.post("/ark/receive", auth, payments.arkReceive);
app.post("/ark/sync", auth, payments.arkSync);
app.post("/bitcoin/sync", auth, payments.bitcoinSync);

app.get("/square/connect", auth, square.connect);
app.get("/square/auth", auth, square.auth);
app.post("/square/payment", square.payment);

app.get("/encode", lnurl.encode);
app.get("/decode", lnurl.decode);
app.get("/lnurl/verify/:id", lnurl.verify);
app.get("/lnurlp/:username", lnurl.lnurlp);
app.get("/lnurl/:id", lnurl.lnurl);
app.get("/pay/:username", lnurl.pay);
app.get("/pay/:username/:amount", lnurl.pay);

app.post("/freeze", payments.freeze);

app.post("/confirm", payments.confirm);
app.post("/bitcoin/tx", payments.txWebhook);
app.post("/bitcoin/fee", auth, payments.fee);
app.post("/bitcoin/send", auth, payments.send);
app.post("/ark/send", auth, payments.ark);
app.post("/ark/vault-send", auth, payments.arkVaultSend);
app.post("/ark/vault-receive", auth, payments.arkVaultReceive);

app.post("/account/delete", auth, users.deleteAccount);
app.post("/user/delete", auth, users.deleteUser);
app.get("/account/:id", auth, users.account);
app.post("/account/:id", auth, users.updateAccount);
app.get("/accounts", auth, users.accounts);
app.post("/accounts", auth, users.createAccount);

app.get("/users", auth, users.list);
app.get("/me", auth, users.me);
app.get("/ro", auth, users.ro);
app.get("/credits", auth, users.credits);
app.get("/users/delete/:username", users.del);
app.get("/users/:key", users.get);
app.post("/register", users.create);
app.post("/disable2fa", auth, users.disable2fa);
app.post("/2fa", auth, users.enable2fa);
app.post("/user", auth, users.update);
app.post("/reset", optional, users.reset);
app.post("/upload/:type", users.upload);
app.post("/acl", users.acl);
app.post("/superuser", users.superuser);
app.get("/verify/:code", users.verify);
app.post("/request", auth, users.request);
app.post("/forgot", users.forgot);
app.post("/login", users.login);
app.post("/flash", users.flash);
app.get("/challenge", users.challenge);
app.post("/authKeyLogin", users.authKeyLogin);
app.post("/nostrAuth", users.nostrAuth);
app.post("/passkey/register/options", auth, users.passkeyRegisterOptions);
app.post("/passkey/register/verify", auth, users.passkeyRegisterVerify);
app.post("/passkey/login/options", users.passkeyLoginOptions);
app.post("/passkey/login/verify", users.passkeyLoginVerify);
app.get("/app/:pubkey", auth, users.app);
app.get("/apps", auth, users.apps);
app.post("/app", auth, users.updateApp);
app.post("/apps/delete", auth, users.deleteApp);

app.post("/pins", auth, users.addPin);
app.post("/pins/delete", auth, users.deletePin);

app.get("/trust", auth, users.trust);
app.post("/trust", auth, users.addTrust);
app.post("/trust/delete", auth, users.deleteTrust);

app.get("/subscriptions", auth, users.subscriptions);
app.post("/subscription", auth, users.subscription);
app.post("/subscription/delete", auth, users.deleteSubscription);
app.post("/password", auth, users.password);
app.post("/pin", auth, users.pin);
app.post("/otpsecret", auth, users.otpsecret);
app.get("/contacts/:limit?", auth, users.contacts);

app.get("/:id/items", items.list);
app.get("/items/:id", items.get);
app.post("/items", auth, items.create);
app.post("/items/delete", auth, items.del);
app.post("/items/sort", auth, items.sort);

app.post("/shopify/:id", shopify);

app.post("/hidepay", admin, users.hidepay);
app.post("/unlimit", admin, users.unlimit);
app.get("/bolt12", fixBolt12);

app.get("/cash/:id/:version", ecash.get);
app.post("/cash", ecash.save);
app.post("/claim", auth, ecash.claim);
app.post("/mint", auth, ecash.mint);
app.post("/melt", auth, ecash.melt);
app.post("/ecash/:id", ecash.receive);

app.get("/replay/:index", (c) => {
  replay(c.req.param("index"));
  return c.json({});
});

app.post("/echo", async (c) => {
  const body = await c.req.json();
  console.log("echo", body);
  return c.json(body);
});

app.post("/test/ark/send", async (c) => {
  try {
    const secret = c.req.header("x-test-secret");
    if (!config.testSecret || secret !== config.testSecret) {
      return c.json("Forbidden", 403);
    }
    const body = await c.req.json();
    const { address, amount, iid } = body;
    const txid = await sendArk(address, amount);

    if (iid) {
      const invoice = await g(`invoice:${iid}`);
      if (invoice) {
        invoice.received = (invoice.received || 0) + amount;
        await s(`invoice:${iid}`, invoice);
      }
    }

    return c.json({ txid, iid });
  } catch (e: any) {
    return c.json(e.message, 500);
  }
});

const host_: string = process.env["HOST"] || "0.0.0.0";
const port: number = Number.parseInt(process.env["PORT"]) || 3119;

Bun.serve({
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws" && server.upgrade(req)) return;
    return app.fetch(req, server);
  },
  websocket,
  port,
  hostname: host_,
});

l(`coinos server listening on ${host_}:${port}`);

const logerr = (e: Error) => console.log(e);
process.on("unhandledRejection", logerr);
process.on("uncaughtException", logerr);
