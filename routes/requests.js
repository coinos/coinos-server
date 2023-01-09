import app from "$app";
import { auth } from "$lib/passport";
import { emit } from "$lib/sockets";

app.get("/request/:id", auth, async (req, res) => {
  try {
    let request = await db.Request.findOne({
      where: { id: req.params.id },
      include: [
        {
          attributes: ["username", "profile"],
          model: db.User,
          as: "recipient"
        },
        {
          attributes: ["username", "profile"],
          model: db.User,
          as: "requester"
        },
        {
          model: db.Invoice,
          as: "invoice"
        }
      ]
    });

    res.send({ request });
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.get("/requests", auth, async (req, res) => {
  try {
    const day = new Date(new Date().setDate(new Date().getDate() - 1));

    let invoices = (
      await db.Request.findAll({
        where: {
          [Op.or]: {
            recipient_id: req.user.id,
            requester_id: req.user.id
          },
          createdAt: { [Op.gt]: day }
        },
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: db.Invoice,
            as: "invoice",
            where: { received: { [Op.lt]: col("invoice.amount") } },
            include: {
              model: db.User,
              as: "user",
              attributes: ["username", "profile"]
            }
          },
          {
            model: db.User,
            as: "requester",
            attributes: ["username", "profile"]
          }
        ]
      })
    )
      .map(
        r =>
          r.invoice && {
            request_id: r.id,
            requester: r.requester.get({ plain: true }),
            ...r.invoice.get({ plain: true })
          }
      )
      .filter(r => r);

    let requests = await db.Request.findAll({
      where: {
        recipient_id: req.user.id,
        createdAt: { [Op.gt]: day },
        invoice_id: { [Op.eq]: null }
      },
      order: [["createdAt", "DESC"]],
      include: {
        attributes: ["username", "profile"],
        model: db.User,
        as: "requester"
      }
    });

    res.send({ invoices, requests });
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post("/requests", auth, async (req, res) => {
  try {
    let { recipient: username, ...params } = req.body;
    let { id: recipient_id } = await db.User.findOne({ where: { username } });

    let request = await db.Request.create({ recipient_id, ...params });
    request = request.get({ plain: true });
    request.requester = {
      username: req.user.username,
      profile: req.user.profile
    };
    emit(username, "request", request);

    res.send(request);
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post("/requests/delete", auth, async (req, res) => {
  try {
    let r = await db.Request.findOne({
      where: {
        id: req.body.request_id,
        [Op.or]: { requester_id: req.user.id, recipient_id: req.user.id }
      }
    });

    if (!r) throw new Error("request not found");
    await r.destroy();

    res.send();
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});
