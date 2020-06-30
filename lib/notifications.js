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
    subscriptions.map(async (subscription, i) => {
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (e) {
        if (e.body && e.body.includes('expired')) {
          user.subscriptions.splice(i, 1);
          await user.save(); 
        } else {
          l.error("problem sending notification", e);
        }
      }
    });
  }
};
