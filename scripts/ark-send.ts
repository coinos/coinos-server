import { sendArk } from "../lib/ark";

const address = process.argv[2];
const amount = parseInt(process.argv[3]);

if (!address || !amount) {
  console.log("Usage: bun scripts/ark-send.ts <ark_address> <amount_sats>");
  process.exit(1);
}

console.log(`Sending ${amount} sats to ${address}...`);

sendArk(address, amount)
  .then((result) => {
    console.log("Success!");
    console.log("Result:", JSON.stringify(result, null, 2));
  })
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
