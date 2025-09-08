import config from "$config";
import { g, s } from "$lib/db";
import { fiat } from "$lib/utils";
import { SquareClient } from "square";
import { v4 } from "uuid";

const { appId, environment } = config.square;

export const squarePayment = async (p, user) => {
  let square = await g(`${user.id}:square`);
  if (!(square && user.syncSquare)) return;

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

  const locs = await client.locations.list({});

  await client.payments.create({
    sourceId: "EXTERNAL",
    idempotencyKey: v4(),
    amountMoney: {
      amount: BigInt(parseFloat(fiat(p.amount, p.rate).toFixed(2)) * 100),
      currency: p.currency,
    },
    tipMoney: p.tip
      ? {
          amount: BigInt(parseFloat(fiat(p.tip, p.rate).toFixed(2)) * 100),
          currency: p.currency,
        }
      : undefined,
    autocomplete: true,
    externalDetails: { type: "OTHER", source: `Coinos payment ${p.id}` },
    locationId: locs.locations[0].id,
    referenceId: v4(),
    note: `Coinos payment ${p.id}`,
  });
};
