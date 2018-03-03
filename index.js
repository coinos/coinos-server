import ba from 'bitcoinaverage'
import bcrypt from 'bcrypt'
import bitcoin from 'bitcoinjs-lib'
import bodyParser from 'body-parser'
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
      l(sids)
    } catch (e) { l(e) }
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
    '0231eee2441073c86d38f6085aedaf2bb7ad3d43af4c0e2669c1edd1a7d566ce31',
    '022ea315e5052b152579e70a90bacfd6aa7420f2ce94674d4ca8da29d709bc70fd',
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
        l(total)
        tx.outs.map(async o => {
          try {
            let address = bitcoin.address.fromOutputScript(o.script, bitcoin.networks.testnet)
            l(address, o.value)
            if (Object.keys(addresses).includes(address)) {
              let user = await db['User'].findOne({
                where: {
                  username: addresses[address],
                }
              })

              user.balance += o.value
              await user.save()
              l('HIT!')
              socket.emit('tx', message)
              seen.push(message)
            } 
          } catch(e) { }
        })

        break
      } 

      case 'rawblock': {
        let block = bitcoin.Block.fromHex(message)
        l(block.getHash())
        break
      } 
    }
  })

  app.post('/openchannel', auth, async (req, res) => {
    let pending = await lna.pendingChannels({}, meta)
    let busypeers = pending.pending_open_channels.map(c => c.channel.remote_node_pub)
    let peer = channelpeers.find(p => !busypeers.includes(p))
    
    if (!peer) {
      return res.status(500).send(
        { error: 'All peers have pending channel opens' }
      )
    } 
    
    try {
      let channel = await lna.openChannel({
        node_pubkey: new Buffer(peer, 'hex'),
        local_funding_amount: req.user.balance,
      })
      
      channel.on('data', async data => {
        l(data)
        req.user.channelbalance += req.user.balance
        req.user.balance = 0
        req.user.channel = reverse(data.chan_pending.txid).toString('hex')
        await req.user.save()
        res.send(data)
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

  app.post('/sendPayment', auth, (req, res) => {
    const payments = lna.sendPayment(meta, {})
    payments.write({ payment_request: req.body.payreq })
    payments.on('data', async m => {
      if (m.payment_error) {
        l(m)
        res.status(500).send({ error: m.payment_error })
      } else {
        l(m, req.user.channelbalance)
        req.user.channelbalance -= parseInt(m.payment_route.total_amt)
        await req.user.save()
        res.send(m)
      }
    })
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

      let result = await bcrypt.compare(req.body.password, user.password)
      if (result) {
        let payload = { username: user.username }
        let token = jwt.sign(payload, process.env.SECRET)
        res.cookie('token', token, { expires: new Date(Date.now() + 9999999) })
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
