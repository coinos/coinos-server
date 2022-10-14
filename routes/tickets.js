import app from "$app";
import redis from "$lib/redis";
import { auth } from "$lib/passport";

app.get("/ticket", async (req, res) => {
  res.send({ ticket: await redis.lLen("tickets") });
});

app.post("/ticket", auth, async (req, res) => {
  try {
    let { asset } = req.body;
    if (!asset || asset.length !== 64) throw new Error("invalid asset");
    await redis.lPush("tickets", req.body.asset);

    res.send(await redis.lPush("tickets", req.body.asset));
  } catch (e) {
    res.code(500).send(e.message);
  }
});
