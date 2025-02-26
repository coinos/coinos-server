import { g } from "$lib/db";

async function migrate(id) {
  const k = id?.replace(/\s/g, "").toLowerCase();
  let user = await g(`user:${k}`);
  if (typeof user === "string") user = await g(`user:${user}`);
  return user;
}

export default migrate;
