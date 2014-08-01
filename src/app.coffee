express = require('express')
bodyParser = require('body-parser')
cookieParser = require('cookie-parser')
path = require('path')
engines = require('consolidate')
passport = require('./passport')

calculator = require("./routes/calculator")
sessions = require("./routes/sessions")(passport)
transactions = require("./routes/transactions")
users = require("./routes/users")(sessions)

session = require('express-session')
RedisStore = require('connect-redis')(session)
sessionStore = new RedisStore(require('./redis').host, ttl: 172800)


app = express()
app.enable('trust proxy')
app.engine('html', require('hogan-express'))
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))
app.use(require('connect-assets')(src: 'public'))
app.use(bodyParser.urlencoded({ extended: true}))
app.use(bodyParser.json())
app.use(bodyParser.json({ type: 'application/vnd.api+json' }))
app.use(cookieParser('weareallmadeofstars'))
app.use(session(resave: true, saveUninitialized: true, secret: 'weareallmadeofstars', store: sessionStore, cookie: { maxAge: 25920000000 }, key: 'vanbtc.sid'))
app.use(passport.initialize())
app.use(passport.session())

authorize = (req, res, next) ->

  if req.params.user is req.user?.username or
    req.user?.username is 'admin' or
    req.user?.username is 'ben'
      return next() 
  res.redirect('/login')

app.get('/', sessions.new)
app.get('/register', users.new)
app.get('/ticker', calculator.ticker)
app.get('/sweep', calculator.sweep)

app.get('/login', sessions.new)
app.post('/login', sessions.create)
app.get('/logout', sessions.destroy)

app.get('/:user/exists', users.exists)
app.get('/:user.json', users.json)

app.get('/users', users.index)
app.get('/users/new', users.new)
app.post('/users', users.create)

app.get('/:user/edit', authorize, users.edit)
app.post('/:user/update', authorize, users.update)

app.get('/:user/transactions.json', authorize, transactions.json)
app.post('/:user/transactions', transactions.create)
app.get('/:user/report', authorize, transactions.index)
app.get('/:user', users.show)

app.use((err, req, res, next) ->
  res.status(500)
  res.send('An error occurred');
  console.log(err)
  res.end()
)

app.listen(3000)
