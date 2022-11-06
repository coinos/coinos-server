import app from "$app";
import db from "$db";
import { auth } from "$lib/passport";
import { emit } from "$lib/sockets";

app.post("/requests", auth, async (req, res) => {
  try {
    let { recipient: username, ...params } = req.body;
    let { id: recipient_id } = await db.User.findOne({ where: { username } });

    let request = await db.Request.create({ recipient_id, ...params });
    request = request.get({ plain: true });
    request.requester = { username: req.user.username };
    emit(username, "request", request);

    res.send(request);
  } catch (e) {
    console.log(e)
    res.code(500).send(e.message);
  }
});
