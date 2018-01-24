import ba from 'bitcoinaverage'
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

  const users = require('./routes/users')
  const transactions = require('./routes/transactions')
  const restClient = ba.restfulClient(process.env.BITCOINAVERAGE_PUBLIC, process.env.BITCOINAVERAGE_SECRET)
  const lnrpc = await require('lnrpc')({ server: 'localhost:10001' })
  const adminMacaroon = fs.readFileSync('/home/adam/.lnd/data/core_test/admin.macaroon');
  const meta = new grpc.Metadata();
  meta.add('macaroon', adminMacaroon.toString('hex'));

  app.post('/login', users.login)
  app.post('/users', users.create)
  app.get('/verify/:token', users.verify)
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
    schema: schema,
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

  app.listen(3000)
})()
