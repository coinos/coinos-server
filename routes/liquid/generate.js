module.exports = ah(async (req, res) => {
  let address = await lq.getNewAddress();
  await lq.generateToAddress(1, address);
  res.end();
});
