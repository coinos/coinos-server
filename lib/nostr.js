import { Relay, RelayPool } from "nostr";
import { got } from "got";
import { broadcast } from "$lib/sockets";

const { relays } = await got("https://nostr.watch/relays.json").json();
const pool = RelayPool(relays);

let coinos;
pool.on("open", (relay) => {
  if (relay.url.includes("coinos")) coinos = relay;
  relay.subscribe("subid", { limit: 1 });
});

let seen = [];
pool.on("event", (relay, sub_id, ev) => {
  if (seen.includes(ev.id)) return;
  if (Math.abs(Math.floor(Date.now()/1000) - ev.created_at) > 7200) return;
  seen.push(ev.id);
  seen.length > 1000 && seen.shift();

  if (
    coinos &&
    ev.kind < 5 &&
    !ev.content.startsWith("test") &&
    !ev.content.startsWith("running branle")
  ) {
    let parsed;
    try {
      parsed = JSON.parse(ev.content);
    } catch (e) {
      parsed = ev.content;
    }

    coinos.send(["EVENT", ev]);
    if (ev.kind === 1)
      broadcast("event", ev);
  }
});

function formatDate(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  var strTime = hours + ":" + minutes;
  return date.getMonth() + 1 + "/" + date.getDate() + " " + strTime;
}
