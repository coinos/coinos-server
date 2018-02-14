import ba from 'bitcoinaverage'
import bitcoin from 'bitcoinjs-lib'
import bodyParser from 'body-parser'
import cache from './cache'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'fs'
import grpc from 'grpc'
import passport from './passport'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { graphqlExpress, graphiqlExpress } from 'apollo-server-express'
import zmq from 'zmq'


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
  const lnrpc = await require('lnrpc')({ server: 'localhost:10001' })
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
  const addresses = await db['User'].findAll({
    attributes: ['address'],
  }).map(u => u.address)

  console.log(addresses)

  const zmqSock = zmq.socket('sub')
  zmqSock.connect('tcp://127.0.0.1:18503')
  zmqSock.subscribe('rawblock')
  zmqSock.subscribe('rawtx')

  zmqSock.on('message', async (topic, message, sequence) => {
    topic = topic.toString('utf8')
    message = message.toString('hex')

    switch (topic) {
      case 'rawtx': {
        let tx = bitcoin.Transaction.fromHex(message)
        let total = tx.outs.reduce((a, b) => a + b.value, 0)
        console.log(total)
        tx.outs.map(o => {
          try {
            let address = bitcoin.address.fromOutputScript(o.script, bitcoin.networks.testnet)
            console.log(address, o.value)
            if (addresses.includes(address)) {
              console.log('HIT!')
            } 
          } catch(e) { }
        })

        io.emit('tx', message)
        break
      } 

      case 'rawblock': {
        let block = bitcoin.Block.fromHex(message)
        console.log(block.getHash())
        break
      } 
    }
  })

  app.get('/balance', async (req, res) => {
    res.json(await lnrpc.walletBalance({witness_only: true}, meta))
  })

  app.post('/sendPayment', async (req, res) => {
    const payments = lnrpc.sendPayment(meta, {})
    payments.write({ payment_request: req.body.payreq })
    res.end()
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

  app.post('/login', (req, res) => {
    db.User.findOne({
      where: {
        username: req.body.username
      } 
    }).then((user) => {
      bcrypt.compare(req.body.password, user.password).then((result) => {
        if (result) {
          let payload = { username: user.username }
          let token = jwt.sign(payload, process.env.SECRET)
          res.cookie('token', token, { expires: new Date(Date.now() + 9999999) })
          res.json({ user, token })
        } else {
          res.status(401).end()
        }
      }).catch((err) => {
        console.log(err)
        res.status(401).end()
      })
    }).catch((err) => {
      console.log(err)
      res.status(401).end()
    })
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
    console.error(err.stack)
    return res.end()
  })

  server.listen(3000)
})()
