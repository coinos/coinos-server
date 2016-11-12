(function() {
  var bcoin, config, db, twilio;

  bcoin = require('bcoin');

  config = require('./config');

  db = require('./redis');

  twilio = require('twilio');

  module.exports = {
    init: function(app) {
      var chain, pool, users;
      users = {};
      chain = new bcoin.chain({
        db: 'leveldb',
        name: 'spvchain',
        location: __dirname + '/db/spvchain',
        spv: true
      });
      pool = new bcoin.pool({
        chain: chain,
        spv: true,
        size: 1,
        maxPeers: 1,
        seeds: ['dctrl.ca']
      });
      pool.logger.level = 4;
      return pool.open().then(function() {
        db.keysAsync("user:*").then(function(keys) {
          return Promise.all(keys.map(function(key) {
            return db.hgetallAsync(key).then(function(user) {
              console.log(key);
              console.log(user);
              if (user.address) {
                pool.watchAddress(user.address);
                return users[user.address] = {
                  email: user.email,
                  currency: user.currency,
                  symbol: user.symbol,
                  phone: user.phone
                };
              }
            });
          }));
        });
        pool.connect();
        pool.startSync();
        pool.on('error', function(err) {
          return console.log(err);
        });
        return pool.on('tx', function(tx) {
          var address, client, i, len, output, ref, results, value;
          console.log(tx);
          ref = tx.outputs;
          results = [];
          for (i = 0, len = ref.length; i < len; i++) {
            output = ref[i];
            value = (output.value / 100000000).toFixed(8);
            address = output.getAddress().toBase58();
            if (Object.keys(users).includes(address)) {
              app.render('payment', {
                value: value,
                address: address
              }, function(err, html) {
                debugger;
                var content, from_email, helper, mail, request, sg, subject, to_email;
                console.log(users[address]);
                helper = require('sendgrid').mail;
                from_email = new helper.Email('info@coinos.io');
                to_email = new helper.Email(users[address].email);
                subject = 'Received Payment';
                content = new helper.Content('text/html', html);
                mail = new helper.Mail(from_email, subject, to_email, content);
                sg = require('sendgrid')(config.sendgrid_token);
                request = sg.emptyRequest({
                  method: 'POST',
                  path: '/v3/mail/send',
                  body: mail.toJSON()
                });
                return sg.API(request, function(error, response) {
                  console.log(response.statusCode);
                  console.log(response.body);
                  return console.log(response.headers);
                });
              });
              if (users[address].phone) {
                client = new twilio.RestClient(config.twilio_sid, config.twilio_token);
                results.push(client.messages.create({
                  to: user.phone,
                  from: config.twilio_number,
                  body: "You received a payment of " + value + " BTC"
                }, function(err, message) {
                  return console.log(message.sid);
                }));
              } else {
                results.push(void 0);
              }
            } else {
              results.push(void 0);
            }
          }
          return results;
        });
      });
    }
  };

}).call(this);
