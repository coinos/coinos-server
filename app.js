(function() {
  const indexOf = [].indexOf || 
    function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i } return -1 }

  const request = require('request')
  const express = require('express')
  const bodyParser = require('body-parser')
  const cookieParser = require('cookie-parser')
  const path = require('path')
  const passport = require('./passport')
  const config = require('./config')
  const fs = require('fs')
  const proxyMiddleware = require('http-proxy-middleware')
  const sessions = require("./routes/sessions")(passport)
  const transactions = require("./routes/transactions")
  const twilio = require('twilio')
  const users = require("./routes/users")(sessions)
  const session = require('express-session')
  const RedisStore = require('connect-redis')(session)

  sessionStore = new RedisStore(require('./redis').host, {
    ttl: 172800
  })

  proxyContext = '/blockcypher'

  proxyOptions = {
    target: 'https://api.blockcypher.com',
    changeOrigin: true,
    pathRewrite: {
      '^/blockcypher/': '/'
    },
    onProxyReq: function(proxyReq, req, res) {
      var symbol
      symbol = indexOf.call(proxyReq.path, '?') >= 0 ? '&' : '?'
      return proxyReq.path += symbol + "token=" + config.blockcypher_token
    }
  }

  proxy = proxyMiddleware(proxyContext, proxyOptions)

  app = express()
  app.enable('trust proxy')
  app.engine('html', require('hogan-express'))
  app.set('view engine', 'html')
  app.set('views', __dirname + '/views')
  app.use(express["static"](__dirname + '/public'))
  app.use(proxy)

  app.use(bodyParser.urlencoded({
    extended: true
  }))

  app.use(bodyParser.json())

  app.use(bodyParser.json({
    type: 'application/vnd.api+json'
  }))

  app.use(cookieParser(config.secret))

  app.use(session({
    resave: true,
    saveUninitialized: true,
    secret: config.secret,
    store: sessionStore,
    cookie: {
      maxAge: 1209600000
    },
    key: 'coinos.sid'
  }))

  app.use(passport.initialize())

  app.use(passport.session())

  const authorize = function(req, res, next) {
    var ref, ref1
    if (req.params.user === ((ref = req.user) != null ? ref.username : void 0) || ((ref1 = req.user) != null ? ref1.username : void 0) === 'admin') {
      return next()
    }
    req.session.redirect = req.path
    return res.redirect('/login')
  }

  const cache = function(req, res, next) {
    if (req.path !== '/login') {
      res.setHeader("Cache-Control", "public, max-age=900")
    }
    return next()
  }

  let fetchRates
  (fetchRates = function() {
    request("https://api.bitcoinaverage.com/exchanges/all", function(error, response, body) {
      try {
        require('util').isDate(JSON.parse(body).timestamp)
        app.set('rates', body)
      } catch (undefined) {}
    })
    return setTimeout(fetchRates, 120000)
  })()

  app.get('/address', cache, function(req, res) {
    return res.render('address', {
      layout: 'layout',
      js: (function() {
        return global.js
      }),
      css: (function() {
        return global.css
      })
    })
  })

  app.get('/rates', cache, function(req, res) {
    res.write(app.get('rates'))
  })

  app.get('/ticker', cache, function(req, res) {
    fs = require('fs')
    var base, base1, base2, e, error1, exchange
    (base = req.query).currency || (base.currency = 'CAD')
    (base1 = req.query).symbol || (base1.symbol = 'quadrigacx')
    (base2 = req.query).type || (base2.type = 'bid')
    try {
      exchange = JSON.parse(app.get('rates'))[req.query.currency][req.query.symbol]['rates'][req.query.type].toString()
    } catch (error1) {
      e = error1
      exchange = "0"
    }
    res.writeHead(200, {
      'Content-Length': exchange.length,
      'Content-Type': 'text/plain'
    })
    res.write(exchange)
    return res.end()
  })

  app.get('/users.json', users.index)
  app.post('/users', users.create)
  app.get('/verify/:token', users.verify)
  app.post('/:user', authorize, users.update)
  app.get('/:user/transactions.json', authorize, transactions.json)
  app.post('/:user/transactions', transactions.create)
  app.post('/transactions/:txid', transactions.update)
  app["delete"]('/:user/transactions/:txid', transactions["delete"])
  app.get('/:user.json', users.json)

  app.use(function(err, req, res, next) {
    res.status(500)
    res.send('An error occurred')
    console.error(err.stack)
    return res.end()
  })

  app.listen(3000)

}).call(this)
