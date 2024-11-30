import got from "got";
import { g } from "$lib/db";
import { l, err } from "$lib/logging";
import { getPayment } from "$lib/utils";

const query = `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) { 
  orderMarkAsPaid(input: $input) { 
    order { id } 
    userErrors { 
      field
      message
    }
  }
}`;

export default async (req, res) => {
  const {
    body: { hash },
    params: { id },
  } = req;
  const p = await getPayment(hash);
  const user = await g(`user:${p.uid}`);

  l("marking shopify order paid", id, user.username, p.id, user.shopifyStore);

  try {
    const r = await got
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

    l("shopify success", r);

    res.send(r);
  } catch (e) {
    err("problem marking shopify order as paid", e.message);
  }
};
