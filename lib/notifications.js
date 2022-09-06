import config from "$config";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(
    config.vapid.url,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

export const notify = (user, payload) => {
  let { subscriptions } = user;

  if (subscriptions) {
    subscriptions.map(async (subscription, i) => {
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
    });
  }
};
