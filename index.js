import { Client } from 'authy-client'
import axios from 'axios'
import bcrypt from 'bcrypt'
import bodyParser from 'body-parser'
import bolt11 from 'bolt11'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import BitcoinCore from 'bitcoin-core'
import cors from 'cors'
import express from 'express'
import fb from 'fb'
import fs from 'fs'
import graphqlHTTP from 'express-graphql'
import grpc from 'grpc'
import io from 'socket.io'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'
import mailgun from 'mailgun-js'
import uuidv4 from 'uuid/v4'
import reverse from 'buffer-reverse'
import Sequelize from 'sequelize'
import zmq from 'zeromq'

import authyVerify from './authy'
import config from './config'
import whitelist from './whitelist'

const bitcoin = require('bitcoinjs-lib')
const l = console.log

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const authy = new Client({ key: config.authy.key });

(async () => {
  const ln = async ({ server, tls, macaroon, channelpeers }) => {
    const ln = await require('lnrpc')({ server, tls })
    ln.meta = new grpc.Metadata()
    ln.meta.add('macaroon', fs.readFileSync(macaroon).toString('hex'))
    ln.channelpeers = channelpeers
    return ln
  }

  const lna = await ln(config.lna)
  const lnb = await ln(config.lnb)

  const bc = new BitcoinCore(config.bitcoin)

  const app = express()
  app.enable('trust proxy')
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(bodyParser.json())
  app.use(cookieParser())
  app.use(cors({ credentials: true, origin: 'http://*:*' }))
  app.use(compression())
  app.use(morgan('combined'))

  const server = require('http').Server(app)
  const socket = io(server, { origins: '*:*' })
  const db = await require('./db')(lna)
  const passport = require('./passport')(db)
  const auth = passport.authenticate('jwt', { session: false })
  const sids = {}
  const seen = []

  app.use(passport.initialize())

  app.use(
    '/graphql',
    auth,
    graphqlHTTP({
      schema: db.gqlschema,
      graphiql: true,
    })
  )

  socket.use((socket, next) => {
    try {
      let token = socket.handshake.query.token
      let user = jwt.decode(token).username
      socket.request.user = user
      sids[user] ? sids[user].push(socket.id) : (sids[user] = [socket.id])
      sids[socket.id] = user
    } catch (e) {
      l(e)
    }
    next()
  })

  socket.sockets.on('connect', async socket => {
    socket.emit('connected')
    if (app.get('rates')) socket.emit('rate', app.get('rates').ask)
    socket.on('getuser', async (data, callback) => {
      /* eslint-disable-next-line */
      callback(
        await db.User.findOne({
          where: {
            username: socket.request.user,
          },
        })
      )
    })

    socket.on('disconnect', s => {
      let user = sids[socket.id]
      sids[user].splice(sids[user].indexOf(socket.id), 1)
      delete sids[socket.id]
    })
  })

  const emit = (username, msg, data) => {
    if (data.username !== undefined) data = pick(data, ...whitelist)

    if (!sids[username]) return
    sids[username].map((sid, i) => {
      try {
        socket.to(sid).emit(msg, data)
      } catch (e) {
        sids[username].splice(i, 1)
      }
    })
  }

  const handlePayment = async msg => {
    if (!msg.settled) return

    let payment = await db.Payment.findOne({
      include: { model: db.User, as: 'user' },
      where: {
        hash: msg.payment_request,
      },
    })

    if (!payment) return

    payment.received = true
    payment.user.balance += parseInt(msg.value)
    payment.rate = app.get('rates').ask

    await payment.save()
    await payment.user.save()
    payments.push(msg.payment_request)

    emit(payment.user.username, 'invoice', msg)
    emit(payment.user.username, 'user', payment.user)
  }

  const invoices = lna.subscribeInvoices({})
  invoices.on('data', handlePayment)

  const invoicesb = lnb.subscribeInvoices({})
  invoicesb.on('data', handlePayment)

  const zmqRawBlock = zmq.socket('sub')
  zmqRawBlock.connect(config.bitcoin.zmqrawblock)
  zmqRawBlock.subscribe('rawblock')

  const zmqRawTx = zmq.socket('sub')
  zmqRawTx.connect(config.bitcoin.zmqrawtx)
  zmqRawTx.subscribe('rawtx')

  const addresses = {}
  await db.User.findAll({
    attributes: ['username', 'address'],
  }).map(u => {
    addresses[u.address] = u.username
  })

  const payments = (await db.Payment.findAll({
    attributes: ['hash'],
  })).map(p => p.hash)

  zmqRawTx.on('message', async (topic, message, sequence) => {
    message = message.toString('hex')

    let tx = bitcoin.Transaction.fromHex(message)
    let hash = reverse(tx.getHash()).toString('hex')

    if (payments.includes(hash)) return

    tx.outs.map(async o => {
      try {
        let network = config.bitcoin.network
        if (network === 'mainnet') {
          network = 'bitcoin'
        }

        let address = bitcoin.address.fromOutputScript(
          o.script,
          bitcoin.networks[network]
        )

        if (Object.keys(addresses).includes(address)) {
          try {
            payments.push(hash)

            let user = await db.User.findOne({
              where: {
                username: addresses[address],
              },
            })

            let invoices = await db.Payment.findAll({
              limit: 1,
              where: {
                hash: address,
                received: null,
                amount: {
                  [Sequelize.Op.gt]: 0,
                },
              },
              order: [['createdAt', 'DESC']],
            })

            let tip = null
            if (invoices.length) tip = invoices[0].tip

            let confirmed = false

            if (user.friend) {
              user.balance += o.value
              confirmed = true
            } else {
              user.pending += o.value
            }

            await user.save()
            emit(user.username, 'user', user)

            await db.Payment.create({
              user_id: user.id,
              hash,
              amount: o.value,
              currency: 'CAD',
              rate: app.get('rates').ask,
              received: true,
              tip,
              confirmed,
            })

            emit(user.username, 'tx', message)
          } catch (e) {
            l(e)
          }
        }
      } catch (e) {}
    })
  })

  zmqRawBlock.on('message', async (topic, message, sequence) => {
    topic = topic.toString('utf8')
    message = message.toString('hex')

    switch (topic) {
      case 'rawblock': {
        let block = bitcoin.Block.fromHex(message)
        l('block', block.getHash().toString('hex'))

        await db.Payment.findAll({
          include: { model: db.User, as: 'user' },
          where: { confirmed: false },
        }).map(async p => {
          if ((await bc.getRawTransaction(p.hash, true)).confirmations > 0) {
            let user = p.user
            p.confirmed = true
            user.balance += p.amount
            user.pending -= p.amount
            await user.save()
            await p.save()
            emit(user.username, 'user', user)
          }
        })

        socket.emit('block', message)
        break
      }
    }
  })

  app.post('/register', async (req, res) => {
    let err = m => res.status(500).send(m)
    let user = req.body
    if (!user.username) return err('Username required')
    if (user.password.length < 2) return err('Password too short')

    let exists = await db.User.count({ where: { username: user.username } })
    if (exists) return err('Username taken')

    user.address = (await lna.newAddress({ type: 1 }, lna.meta)).address
    user.password = await bcrypt.hash(user.password, 1)
    user.name = user.username
    addresses[user.address] = user.username

    await db.User.create(user)
    res.send(pick(user, ...whitelist))
  })

  const requestEmail = async user => {
    user.emailToken = uuidv4()
    await user.save()

    let mg = mailgun(config.mailgun)
    let msg = {
      from: 'CoinOS <webmaster@coinos.io>',
      to: user.email,
      subject: 'CoinOS Email Verification',
      html: `Visit <a href="https://coinos.io/verifyEmail/${user.username}/${user.emailToken}">https://coinos.io/verify/${user.username}/${user.emailToken}</a> to verify your email address.`,
    }

    try {
      mg.messages().send(msg)
    } catch (e) {
      l(e)
    }
  }

  const requestPhone = async user => {
    user.phoneToken = Math.floor(100000 + Math.random() * 900000)
    await user.save()
    const client = require('twilio')(
      config.twilio.sid,
      config.twilio.authToken
    )

    await client.messages.create({
      body: user.phoneToken,
      from: config.twilio.number,
      to: user.phone,
    })
  }

  app.post('/requestEmail', auth, async (req, res) => {
    req.user.email = req.body.email
    await requestEmail(req.user)
    res.end()
  })

  app.post('/requestPhone', auth, async (req, res) => {
    req.user.phone = req.body.phone
    await requestPhone(req.user)
    res.end()
  })

  app.post('/user', auth, async (req, res) => {
    let { user } = req
    let {
      email,
      phone,
      twofa,
      pin,
      pinconfirm,
      password,
      passconfirm,
    } = req.body

    if (user.email !== email && require('email-validator').validate(email)) {
      user.email = email
      user.emailVerified = false
      requestEmail(user)
    }

    if (user.phone !== phone) {
      user.phone = phone
      user.phoneVerified = false
      requestPhone(user)
    }

    user.email = email
    user.phone = phone
    user.twofa = twofa

    console.log(user.twofa, email, phone)

    if (password && password === passconfirm) {
      user.password = await bcrypt.hash(password, 1)
    }

    if (pin && pin === pinconfirm) user.pin = await bcrypt.hash(pin, 1)

    if (twofa && !user.authyId && user.phoneVerified) {
      try {
        let r = await authy.registerUser({ countryCode: 'CA', email, phone })
        user.authyId = r.user.id
      } catch (e) {
        l(e)
      }
    }

    await user.save()
    emit(req.user.username, 'user', req.user)
    res.send(user)
  })

  app.post('/forgot', async (req, res) => {
    let { user } = req
    let mg = mailgun(config.mailgun)
    let msg = {
      from: 'CoinOS <webmaster@coinos.io>',
      to: user.email,
      subject: 'CoinOS Password Reset',
      html: `Visit <a href="https://coinos.io/reset/${user.username}/${user.token}">https://coinos.io/reset/${user.username}/${user.token}</a> to reset your password.`,
    }

    try {
      mg.messages().send(msg)
    } catch (e) {
      l(e)
    }
  })

  app.get('/verifyEmail/:username/:token', auth, async (req, res) => {
    let user = await db.User.findOne({
      where: {
        username: req.params.username,
        emailToken: req.params.token,
      },
    })

    if (user) {
      user.emailVerified = true
      await user.save()

      emit(user.username, 'user', user)
      emit(user.username, 'emailVerified', true)

      res.end()
    } else {
      res.status(500).send('invalid token or username')
    }
  })

  app.get('/verifyPhone/:username/:token', auth, async (req, res) => {
    let user = await db.User.findOne({
      where: {
        username: req.params.username,
        phoneToken: req.params.token,
      },
    })

    console.log(user, req.params)

    if (user) {
      user.phoneVerified = true
      await user.save()

      emit(user.username, 'user', user)
      emit(user.username, 'phoneVerified', true)
      res.end()
    } else {
      res.status(500).send('invalid token or username')
    }
  })

  app.post('/openchannel', auth, async (req, res) => {
    let err = m => res.status(500).send(m)
    if (req.user.balance < 10000) {
      return err('Need at least 10000 satoshis for channel opening')
    }

    let pending = await lna.pendingChannels({}, lna.meta)
    let busypeers = pending.pending_open_channels.map(
      c => c.channel.remote_node_pub
    )
    let peer = lna.channelpeers.find(p => !busypeers.includes(p))
    let sent = false

    l('channeling')

    if (!peer) {
      res
        .status(500)
        .send('All peers have pending channel requests, try again later')
      return
    }

    try {
      let amount = Math.min(req.user.balance, 16777216)

      let openchannel = async (peer, amount) => {
        let channel = await lna.openChannel({
          node_pubkey: new Buffer(peer, 'hex'),
          local_funding_amount: amount,
        })

        channel.on('data', async data => {
          if (sent || !data.chan_pending) return
          req.user.balance += amount
          req.user.balance -= amount
          req.user.channel = reverse(data.chan_pending.txid).toString('hex')
          await req.user.save()
          emit(req.user.username, 'user', req.user)
          res.send(data)
          sent = true
        })

        channel.on('error', err => {
          l('channel error', peer, err)
          let msg = err.message

          if (
            msg.startsWith('Multiple') ||
            msg.startsWith('You gave') ||
            msg.startsWith('peer')
          ) {
            busypeers.push(peer)
            peer = lna.channelpeers.find(p => !busypeers.includes(p))
            if (peer) {
              return openchannel(peer, amount)
            } else {
              return res
                .status(500)
                .send(
                  "All peers are busy, couldn't open a channel, wait a few blocks and try again"
                )
            }
          }

          if (msg.startsWith('not enough')) {
            msg = 'Server wallet is busy. Wait for a block and try again'
          }

          return res.status(500).send(msg)
        })
      }

      openchannel(peer, amount)
    } catch (err) {
      l('rpc error', peer, err)
      return res.status(500).send(err)
    }
  })

  app.get('/channels', auth, async (req, res) => {
    return res.send(await lna.listChannels())
  })

  app.get('/peers', auth, async (req, res) => {
    return res.send(await lna.listPeers())
  })

  app.post('/sendPayment', auth, async (req, res) => {
    let hash = req.body.payreq
    let payreq = bolt11.decode(hash)
    l('sending lightning', req.user.username, payreq.satoshis)

    if (seen.includes(hash)) {
      return res.status(500).send("Invoice has been paid, can't pay again")
    }

    try {
      await db.transaction(async transaction => {
        let { balance } = await db.User.findOne(
          {
            where: {
              username: req.user.username,
            },
          },
          { transaction }
        )

        if (balance < payreq.satoshis) {
          throw new Error()
        }

        req.user.balance -= payreq.satoshis
        await req.user.save({ transaction })
      })
    } catch (e) {
      return res.status(500).send('Not enough satoshis')
    }

    const stream = lna.sendPayment(lna.meta, {})
    stream.write({ payment_request: req.body.payreq })

    stream.on('data', async m => {
      if (m.payment_error) {
        res.status(500).send(m.payment_error)
      } else {
        if (seen.includes(m.payment_preimage)) return
        seen.push(m.payment_preimage)

        let total = parseInt(m.payment_route.total_amt)
        req.user.balance -= total - payreq.satoshis

        await db.transaction(async transaction => {
          await req.user.save({ transaction })

          await db.Payment.create(
            {
              amount: -total,
              user_id: req.user.id,
              hash,
              rate: app.get('rates').ask,
              currency: 'CAD',
            },
            { transaction }
          )
        })

        emit(req.user.username, 'user', req.user)

        if (payreq.payeeNodeKey === config.lnb.id) {
          let invoice = await lna.addInvoice({ value: payreq.satoshis })
          let payback = lnb.sendPayment(lnb.meta, {})

          /* eslint-disable-next-line */
          let { payment_request } = invoice;
          /* eslint-disable-next-line */
          payback.write({ payment_request });
        }

        seen.push(hash)
        res.send(m)
      }
    })

    stream.on('error', e => {
      let msg = e.message

      res.status(500).send(msg)
    })
  })

  app.get('/friends', auth, async (req, res) => {
    try {
      let friends = (await fb.api(
        `/${req.user.username}/friends?access_token=${req.user.fbtoken}`
      )).data
      friends = await Promise.all(
        friends.map(async f => {
          let pic = (await fb.api(
            `/${f.id}/picture?redirect=false&type=small&access_token=${req.user.fbtoken}`
          )).data
          f.pic = pic.url
          return f
        })
      )

      res.send(friends)
    } catch (e) {
      res
        .status(500)
        .send('There was a problem getting your facebook friends: ', e)
    }
  })

  app.post('/payUser', auth, async (req, res) => {
    let { payuser, amount } = req.body

    let user = await db.User.findOne({
      where: {
        username: payuser,
      },
    })

    if (!user) {
      return res
        .status(500)
        .send("Couldn't find the user you're trying to pay")
    }
    let err = m => res.status(500).send(m)

    let invoice
    try {
      invoice = await lnb.addInvoice({ value: amount })
    } catch (e) {
      return err(e.message)
    }

    let hash = invoice.payment_request

    await db.Payment.create({
      user_id: user.id,
      hash,
      amount,
      currency: 'CAD',
      rate: app.get('rates').ask,
      tip: 0,
    })

    req.url = '/sendPayment'
    req.body.payreq = invoice.payment_request
    return app._router.handle(req, res)
  })

  app.post('/sendCoins', auth, async (req, res) => {
    const MINFEE = 3000

    let { address, amount } = req.body

    l('sending coins', req.user.username, amount, address)

    if (amount === req.user.balance) {
      amount = req.user.balance - MINFEE
    }

    try {
      await db.transaction(async transaction => {
        let { balance } = await db.User.findOne(
          {
            where: {
              username: req.user.username,
            },
          },
          { transaction }
        )

        if (amount > balance) {
          l('amount exceeds balance', amount, balance)
          throw new Error('insufficient funds')
        }

        req.user.balance -= parseInt(amount) + 10000
        await req.user.save({ transaction })
      })
    } catch (e) {
      return res.status(500).send('Not enough satoshis')
    }

    try {
      await bc.walletPassphrase(config.bitcoin.walletpass, 300)
      l('sending transaction')
      let txid = await bc.sendToAddress(
        address,
        (amount / 100000000).toFixed(8)
      )
      l('transaction sent', txid)
      let txhex = await bc.getRawTransaction(txid)
      let tx = bitcoin.Transaction.fromHex(txhex)

      let inputTotal = await tx.ins.reduce(async (a, input) => {
        let h = await bc.getRawTransaction(reverse(input.hash).toString('hex'))
        return a + bitcoin.Transaction.fromHex(h).outs[input.index].value
      }, 0)
      let outputTotal = tx.outs.reduce((a, b) => a + b.value, 0)

      let fees = inputTotal - outputTotal
      let total = Math.min(parseInt(amount) + fees, req.user.balance)
      req.user.balance += 10000 - fees
      if (req.user.balance < 0) req.user.balance = 0

      await db.transaction(async transaction => {
        await req.user.save({ transaction })
        emit(req.user.username, 'user', req.user)

        await db.Payment.create(
          {
            amount: -total,
            user_id: req.user.id,
            hash: txid,
            rate: app.get('rates').ask,
            currency: 'CAD',
          },
          { transaction }
        )
      })

      res.send({ txid, tx, amount, fees })
    } catch (e) {
      l(e)
      res.status(500).send(e.message)
    }
  })

  app.post('/addInvoice', auth, async (req, res) => {
    let err = m => res.status(500).send(m)
    let { amount, address, tip } = req.body

    let invoice
    try {
      invoice = await lnb.addInvoice({ value: amount })
    } catch (e) {
      return err(e.message)
    }

    let hash = invoice.payment_request
    if (address) hash = address

    await db.Payment.create({
      user_id: req.user.id,
      hash,
      amount,
      currency: 'CAD',
      rate: app.get('rates').ask,
      tip,
    })

    res.send(invoice)
  })

  let fetchRates;
  (fetchRates = async () => {
    try {
      let res = await axios.get(
        'https://api.kraken.com/0/public/Ticker?pair=XBTCAD'
      )
      let ask = res.data.result.XXBTZCAD.c[0]
      let now = new Date()
      let ts = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`
      l(ts, 'ask price:', ask)
      app.set('rates', { ask })
      socket.emit('rate', ask)
    } catch (e) {
      l(e)
    }

    setTimeout(fetchRates, 3000)
  })()

  app.get('/rates', (req, res) => {
    res.send(app.get('rates'))
  })

  app.post('/login', async (req, res) => {
    try {
      let user = await db.User.findOne({
        where: {
          username: req.body.username,
        },
      })

      if (
        !user ||
        !(await bcrypt.compare(req.body.password, user.password)) ||
        (user.twofa && !(await authyVerify(user)))
      ) {
        return res.status(401).end()
      }

      let payload = { username: user.username }
      let token = jwt.sign(payload, config.jwt)
      res.cookie('token', token, { expires: new Date(Date.now() + 432000000) })

      user = pick(user, ...whitelist)
      res.send({ user, token })
    } catch (err) {
      res.status(401).end()
    }
  })

  app.post('/facebookLogin', async (req, res) => {
    let { accessToken, userID } = req.body

    let url = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${config.facebook.appToken}`
    let check = await axios.get(url)
    if (!check.data.data.is_valid) return res.status(401).end()

    try {
      let user = await db.User.findOne({
        where: {
          username: req.body.userID,
        },
      })

      if (!user) {
        user = await db.User.create(user)
        user.username = userID
        user.name = (await fb.api(`/me?access_token=${accessToken}`)).name
        user.address = (await lna.newAddress({ type: 1 }, lna.meta)).address
        user.password = await bcrypt.hash(accessToken, 1)
        user.balance = 0
        user.pending = 0
        let friends = (await fb.api(
          `/${userID}/friends?access_token=${accessToken}`
        )).data
        if (friends.find(f => f.id === config.facebook.specialFriend)) {
          user.friend = true
          user.limit = 200
        }
        await user.save()
        addresses[user.address] = user.username
      }

      user.pic = (await fb.api(
        `/me/picture?access_token=${accessToken}&redirect=false`
      )).data.url
      user.fbtoken = accessToken
      await user.save()

      if (user.twofa && !(await authyVerify(user))) res.status(401).end()

      let payload = { username: user.username }
      let token = jwt.sign(payload, config.jwt)
      res.cookie('token', token, { expires: new Date(Date.now() + 432000000) })
      res.send({ user, token })
    } catch (err) {
      l(err)
      res.status(401).end()
    }
  })

  app.post('/buy', auth, async (req, res) => {
    const stripe = require('stripe')(config.stripe)
    const { token, amount, sat } = req.body
    let dollarAmount = parseInt(amount / 100)

    if (dollarAmount > req.user.limit) return res.status(500).end()

    try {
      const charge = await stripe.charges.create({
        amount,
        currency: 'cad',
        description: 'Bitcoin',
        source: token,
      })

      req.user.balance += parseInt(sat)
      req.user.limit -= dollarAmount
      await req.user.save()
      emit(req.user.username, 'user', req.user)

      await db.Payment.create({
        user_id: req.user.id,
        hash: charge.balance_transaction,
        amount: parseInt(sat),
        currency: 'CAD',
        rate: app.get('rates').ask,
        received: true,
        tip: 0,
      })

      res.send(`Bought ${amount}`)
    } catch (e) {
      console.log(e)
      res.status(500).send(e)
    }
  })

  app.post('/order', auth, async (req, res) => {
    await db.Order.create({
      amount: 1,
      price: 2,
      type: 'BUY',
      pair: 'BTC/CAD',
    })
  })

  app.get('/me', async (req, res) => {
    let data = (await fb.api(
      '/me/picture?access_token=EAAEIFqWk3ZAwBAEUfxQdH3T5CBKXmU8d7jQ5OTJBJZBiU1ZAp76lO26nh57WolM4R4JoKks9BCc49s8VrlEm2Ub1GlZCEzVD9fGxzUiranXDErDmR5gDUPKX3BhCsGA649a4hmbldRwKFTsmZCGZCergm9ACspKdTZB0WgFgA9wEdemIRIXuwCygNrymmKDh0Wd8nmoT4Hj3wZDZD&redirect=false'
    )).data
    res.send(data.url)
  })

  app.get('/exchanges', async (req, res) => {
    let r = await axios.get(
      'https://min-api.cryptocompare.com/data/v2/all/exchanges?fsym=BTC&api_key=6dc6d605ac45dcdbbc44d67111a2f03ba42ca8f54c5d4bf21069d2d3e99a89f0'
    )
    res.send(r.data)
  })

  app.get('/currencies', async (req, res) => {
    res.send(['CAD', 'USD'])
  })

  app.get('/balance/:address', async (req, res) => {
    let network = config.bitcoin.network === 'mainnet' ? 'main' : 'test3'
    let { address } = req.params

    try {
      res.send(
        (await axios.get(
          `https://api.blockcypher.com/v1/btc/${network}/addrs/${address}/balance`
        )).data
      )
    } catch (e) {
      res.status(500).send('Problem getting address balance')
    }
  })

  app.use(function (err, req, res, next) {
    res.status(500)
    res.send('An error occurred')
    l(err.stack)
    return res.end()
  })

  server.listen(config.port)
})()
