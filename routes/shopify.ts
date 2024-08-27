import got from "got";
import { g } from "$lib/db";
import { err } from "$lib/logging";

let query = `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) { 
  orderMarkAsPaid(input: $input) { 
    order { id } 
    userErrors { 
      field
      message
    }
  }
}`;

export default async (req, res) => {
  let {
    body: { hash },
    params: { id },
  } = req;
  let p = await g(`payment:${hash}`);
  if (typeof p === "string") p = await g(`payment:${p}`);
  let user = await g(`user:${p.uid}`);

  try {
    let r = await got
      .post(
        `https://${user.shopifyStore}.myshopify.com/admin/api/2023-07/graphql.json`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": user.shopifyToken,
          },
          json: {
            query,
            variables: { input: { id: `gid://shopify/Order/${id}` } },
          },
        },
      )
      .json();

    res.send(r);
  } catch (e) {
    err("problem marking shopify order as paid", e.message);
  }
};
