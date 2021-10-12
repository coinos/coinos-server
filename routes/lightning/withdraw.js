module.exports = ah(async (req, res) => {
    let { amount, memo, payreq } = req.body;
    let { user } = req;

    try {
        res.send(await send(amount, memo, payreq, user, true));
    } catch (e) {
        l.error("problem sending lightning withdrawal", user.username, e.message, e.stack);
        res.status(500).send(e.message);
    }
});
