import { g, s } from "$lib/db";
import config from "$config";
import { SquareClient } from "square";
import { v4 } from "uuid";

const { appId, environment } = config.square;

export const squarePayment = async (user) => {
  let square = await g(`${user.id}:square`);

  let client = new SquareClient({
    environment,
  });

  const { refreshToken } = square;

  square = await client.oAuth.obtainToken({
    clientId: appId,
    grantType: "refresh_token",
    refreshToken,
  });

  await s(`${user.id}:square`, square);

  const { accessToken } = square;

  client = new SquareClient({
    token: accessToken,
    environment,
  });

  // const payments = await authedClient.payments.list({});
  // console.log(payments);
  const locs = await client.locations.list({});

  const pay = await client.payments.create({
    sourceId: "EXTERNAL",
    idempotencyKey: v4(),
    amountMoney: {
      amount: BigInt(1000),
      currency: "CAD",
    },
    // appFeeMoney: {
    //   amount: BigInt(10),
    //   currency: "CAD",
    // },
    autocomplete: true,
    externalDetails: { type: "OTHER", source: `Coinos ${v4()}` },
    locationId: locs.locations[0].id,
    referenceId: v4(),
    note: `Brief description ${v4()}`,
  });

  console.log(pay);
};
