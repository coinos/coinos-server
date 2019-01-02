import axios from 'axios'
import bcrypt from 'bcrypt'
import bitcoin from 'bitcoinjs-lib'
import bodyParser from 'body-parser'
import bolt11 from 'bolt11'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import core from 'bitcoin-core'
import cors from 'cors'
import crypto from 'crypto-js'
import dotenv from 'dotenv'
import express from 'express'
import fb from 'fb'
import fs from 'fs'
import grpc from 'grpc'
import io from 'socket.io'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'
import reverse from 'buffer-reverse'
import Sequelize from 'sequelize'
import zmq from 'zeromq'

import config from './config'

import graphqlHTTP from 'express-graphql'

dotenv.config()
const l = console.log

;(async () => {
  const ln = async ({ server, tls, macaroon, channelpeers }) => {
    const ln = await require('lnrpc')({ server, tls })
    ln.meta = new grpc.Metadata()
    ln.meta.add('macaroon', fs.readFileSync(macaroon).toString('hex'))
    ln.channelpeers = channelpeers
    return ln
  }

  const lna = await ln(config.lna)
  const lnb = await ln(config.lnb)

  const bc = new core(config.bitcoin)

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

  app.use('/graphql', auth, graphqlHTTP({
    schema: db.gqlschema,
    graphiql: true
  }))

  socket.use((socket, next) => {
    try {
      let token = socket.request.headers.cookie.match(`token=([^;]+)`)[1]
      if (!token && socket.handshake.query) {
        token = socket.handshake.query.token
      }

      let user = jwt.decode(token).username
      socket.request.user = user
      sids[user] = socket.id
    } catch (e) { return }
    next()
  })

  socket.sockets.on('connect', async socket => {
    socket.emit('rate', app.get('rates').ask)
    socket.on('getuser', async (data, callback) => {
      callback(await db.User.findOne({
        where: {
          username: socket.request.user,
        }
      }));
    });
  })


  const handlePayment = async msg => {
    if (!msg.settled) return

    let payment = await db.Payment.findOne({
      include: { model: db.User, as: 'user' },
      where: {
        hash: msg.payment_request
      }
    })

    if (!payment) return

    payment.received = true
    payment.user.balance += parseInt(msg.value)
    payment.rate = app.get('rates').ask

    await payment.save()
    await payment.user.save()
    payments.push(msg.payment_request)
 
    socket.to(sids[payment.user.username]).emit('invoice', msg)
    socket.to(sids[payment.user.username]).emit('user', payment.user)
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
  }).map(u => { addresses[u.address] = u.username })

  const payments = (await db.Payment.findAll({ 
    attributes: ['hash']
  })).map(p => p.hash)

  zmqRawTx.on('message', async (topic, message, sequence) => {
    message = message.toString('hex')

    let tx = bitcoin.Transaction.fromHex(message)
    let hash = reverse(tx.getHash()).toString('hex')

    if (payments.includes(hash)) return
    let total = tx.outs.reduce((a, b) => a + b.value, 0)
    tx.outs.map(async o => {
      try {
        let network = config.bitcoin.network
        if (network === 'mainnet') {
          network = 'bitcoin'
        } 

        let address = bitcoin.address.fromOutputScript(
          o.script, 
          bitcoin.networks[network],
        )

        if (Object.keys(addresses).includes(address)) {
          try {
            payments.push(hash)

            let user = await db.User.findOne({
              where: {
                username: addresses[address],
              }
            })

            let invoices = await db.Payment.findAll({
              limit: 1,
              where: {
                hash: address,
                received: null,
                amount: {
                  [Sequelize.Op.gt]: 0
                } 
              },
              order: [ [ 'createdAt', 'DESC' ]]
            })

            let tip = null
            if (invoices.length) tip = invoices[0].tip

            if (user.friend)
              user.balance += o.value
            else 
              user.pending += o.value

            await user.save()
            socket.to(sids[user.username]).emit('user', user)
            
            await db.Payment.create({
              user_id: user.id,
              hash,
              amount: o.value,
              currency: 'CAD',
              rate: app.get('rates').ask,
              received: true,
              tip
            })

            socket.to(sids[user.username]).emit('tx', message)
          } catch (e) { l(e) }
        } 
      } catch(e) {}
    })
  })

  zmqRawBlock.on('message', async (topic, message, sequence) => {
    topic = topic.toString('utf8')
    message = message.toString('hex')

    switch (topic) {
      case 'rawblock': {
        let block = bitcoin.Block.fromHex(message)
        l('block', block.getHash().toString('hex'))

        await db.User.findAll({
          attributes: ['id', 'pending'],
          where: { 
            pending: { 
              [Sequelize.Op.ne]: null,
              [Sequelize.Op.ne]: 0,
            } 
          },
        }).map(async user => { 
          user.balance += user.pending
          user.pending = 0
          await user.save() 
          socket.to(sids[user.username]).emit('user', user)
        })
        
        await db.Payment.update({
          confirmed: true,
        }, { where: {} })

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
    addresses[user.address] = user.username
    res.send(await db.User.create(user))
  })

  app.post('/user', async (req, res) => {
    await db['User'].update(user, { where: { username: user.username } })
  })

  app.post('/openchannel', auth, async (req, res) => {
    let err = m => res.status(500).send(m)
    if (req.user.balance < 10000) return err('Need at least 10000 satoshis for channel opening')

    let pending = await lna.pendingChannels({}, lna.meta)
    let busypeers = pending.pending_open_channels.map(c => c.channel.remote_node_pub)
    let peer = lna.channelpeers.find(p => !busypeers.includes(p))
    let sent = false

    l('channeling')
    
    if (!peer) {
      res.status(500).send('All peers have pending channel requests, try again later')
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
          socket.to(sids[req.user.username]).emit('user', req.user)
          res.send(data)
          sent = true
        })

        channel.on('error', err => {
          l('channel error', peer, err)
          let msg = err.message

          if (msg.startsWith('Multiple') || msg.startsWith('You gave') || msg.startsWith('peer')) {
            busypeers.push(peer)
            peer = lna.channelpeers.find(p => !busypeers.includes(p))
            if (peer) {
              return openchannel(peer, amount)
            } else {
              return res.status(500).send('All peers are busy, couldn\'t open a channel, wait a few blocks and try again')
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

    if (seen.includes(hash)) {
      return res.status(500).send('Invoice has been paid, can\'t pay again')
    } 

    if (req.user.balance < payreq.satoshis) {
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
        req.user.balance -= total

        await db.Payment.create({
          amount: -total,
          user_id: req.user.id,
          hash,
          rate: app.get('rates').ask,
          currency: 'CAD',
        })

        await req.user.save()
        socket.to(sids[req.user.username]).emit('user', req.user)

        if (payreq.payeeNodeKey === config.lnb.id) {
          let invoice = await lna.addInvoice({ value: payreq.satoshis })
          let payback = lnb.sendPayment(lnb.meta, {})
          let { payment_request } = invoice
          payback.write({ payment_request })
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

  app.post('/payUser', auth, async (req, res) => {
    let { payuser, amount } = req.body

    let user = await db.User.findOne({
      where: {
        username: payuser
      } 
    })

    if (!user) return res.status(401).end()
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

    if (amount === req.user.balance) {
      amount = req.user.balance - MINFEE
    } 

    if (amount > req.user.balance)
      return res.status(401).send('Insufficient funds')

    try {
      await bc.walletPassphrase(config.bitcoin.walletpass, 300)
      let txid = await bc.sendToAddress(address, (amount / 100000000).toFixed(8))
      let txhex = await bc.getRawTransaction(txid)
      let tx = bitcoin.Transaction.fromHex(txhex)

      let input_total = await tx.ins.reduce(async (a, input) => {
        let h = await bc.getRawTransaction(reverse(input.hash).toString('hex'))
        return a + bitcoin.Transaction.fromHex(h).outs[input.index].value
      }, 0)
      let output_total = tx.outs.reduce((a, b) => a + b.value, 0)

      let fees = input_total - output_total
      let total = Math.min(parseInt(amount) + fees, req.user.balance)
      req.user.balance -= total
      await req.user.save()
      socket.to(sids[req.user.username]).emit('user', req.user)

      await db.Payment.create({
        amount: -total,
        user_id: req.user.id,
        hash: txid,
        rate: app.get('rates').ask,
        currency: 'CAD',
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

  let fetchRates
  (fetchRates = async () => {
    const nonce = Date.now().toString()
    const conf = config.quad
    const signature = crypto.HmacSHA256(
      nonce + conf.client_id + conf.key, 
      conf.secret
    ).toString()

    try {
      let res = await axios.get('https://api.quadrigacx.com/v2/order_book')
      let ask = res.data.asks[0][0]
      let now = new Date()
      let ts = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`
      l(ts, 'quadriga ask price:', ask)
      app.set('rates', { ask })
      socket.emit('rate', ask)
    } catch (e) { l(e) }

    setTimeout(fetchRates, 30000)
  })()

  app.get('/rates', (req, res) => {
    res.send(app.get('rates'))
  })

  app.post('/login', async (req, res) => {
    try {
      let user = await db.User.findOne({
        where: {
          username: req.body.username
        } 
      })

      if (!user) return res.status(401).end()

      let result = await bcrypt.compare(req.body.password, user.password)
      if (result) {
        let payload = { username: user.username }
        let token = jwt.sign(payload, process.env.SECRET)
        res.cookie('token', token, { expires: new Date(Date.now() + 432000000) })
        res.send({ user, token })
      } else {
        res.status(401).end()
      }
    } catch(err) {
      l(err)
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
          username: req.body.userID
        } 
      })

      if (!user) {
        user = await db.User.create(user)
        user.username = userID
        user.fbtoken = accessToken
        user.address = (await lna.newAddress({ type: 1 }, lna.meta)).address
        user.password = await bcrypt.hash(accessToken, 1)
        let friends = (await fb.api(`/${userID}/friends?access_token=${accessToken}`)).data
        if (friends.find(f => f.id === config.facebook.specialFriend)) {
          user.friend = true
          user.limit = 100
        }
        await user.save()
        addresses[user.address] = user.username
      } 

      let payload = { username: user.username }
      let token = jwt.sign(payload, process.env.SECRET)
      res.cookie('token', token, { expires: new Date(Date.now() + 432000000) })
      res.send({ user, token })
    } catch(err) {
      l(err)
      res.status(401).end()
    }
  })

  app.post('/buy', auth, async (req, res) => {
    const stripe = require('stripe')(config.stripe);
    const { token, amount, sats } = req.body
    let dollarAmount = parseInt(amount / 100)

    if (dollarAmount > req.user.limit) return res.status(401).end()

    try {
      const charge = await stripe.charges.create({
        amount,
        currency: 'cad',
        description: 'Bitcoin',
        source: token,
      })

      req.user.balance += parseInt(sats)
      req.user.limit -= dollarAmount
      await req.user.save()
      socket.to(sids[req.user.username]).emit('user', req.user)

      await db.Payment.create({
        user_id: req.user.id,
        hash: charge.balance_transaction,
        amount: parseInt(sats),
        currency: 'CAD',
        rate: app.get('rates').ask,
        received: true,
        tip: 0
      })

      res.send(`Bought ${amount}`)
    } catch (e) {
      res.status(500).send(e)
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
