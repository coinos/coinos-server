module.exports = async (req, res) => {
  let { payreq } = req.body;
  let { amount, route } = req.body;
  let { user } = req;

  try {
    res.send(await send(amount, pr, user));
  } catch (e) {
    l.error("problem sending lightning payment", user.username, e.message);
    throw new Error(e.message);
    return res.status(500).send(e.message);
  }
};
