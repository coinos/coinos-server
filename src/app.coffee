request = require('request')
express = require('express')
bodyParser = require('body-parser')
cookieParser = require('cookie-parser')
path = require('path')
passport = require('./passport')
config = require('./config')
fs = require('fs')
proxyMiddleware = require('http-proxy-middleware')
sessions = require("./routes/sessions")(passport)
transactions = require("./routes/transactions")
twilio = require('twilio')
users = require("./routes/users")(sessions)

session = require('express-session')
RedisStore = require('connect-redis')(session)
sessionStore = new RedisStore(require('./redis').host, ttl: 172800)


proxyContext = '/blockcypher'
proxyOptions = 
  target: 'https://api.blockcypher.com'
  changeOrigin: true
  pathRewrite: 
    '^/blockcypher/': '/'
  onProxyReq: (proxyReq, req, res) ->
    symbol = if '?' in proxyReq.path then '&' else '?'
    proxyReq.path += "#{symbol}token=#{config.blockcypher_token}"
    
proxy = proxyMiddleware(proxyContext, proxyOptions)

app = express()
app.enable('trust proxy')
app.engine('html', require('hogan-express'))
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))
app.use(proxy)
app.use(bodyParser.urlencoded({ extended: true}))
app.use(bodyParser.json())
app.use(bodyParser.json({ type: 'application/vnd.api+json' }))
app.use(cookieParser(config.secret))
app.use(session(
  resave: true
  saveUninitialized: true
  secret: config.secret
  store: sessionStore
  cookie: maxAge: 1209600000
  key: 'coinos.sid'
))
app.use(passport.initialize())
app.use(passport.session())

authorize = (req, res, next) ->
  if req.params.user is req.user?.username or
    req.user?.username is 'admin'
      return next() 

  req.session.redirect = req.path
  res.redirect('/login')

cache = (req, res, next) ->
  unless req.path is '/login'
    res.setHeader "Cache-Control", "public, max-age=900"
  next()

do fetchRates = ->
  request("https://api.bitcoinaverage.com/exchanges/all", (error, response, body) ->
    try 
      require('util').isDate(JSON.parse(body).timestamp)
      file = 'public/js/rates.json'
      stream = fs.createWriteStream(file)
      fs.truncate(file, 0, ->
        stream.write(body)
      )
  )
  setTimeout(fetchRates, 120000)

require('./bcoin').init(app)

app.get('/', cache, sessions.new)

app.get('/address', cache, (req, res) ->
  res.render('address', 
    layout: 'layout',
    js: (-> global.js), 
    css: (-> global.css)
  )
)

app.get('/ticker', cache, (req, res) ->
  fs = require('fs')
  fs.readFile("./public/js/rates.json", (err, data) ->
    req.query.currency ||= 'CAD'
    req.query.symbol ||= 'quadrigacx'
    req.query.type ||= 'bid'

    try 
      exchange = JSON.parse(data)[req.query.currency][req.query.symbol]['rates'][req.query.type].toString()
    catch e 
      exchange = "0"

    res.writeHead(200, 
      'Content-Length': exchange.length,
      'Content-Type': 'text/plain')
    res.write(exchange)
    res.end()
  )
)

app.get('/tips', cache, (req, res) ->
  res.render('tips', 
    notice: true,
    layout: 'layout',
    js: (-> global.js), 
    css: (-> global.css)
  )
)

app.get('/login', cache, sessions.new)
app.post('/login', sessions.create)
app.get('/logout', sessions.destroy)

app.get('/users.json', users.index)
app.get('/register', cache, users.new)
app.get('/users/new', cache, users.new)
app.post('/users', users.create)
app.get('/verify/:token', users.verify)

app.post('/:user', authorize, users.update)
app.get('/:user/edit', authorize, users.edit)
app.get('/:user/profile', authorize, users.profile)
app.get('/:user/wallet', authorize, users.wallet)

app.get('/:user/transactions.json', authorize, transactions.json)
app.post('/:user/transactions', transactions.create)
app.post('/transactions/:txid', transactions.update)
app.delete('/:user/transactions/:txid', transactions.delete)
app.get('/:user/report', authorize, transactions.index)

app.get('/:user.json', users.json)
app.get('/:user', cache, users.show)

app.use((err, req, res, next) ->
  res.status(500)
  res.send('An error occurred');
  console.error(err.stack)
  res.end()
)

app.listen(3000)
