export default {
  db: "redis://db",
  nostr: "ws://nostr:8080",
  relays: [
    "ws://nostr:8080",
    "wss://nostr-pub.wellorder.net",
    "wss://brb.io",
    "wss://nostr.v0l.io",
    "wss://relay.nostr.bg",
    "wss://nostr.orangepill.dev"
  ],
  jwt: "00d0ab4f7738a83feb37f661526512063c41e49278b7c32cba87314269a5788b",
  bitcoin: {
    host: "bc",
    wallet: "coinos",
    username: "admin1",
    password: "123",
    network: "regtest",
    port: 18443,
  },
  lightning: "/app/data/lightning/regtest/lightning-rpc"
};
