import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import passport from './passport'
import cache from './cache'
import dotenv from 'dotenv'
import ba from 'bitcoinaverage'
import fs from 'fs'
import grpc from 'grpc'
import { graphqlExpress, graphiqlExpress } from 'apollo-server-express'
const { makeExecutableSchema } = require('graphql-tools');

// Some fake data
const books = [
  {
    title: "Harry Potter and the Sorcerer's stone",
    author: 'J.K. Rowling',
  },
  {
    title: 'Jurassic Park',
    author: 'Michael Crichton',
  },
];

// The GraphQL schema in string form
const typeDefs = `
  type Query { books: [Book] }
  type Book { title: String, author: String }
`;

// The resolvers
const resolvers = {
  Query: { books: () => books },
};

// Put together a schema
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

dotenv.config()

require('dotenv').config()
const l = console.log

;(async () => {
  const app = express()
  app.enable('trust proxy')
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(bodyParser.json())
  app.use(cookieParser())
  app.use(passport.initialize())

  const users = require('./routes/users')
  const transactions = require('./routes/transactions')
  const restClient = ba.restfulClient(process.env.BITCOINAVERAGE_PUBLIC, process.env.BITCOINAVERAGE_SECRET)
  const lnrpc = await require('lnrpc')({ server: 'localhost:10001' })
  const adminMacaroon = fs.readFileSync('/home/adam/.lnd/data/core_test/admin.macaroon');
  const meta = new grpc.Metadata();
  meta.add('macaroon', adminMacaroon.toString('hex'));


  app.get('/users.json', transactions.index)
  app.post('/login', users.login)
  app.post('/users', users.create)
  app.get('/verify/:token', users.verify)
  app.post('/:user', users.update)
  // app.post('/:user/transactions', transactions.create)
  app.get('/:user/transactions', transactions.index)
  app.post('/transactions/:txid', transactions.update)
  app['delete']('/:user/transactions/:txid', transactions['delete'])
  app.get('/secret', passport.authenticate('jwt', { session: false }), users.secret)
  app.get('/balance', async (req, res) => {
    res.json(await lnrpc.walletBalance({witness_only: true}, meta))
  })

  let fetchRates
  (fetchRates = () => {
    restClient.tickerGlobalPerSymbol('BTCUSD', (data) => {
      app.set('rates', JSON.parse(data))
    })
    setTimeout(fetchRates, 120000)
  })()

  app.get('/rates', (req, res) => {
    res.json(app.get('rates'))
  })

  app.use('/graphql', bodyParser.json(), graphqlExpress({ 
    schema,
    context: {},
  }))

  app.use('/graphiql', graphiqlExpress({ endpointURL: '/graphql' }))

  app.use(function (err, req, res, next) {
    res.status(500)
    res.send('An error occurred')
    console.error(err.stack)
    return res.end()
  })

  app.listen(3000)
})()
