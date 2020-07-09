module.exports = async (req, res) => {
  let { payreq } = req.body;
  let { amount, route } = req.body;
  let { user } = req;

  try {
    res.send(await send(amount, payreq, user));
  } catch (e) {
    l.error("problem sending lightning payment", user.username, e.message);
    res.status(500).send(e.message);
    throw new Error(e.message);
  }
};
