const webpush = require("web-push");

if (config.vapid) {
  webpush.setVapidDetails(
    config.vapid.url,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

notify = (user, payload) => {
  let { subscriptions } = user;

  if (subscriptions) {
    subscriptions.map(async subscription => {
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (e) {
        l.error("problem sending notification", e);
      }
    });
  }
};
