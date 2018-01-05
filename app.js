import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import passport from './passport'
import cache from './cache'
import dotenv from 'dotenv'
import ba from 'bitcoinaverage'
dotenv.config()

require('dotenv').config()

const app = express()
app.enable('trust proxy')
app.use(require('./blockcypher'))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.use(cookieParser())
app.use(passport.initialize())

const users = require('./routes/users')
const transactions = require('./routes/transactions')
const restClient = ba.restfulClient(process.env.BITCOINAVERAGE_PUBLIC, process.env.BITCOINAVERAGE_SECRET)

app.get('/users.json', transactions.index)
app.post('/login', users.login)
app.post('/users', users.create)
app.get('/verify/:token', users.verify)
app.post('/:user', users.update)
// app.post('/:user/transactions', transactions.create)
app.get('/:user/transactions', transactions.index)
app.post('/transactions/:txid', transactions.update)
app['delete']('/:user/transactions/:txid', transactions['delete'])
app.get('/:user.json', users.json)
app.get('/secret', passport.authenticate('jwt', { session: false }), users.secret)

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

app.use(function (err, req, res, next) {
  res.status(500)
  res.send('An error occurred')
  console.error(err.stack)
  return res.end()
})

app.listen(3000)


