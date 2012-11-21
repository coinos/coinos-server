express = require('express')
http = require('http')
path = require('path')
engines = require('consolidate')
passport = require('passport')
config = require('./config')
app = express()

LocalStrategy = require('passport-local').Strategy
passport.use(new LocalStrategy(
  (username, password, done) ->
    user = {username: 'soltysa', password: 'adam'}
    return done(null, user)
))

passport.serializeUser((user, done) ->
  done(null, user.username)
)

passport.deserializeUser((id, done) ->
  user = {username: 'soltysa', password: 'adam'}
  done(null, user)
)

app.engine('html', engines.hogan)
app.enable('trust proxy')
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))
app.use(require('connect-assets')(src: 'public'))
app.use(express.bodyParser())
app.use(express.cookieParser())
app.use(express.session(secret: 'weareallmadeofstars'))
app.use(passport.initialize())
app.use(passport.session())
app.use(app.router)
app.use((err, req, res, next) ->
  res.status(500)
  console.log(err)
  res.end()
)

app.get('/', (req, res) ->
  res.render('index',  js: (-> global.js), css: (-> global.css))
)

app.get('/:user/report', (req, res) ->
  res.render('report',  
    user: req.params.user,
    js: (-> global.js), 
    css: (-> global.css))
)

app.get('/:user.json', (req, res) ->
  db = require("redis").createClient()
  db.hgetall(req.params.user, (err, obj) ->
    res.write(JSON.stringify(obj))
    res.end()
  )
)

app.get('/:user/transactions', (req, res) ->
  db = require("redis").createClient()
  user = req.params.user
  r = 'transactions': []

  db.lrange("#{user}:transactions", 0, -1, (err, transactions) ->
    process = (err, t) ->
      r.transactions.push t

      if i >= transactions.length
        res.write(JSON.stringify(r))
        res.end()
      else
        db.hgetall("#{user}:transactions:#{transactions[i++]}", process)
    
    i = 0
    db.hgetall("#{user}:transactions:#{transactions[i++]}", process)
  )
)

app.get('/ticker', (req, res) ->
  options = 
    host: 'bitcoincharts.com', 
    path: '/t/depthcalc.json?symbol=' + 
      req.query.symbol + 
      '&type=ask&amount=1000&currency=true'

  require('http').get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      res.writeHead(200, 
        'Content-Length': chunk.length,
        'Content-Type': 'text/plain')
      res.write(chunk)
      res.end()
    )
  )
)

app.get('/login', (req, res) ->
  res.render('login', 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.post('/login', (req, res, next) ->
  passport.authenticate('local', (err, user, info) ->
    if (err)
      return next(err)
    if (!user) 
      return res.redirect('/login')
    req.logIn(user, (err) ->
      if (err) 
        return next(err)
      return res.redirect('/' + user.username)
    )
  )(req, res, next)
)

app.post('/:user/transactions', (req, res) ->
  user = req.params.user
  db = require("redis").createClient()
  db.incr('transactions', (err, id) ->
    db.hmset("#{user}:transactions:#{id}", req.body, ->
      db.rpush("#{user}:transactions", id, ->
        res.write(JSON.stringify(req.body))
        res.end()
      )
    )
  )
)

app.get('/calculator', (req, res) ->
  res.render('calculator', 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.get('/:user/edit', (req, res) ->
  res.render('index', 
    user: req.params.user, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)


app.get('/:user', (req, res) ->
  res.render('calculator', 
    user: req.params.user, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)


app.listen(3000)
