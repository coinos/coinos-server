export default async (req, res) => {
  let { amount, route, memo, payreq } = req.body;
  let { user } = req;

  try {
    res.send(await send(amount, memo, payreq, user));
  } catch (e) {
    err(
      "problem sending lightning payment",
      user.username,
      payreq,
      e.message
    );
    res.status(500).send(e.message);
  }
};
