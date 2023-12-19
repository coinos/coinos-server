import config from "$config";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(
    config.vapid.url,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
}

export const notify = async (user, payload) => {
  try {
    let { subscriptions } = user;

    if (subscriptions) {
      let i = 0;
      for (let subscription of subscriptions) {
        i++;
        try {
          await webpush.sendNotification(subscription, payload);
        } catch (e) {
          if (
            e.body &&
            (e.body.includes("expired") || e.body.includes("No such"))
          ) {
            user.subscriptions.splice(i, 1);
            await user.save();
          } else {
            err("problem sending notification", e);
          }
        }
      }
    }
  } catch (e) {
    console.log("problem notifying", e);
  }
};
