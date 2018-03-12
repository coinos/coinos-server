import ba from 'bitcoinaverage'
import bcrypt from 'bcrypt'
import bitcoin from 'bitcoinjs-lib'
import bodyParser from 'body-parser'
import bolt11 from 'bolt11'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import core from 'bitcoin-core'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import grpc from 'grpc'
import io from 'socket.io'
import jwt from 'jsonwebtoken'
import reverse from 'buffer-reverse'
import zmq from 'zmq'

import cache from './cache'

import { graphqlExpress, graphiqlExpress } from 'apollo-server-express'

dotenv.config()
const l = console.log

;(async () => {
  const restClient = ba.restfulClient(process.env.BITCOINAVERAGE_PUBLIC, process.env.BITCOINAVERAGE_SECRET)

  const lna = await require('lnrpc')({ server: 'localhost:10001', tls: '/home/adam/.lnd.testa/tls.cert' })
  const maca = fs.readFileSync('/home/adam/.lnd.testa/admin.macaroon')
  const meta = new grpc.Metadata()
  meta.add('macaroon', maca.toString('hex'))
  lna.meta = meta

  const lnb = await require('lnrpc')({ server: 'localhost:10002', tls: '/home/adam/.lnd.testb/tls.cert' })
  const macb = fs.readFileSync('/home/adam/.lnd.testb/admin.macaroon')
  const metab = new grpc.Metadata()
  metab.add('macaroon', macb.toString('hex'))
  lnb.meta = metab

  const bc = new core({ 
    username: 'adam',
    password: 'MPJzfq97',
    network: 'testnet',
  })

  const app = express()
  app.enable('trust proxy')
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(bodyParser.json())
  app.use(cookieParser())
  app.use(cors({ credentials: true, origin: 'http://*:*' }))
  app.use(compression())

  const server = require('http').Server(app)
  const socket = io(server, { origins: '*:*' })
  const db = await require('./db')(lna)
  const passport = require('./passport')(db)
  const auth = passport.authenticate('jwt', { session: false })
  const sids = {}

  socket.use((socket, next) => {
    try {
      let token = socket.request.headers.cookie.match(`;\\s*token=([^;]+)`)[1]
      let user = jwt.decode(token).username
      socket.request.user = user
      sids[user] = socket.id
    } catch (e) { /* */ }
    next()
  })

  socket.sockets.on('connect', socket => {
    socket.emit('success', {
      message: 'success logged in!',
      user: socket.request.user
    })
  })

  app.use(passport.initialize())

  const handlePayment = async msg => {
    let invoice = await db['Invoice'].findOne({
      include: { model: db['User'], as: 'user' },
      where: {
        payreq: msg.payment_request
      }
    })

    if (!invoice) return

    invoice.user.channelbalance += parseInt(msg.value)
    l(invoice.user.username, msg.value)
    await invoice.user.save()
 
    socket.to(sids[invoice.user.username]).emit('invoice', msg)
  } 

  const invoices = lna.subscribeInvoices({})
  invoices.on('data', handlePayment)

  const invoicesb = lnb.subscribeInvoices({})
  invoicesb.on('data', handlePayment)

  const zmqSock = zmq.socket('sub')
  zmqSock.connect('tcp://127.0.0.1:18503')
  zmqSock.subscribe('rawblock')
  zmqSock.subscribe('rawtx')

  const seen = []
  const channelpeers = [
    '039cc950286a8fa99218283d1adc2456e0d5e81be558da77dd6e85ba9a1fff5ad3',
    '022ea315e5052b152579e70a90bacfd6aa7420f2ce94674d4ca8da29d709bc70fd',
    '02ece82b43452154392772d63c0a244f1592f0d29037c88020118889b76851173f',
    '02fa77e0f4ca666f7d158c4bb6675d1436e339903a9feeeaacbd6e55021b98e7ee',
  ]

  zmqSock.on('message', async (topic, message, sequence) => {
    const addresses = {}
    await db['User'].findAll({
      attributes: ['username', 'address'],
    }).map(u => { addresses[u.address] = u.username })

    topic = topic.toString('utf8')
    message = message.toString('hex')

    switch (topic) {
      case 'rawtx': {
        if (seen.includes(message)) return

        let tx = bitcoin.Transaction.fromHex(message)
        let total = tx.outs.reduce((a, b) => a + b.value, 0)
        tx.outs.map(async o => {
          try {
            let address = bitcoin.address.fromOutputScript(o.script, bitcoin.networks.testnet)
            if (Object.keys(addresses).includes(address)) {
              let user = await db['User'].findOne({
                where: {
                  username: addresses[address],
                }
              })

              user.balance += o.value
              await user.save()
              socket.emit('tx', message)
              seen.push(message)
            } 
          } catch(e) { }
        })

        break
      } 

      case 'rawblock': {
        let block = bitcoin.Block.fromHex(message)
        l('block', block.getHash().toString('hex'))
        break
      } 
    }
  })

  app.post('/openchannel', auth, async (req, res) => {
    if (req.user.balance < 200000) {
      res.status(500).send('Need at least 200000 satoshis for channel opening')
      return
    }

    let pending = await lna.pendingChannels({}, meta)
    let busypeers = pending.pending_open_channels.map(c => c.channel.remote_node_pub)
    let peer = channelpeers.find(p => !busypeers.includes(p))
    let sent = false
    
    if (!peer) {
      res.status(500).send('All peers have pending channel requests, try again later')
    }
    
    try {
      let amount = Math.min(req.user.balance, 16777216)
      
      let channel = await lna.openChannel({
        node_pubkey: new Buffer(peer, 'hex'),
        local_funding_amount: amount,
      })
      
      channel.on('data', async data => {
        if (sent || !data.chan_pending) return
        req.user.channelbalance += amount
        req.user.balance -= amount
        req.user.channel = reverse(data.chan_pending.txid).toString('hex')
        await req.user.save()
        res.send(data)
        sent = true
      })

      channel.on('error', err => {
        return res.status(500).send(err.message)
      })
    } catch (err) {
      l(err)
      return res.status(500).send(err)
    } 
  })

  app.post('/closechannels', auth, async (req, res) => {
    req.user.balance += req.user.channelbalance
    req.user.channelbalance = 0
    await req.user.save()
    res.send(req.user)
  })


  app.post('/faucet', auth, async (req, res) => {
    await bc.walletPassphrase('kek', 30000)
    await bc.sendToAddress(req.user.address, 0.001)
    res.send('success')
  })

  app.post('/test', auth, async (req, res) => {
    res.send(req.user)
  })

  app.post('/sendPayment', auth, async (req, res) => {
    await req.user.reload()

    if (req.user.channelbalance < bolt11.decode(req.body.payreq).satoshis) {
      return res.status(500).send('Not enough satoshis')
    } 
    
    const payments = lna.sendPayment(meta, {})
    payments.write({ payment_request: req.body.payreq })

    payments.on('data', async m => {
      if (m.payment_error) {
        res.status(500).send(m.payment_error)
      } else {
        if (seen.includes(m.payment_preimage)) return
        seen.push(m.payment_preimage)

        let total = parseInt(m.payment_route.total_amt) + parseInt(m.payment_route.total_fees)
        req.user.channelbalance -= total

        await req.user.save()
        res.send(m)
      }
    })

    payments.on('error', e => {
      res.status(500).send(e.message)
    })
  }) 

  app.post('/sendCoins', auth, async (req, res) => {
    await req.user.reload()
    const MINFEE = 180

    let { address, amount } = req.body

    if (amount === req.user.balance) {
      amount = req.user.balance - MINFEE
    } 

    if (req.user.balance < amount - MINFEE) {
      res.status(500).send('Not enough funds')
      return
    }

    try {
      let txid = (await lna.sendCoins({ addr: address, amount })).txid
      let txhex = await bc.getRawTransaction(txid)
      let tx = bitcoin.Transaction.fromHex(txhex)

      let input_total = await tx.ins.reduce(async (a, input) => {
        let h = await bc.getRawTransaction(reverse(input.hash).toString('hex'))
        return a + bitcoin.Transaction.fromHex(h).outs[input.index].value
      }, 0)
      let output_total = tx.outs.reduce((a, b) => a + b.value, 0)

      let fees = input_total - output_total
      let total = parseInt(amount) + fees

      req.user.balance -= Math.min(req.user.balance, total)
      await req.user.save()

      res.send({ txid, tx, amount, fees })
    } catch (e) {
      l(e)
      res.status(500).send(e.message)
    } 
  }) 

  app.post('/addInvoice', auth, async (req, res) => {
    let invoice = await lnb.addInvoice({ value: req.body.amount })
    
    await db.Invoice.create({
      user_id: req.user.id,
      payreq: invoice.payment_request,
    })

    res.send(invoice)
  })

  let fetchRates
  (fetchRates = () => {
    restClient.tickerGlobalPerSymbol('BTCCAD', (data) => {
      app.set('rates', JSON.parse(data))
    })
    setTimeout(fetchRates, 150000)
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

      if (!user) throw new Error('User not found')

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

  app.get('/secret', passport.authenticate('jwt', { session: false }), (req, res) => {
    res.send({message: 'Success! You can not see this without a token'})
  })

  app.get('/api/users/me',
    passport.authenticate('basic', { session: false }),
    function(req, res) {
      res.send({ id: req.user.id, username: req.user.username });
  });

  app.use('/graphql', bodyParser.json(), graphqlExpress({ 
    schema: db.gqlschema,
    context: {},
    tracing: true,
    cacheControl: true,
  }))

  app.use('/graphiql', graphiqlExpress({ endpointURL: '/graphql' }))

  app.use(function (err, req, res, next) {
    res.status(500)
    res.send('An error occurred')
    l(err.stack)
    return res.end()
  })

  server.listen(3000)
})()
