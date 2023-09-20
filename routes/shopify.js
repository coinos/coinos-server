import got from "got";

let query = `mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) { 
  orderMarkAsPaid(input: $input) { 
    order { id } 
    userErrors { 
      field
      message
    }
  }
}`;

export default async ({ body, params: { id }, user }, res) => {
  let r = await got.post(
    `https://${user.shopifyStore}.myshopify.com/admin/api/2023-07/graphql.json`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": user.shopifyToken
      },
      json: {
        query,
        variables: { input: { id: `gid://shopify/Order/${id}` } }
      }
    }
  ).json();

  res.send(r);
};
