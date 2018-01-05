import fs from 'fs'
import path from 'path'
import request from 'request'
import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import passport from './passport'
import config from './config'
import proxyMiddleware from 'http-proxy-middleware'
import transactions from './routes/transactions'
import session from 'express-session'

const sessions = require('./routes/sessions')(passport)
const RedisStore = require('connect-redis')(session)
const users = require('./routes/users')(sessions)

;(async () => {
  const indexOf = [].indexOf ||
    function (item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i } return -1 }

  const sessionStore = new RedisStore(require('./redis').host, {
    ttl: 172800,
  })

  const proxyContext = '/blockcypher'

  const proxyOptions = {
    target: 'https://api.blockcypher.com',
    changeOrigin: true,
    pathRewrite: {
      '^/blockcypher/': '/',
    },
    onProxyReq: function (proxyReq, req, res) {
      let symbol = indexOf.call(proxyReq.path, '?') >= 0 ? '&' : '?'
      proxyReq.path += symbol + 'token=' + config.blockcypher_token
    },
  }

  const proxy = proxyMiddleware(proxyContext, proxyOptions)
  const app = express()

  app.enable('trust proxy')
  app.engine('html', require('hogan-express'))
  app.set('view engine', 'html')
  app.set('views', path.resolve(__dirname, '/views'))
  app.use(express['static'](path.resolve(__dirname, '/public')))
  app.use(proxy)

  app.use(bodyParser.urlencoded({
    extended: true,
  }))

  app.use(bodyParser.json())

  app.use(bodyParser.json({
    type: 'application/vnd.api+json',
  }))

  app.use(cookieParser(config.secret))

  app.use(session({
    resave: true,
    saveUninitialized: true,
    secret: config.secret,
    store: sessionStore,
    cookie: { maxAge: 1209600000 },
    key: 'coinos.sid',
  }))

  app.use(passport.initialize())

  app.use(passport.session())

  const authorize = function (req, res, next) {
    var ref, ref1
    if (req.params.user === ((ref = req.user) != null ? ref.username : void 0) || ((ref1 = req.user) != null ? ref1.username : void 0) === 'admin') {
      return next()
    }
    req.session.redirect = req.path
    return res.redirect('/login')
  }

  const cache = function (req, res, next) {
    if (req.path !== '/login') {
      res.setHeader('Cache-Control', 'public, max-age=900')
    }
    return next()
  }

  let fetchRates
  (fetchRates = () => {
    request('https://api.bitcoinaverage.com/exchanges/all', (err, res, body) => {
      if (err) return
      try {
        require('util').isDate(JSON.parse(body).timestamp)
        app.set('rates', body)
      } catch (e) { console.log(e) }
    })
    return setTimeout(fetchRates, 120000)
  })()

  app.get('/', cache, sessions['new'])

  app.get('/rates', cache, (req, res) => {
    res.write(app.get('rates'))
  })

  app.get('/ticker', cache, function(req, res) {
    let params = {
      currency: 'CAD',
      symbol: 'quadrigacx',
      type: 'bid',
    } 

    try {
      exchange = JSON.parse(app.get('rates'))[req.query.currency][req.query.symbol]['rates'][req.query.type].toString()
    } catch (err) {
      exchange = 0
    }
    res.writeHead(200, {
      'Content-Length': exchange.length,
      'Content-Type': 'text/plain'
    })
    res.write(exchange)
    res.end()
  })

  app.get('/tips', cache, function(req, res) {
    return res.render('tips', {
      notice: true,
      layout: 'layout',
      js: (function() {
        return global.js
      }),
      css: (function() {
        return global.css
      })
    })
  })

  app.get('/login', cache, sessions["new"])
  app.post('/login', sessions.create)
  app.get('/logout', sessions.destroy)
  app.get('/users.json', users.index)
  app.get('/register', cache, users["new"])
  app.get('/users/new', cache, users["new"])
  app.post('/users', users.create)
  app.get('/verify/:token', users.verify)
  app.post('/:user', authorize, users.update)
  app.get('/:user/edit', authorize, users.edit)
  app.get('/:user/profile', authorize, users.profile)
  app.get('/:user/wallet', authorize, users.wallet)
  app.get('/:user/transactions.json', authorize, transactions.json)
  app.post('/:user/transactions', transactions.create)
  app.post('/transactions/:txid', transactions.update)
  app["delete"]('/:user/transactions/:txid', transactions["delete"])
  app.get('/:user/report', authorize, transactions.index)
  app.get('/:user.json', users.json)
  app.get('/:user', cache, users.show)

  app.use(function(err, req, res, next) {
    res.status(500)
    res.send('An error occurred')
    console.error(err.stack)
    return res.end()
  })

  app.listen(3000)

}).call(this)
