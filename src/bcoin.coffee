bcoin = require('bcoin')
config = require('./config')
db = require('./redis')
twilio = require('twilio')

module.exports =
  init: (app) ->
    users = {}

    chain = new bcoin.chain(
      db: 'leveldb'
      name: 'spvchain'
      location: __dirname + '/db/spvchain'
      spv: true
    )

    pool = new bcoin.pool(
      chain: chain
      spv: true
      size: 1
      maxPeers: 1
      seeds: ['dctrl.ca']
    )

    pool.logger.level = 4

    pool.open().then(->
      db.keysAsync("user:*").then((keys) ->
        Promise.all(keys.map((key) ->
          db.hgetallAsync(key).then((user) ->
            console.log(key)
            console.log(user)
            if user.address
              pool.watchAddress(user.address)
              users[user.address] = 
                email: user.email
                currency: user.currency
                symbol: user.symbol
                phone: user.phone
          )
        ))
      )

      pool.connect()
      pool.startSync()

      pool.on('error', (err) -> 
        console.log(err)
      )

      pool.on('tx', (tx) ->
        console.log(tx)

        for output in tx.outputs
          value = (output.value / 100000000).toFixed(8)
          address = output.getAddress().toBase58()
          if Object.keys(users).includes(address)
            app.render('payment', { value: value, address: address }, (err, html) ->
              debugger
              console.log(users[address])
              helper = require('sendgrid').mail
              from_email = new helper.Email('info@coinos.io')
              to_email = new helper.Email(users[address].email)
              subject = 'Received Payment'
              content = new helper.Content('text/html', html)
              mail = new helper.Mail(from_email, subject, to_email, content)

              sg = require('sendgrid')(config.sendgrid_token)
              request = sg.emptyRequest(
                method: 'POST'
                path: '/v3/mail/send'
                body: mail.toJSON()
              )

              sg.API(request, (error, response) ->
                console.log(response.statusCode)
                console.log(response.body)
                console.log(response.headers)
              )
            )

            if users[address].phone
              client = new twilio.RestClient(config.twilio_sid, config.twilio_token)

              client.messages.create(
                to: user.phone
                from: config.twilio_number
                body: "You received a payment of #{value} BTC"
              , (err, message) ->
                console.log(message.sid)
              )
      )
    )
