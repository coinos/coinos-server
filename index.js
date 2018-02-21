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

  const db = await require('./db')(lna)
  const passport = require('./passport')(db)
  const auth = passport.authenticate('jwt', { session: false })

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

  const invoices = lna.subscribeInvoices({})
  invoices.on('data', msg => {
    io.emit('invoices', msg)
  })

  const invoicesb = lnb.subscribeInvoices({})
  invoicesb.on('data', msg => {
    io.emit('invoices', msg)
  })

  const zmqSock = zmq.socket('sub')
  zmqSock.connect('tcp://127.0.0.1:18503')
  zmqSock.subscribe('rawblock')
  zmqSock.subscribe('rawtx')

  zmqSock.on('message', async (topic, message, sequence) => {
    const addresses = {}
    await db['User'].findAll({
      attributes: ['username', 'address'],
    }).map(u => { addresses[u.address] = u.username })

    topic = topic.toString('utf8')
    message = message.toString('hex')

    switch (topic) {
      case 'rawtx': {
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

  app.post('/openchannel', async (req, res) => {
    let user = await db['User'].findOne({
      where: {
        username: req.body.username,
      }
    })

    let channel = lna.openChannelSync({
      node_pubkey_string: '022ea315e5052b152579e70a90bacfd6aa7420f2ce94674d4ca8da29d709bc70fd',
      local_funding_amount: user.balance,
    }, async (err, data) => {
      if (err) {
        l(err)
        return res.status(500).send(err)
      }

      user.balance = 0
      user.channel = reverse(data.funding_txid).toString('hex')
      await user.save()
      res.json(data)
    })
  })

  app.post('/sendPayment', auth, (req, res) => {
    const payments = lna.sendPayment(meta, {})
    payments.write({ payment_request: req.body.payreq })
    payments.on('data', async m => {
      req.user.channelbalance -= m.value
      await req.user.save()
      res.json(m)
    })
  }) 

  app.post('/addInvoice', auth, async (req, res) => {
    let invoice = await lnb.addInvoice({ value: req.body.amount })
    
    await db.Invoice.create({
      user_id: req.user.id,
      payreq: invoice.payment_request,
    })

    res.json(invoice)
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
