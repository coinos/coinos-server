export default ah(async (req, res) => {
  const { payreq } = req.body;

  const invoice = await db.Invoice.findOne({
    include: {
      attributes: ['username'],
      model: db.User,
      as: "user"
    },
    where: {
      text: payreq,
    }
  });

  if (invoice) emit(req.user.username, "to", invoice.user);
  res.end();
});
