import ba from 'bitcoinaverage'
import bcrypt from 'bcrypt'
import bitcoin from 'bitcoinjs-lib'
import bodyParser from 'body-parser'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import grpc from 'grpc'
import jwt from 'jsonwebtoken'
import reverse from 'buffer-reverse'
import zmq from 'zmq'

import cache from './cache'
import passport from './passport'

import { graphqlExpress, graphiqlExpress } from 'apollo-server-express'


dotenv.config()
const l = console.log

;(async () => {
  const app = express()
  app.enable('trust proxy')
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(bodyParser.json())
  app.use(cookieParser())
  app.use(cors())
  app.use(compression())
  app.use(passport.initialize())

  const server = require('http').createServer(app)
  const io = require('socket.io').listen(server)
  io.origins('http://localhost:8085')

  const restClient = ba.restfulClient(process.env.BITCOINAVERAGE_PUBLIC, process.env.BITCOINAVERAGE_SECRET)
  const lnrpc = await require('lnrpc')({ 
    server: 'localhost:10001', 
    tls: '/home/adam/.lnd.testa/tls.cert',
    macaroon: '/home/adam/.lnd.testa/admin.macaroon',
  })
  const adminMacaroon = fs.readFileSync('/home/adam/.lnd.testa/admin.macaroon')
  const meta = new grpc.Metadata()
  meta.add('macaroon', adminMacaroon.toString('hex'))
  lnrpc.meta = meta

  const invoices = lnrpc.subscribeInvoices({}, meta)
  invoices.on('data', msg => {
    let io = socketio()
    io.emit('invoices', msg)
  })

  const db = await require('./db.js')(lnrpc)
  const zmqSock = zmq.socket('sub')
  zmqSock.connect('tcp://127.0.0.1:18503')
  zmqSock.subscribe('rawblock')
  zmqSock.subscribe('rawtx')

  const seen = []

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
              io.emit('tx', message)
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

  app.get('/balance', async (req, res) => {
    res.json(await lnrpc.walletBalance({witness_only: true}, meta))
  })

  app.get('/pendingchannels', async (req, res) => {
    res.json(await lnrpc.pendingChannels({}, meta))
  })

  app.post('/openchannel', async (req, res) => {
    let user = await db['User'].findOne({
      where: {
        username: req.body.username,
      }
    })

    let channel = lnrpc.openChannelSync({
      node_pubkey_string: '022ea315e5052b152579e70a90bacfd6aa7420f2ce94674d4ca8da29d709bc70fd',
      local_funding_amount: user.balance,
    }, meta, async (err, data) => {
      if (err) {
        l(err)
        return res.status(500).send(err)
      }

      user.balance = 0
      user.channel = reverse(data.funding_txid).toString('hex')

      let list = await lnrpc.listChannels({}, meta)
      let channels = list.channels.filter(c => c.channel_point.includes(user.channel))

      if (channels.length) {
        user.channelbalance =  channels[0].local_balance
      }
      
      await user.save()

      res.json(data)
    })
  })

  app.get('/channelbalance', async (req, res) => {
    let user = await db['User'].findOne({
      where: {
        username: req.query.username,
      }
    })

    let data = await lnrpc.listChannels({}, meta)
    let channels = data.channels.filter(c => c.channel_point.includes(user.channel))
    if (channels.length) {
      res.json({ balance: channels[0].local_balance })
    } else {
      res.status(500).send({ error: 'No channel found' })
    }
  })

  app.post('/sendPayment', async (req, res) => {
    const payments = lnrpc.sendPayment(meta, {})
    payments.write({ payment_request: req.body.payreq })
    payments.on('data', m => {
      res.json(m)
    })
  }) 

  app.post('/addInvoice', async (req, res) => {
    res.json(await lnrpc.addInvoice({ value: req.body.amount }, meta))
  })

  let fetchRates
  (fetchRates = () => {
    restClient.tickerGlobalPerSymbol('BTCCAD', (data) => {
      app.set('rates', JSON.parse(data))
    })
    setTimeout(fetchRates, 120000)
  })()

  app.get('/rates', (req, res) => {
    res.json(app.get('rates'))
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
        res.json({ user, token })
      } else {
        res.status(401).end()
      }
    } catch(err) {
      res.status(401).end()
    }
  })

  app.get('/secret', passport.authenticate('jwt', { session: false }), (req, res) => {
    res.json({message: 'Success! You can not see this without a token'})
  })

  app.get('/api/users/me',
    passport.authenticate('basic', { session: false }),
    function(req, res) {
      res.json({ id: req.user.id, username: req.user.username });
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
