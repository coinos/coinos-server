(function() {
  const bcoin = require('bcoin')
  const config = require('./config')
  const db = require('./redis')
  const twilio = require('twilio')
  const sg = require('sendgrid')(config.sendgrid_token)

  module.exports = {
    init: function(app) {
      let users = {}
      const chain = new bcoin.chain({
        db: 'leveldb',
        name: 'spvchain',
        location: __dirname + '/db/spvchain',
        spv: true
      })
      const pool = new bcoin.pool({
        chain: chain,
        spv: true,
        size: 1,
        maxPeers: 1,
        seeds: ['dctrl.ca']
      })
      pool.open().then(function() {
        db.keysAsync("user:*").then(function(keys) {
          Promise.all(keys.map(function(key) {
            db.hgetallAsync(key).then(function(user) {
              if (user.address) {
                pool.watchAddress(user.address)
                users[user.address] = {
                  email: user.email,
                  currency: user.currency,
                  symbol: user.symbol,
                  phone: user.phone
                }
              }
            })
          }))
        })

        pool.connect().then(function() { pool.startSync() })

        pool.on('error', function(err) {
          console.log(err)
        })

        pool.on('tx', function(tx) {
          var address, client, i, len, output, ref, results, value
          ref = tx.outputs
          results = []
          for (i = 0, len = ref.length; i < len; i++) {
            output = ref[i]
            value = (output.value / 100000000).toFixed(8)
            address = output.getAddress().toBase58()
            if (Object.keys(users).includes(address)) {
              app.render('payment', {
                value: value,
                address: address
              }, function(err, html) {
                let helper = require('sendgrid').mail
                let from_email = new helper.Email('info@coinos.io')
                let to_email = new helper.Email(users[address].email)
                let subject = 'Received Payment'
                let content = new helper.Content('text/html', html)
                let mail = new helper.Mail(from_email, subject, to_email, content)
                let request = sg.emptyRequest({
                  method: 'POST',
                  path: '/v3/mail/send',
                  body: mail.toJSON()
                })
                sg.API(request, function(error, response) {
                  console.log(response.statusCode)
                  console.log(response.body)
                  console.log(response.headers)
                })
              })
              if (users[address].phone) {
                client = new twilio.RestClient(config.twilio_sid, config.twilio_token)
                results.push(client.messages.create({
                  to: user.phone,
                  from: config.twilio_number,
                  body: "You received a payment of " + value + " BTC"
                }, function(err, message) {
                  console.log(message.sid)
                }))
              } else {
                results.push(void 0)
              }
            } else {
              results.push(void 0)
            }
          }
          return results
        })
      })
    }
  }

}).call(this)
