express = require('express')
http = require('http')
path = require('path')
engines = require('consolidate')
passport = require('passport')
bcrypt = require('bcrypt')
db = require("redis").createClient()
ask = bid = 0

LocalStrategy = require('passport-local').Strategy

passport.serializeUser((user, done) ->
  done(null, user.username)
)

passport.deserializeUser((id, done) ->
  user = username: 'soltysa', password: 'adam'
  done(null, user)
)

passport.use(new LocalStrategy(
  (username, password, done) ->
    bcrypt.hash(password, 12, (err, hash) ->
      db.hget(username, 'password', (err, result) ->
        console.log(result)
        if result
          bcrypt.compare(password, result, (err, match) ->
            console.log(match)
            if match
              db.hgetall(username, (err, user) ->
                return done(null, user)
              )
          )
      )
    )
    return done(null, false)
))

ensureAuthenticated = (req, res, next) ->
  return next() if req.isAuthenticated()  
  res.redirect('/login')

app = express()
app.enable('trust proxy')
app.engine('html', require('mmm').__express)
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

routes =
  "/": 'index'
  "/about": 'about'
  "/exchangers": 'exchangers'
  "/exchangers/join": 'join'
  "/merchants": 'merchants'
  "/merchants/signup": 'signup'
  "/contact": 'contact'

for route, view of routes
  ((route, view) ->
    app.get(route, (req, res) ->
      res.render(view, 
        js: (-> global.js), 
        css: (-> global.css), 
        layout: 'layout'
      )
    )
  )(route, view) 

app.get('/setup', (req, res) ->
  res.render('setup',  js: (-> global.js), css: (-> global.css))
)

app.get('/:user/report', (req, res) ->
  res.render('report',  
    user: req.params.user,
    js: (-> global.js), 
    css: (-> global.css)
  )
)

app.get('/:user.json', (req, res) ->
  db.hgetall(req.params.user, (err, obj) ->
    res.write(JSON.stringify(obj))
    res.end()
  )
)

app.get('/:user/transactions', (req, res) ->
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
    path: "/t/depthcalc.json?symbol=#{req.query.symbol}&type=#{req.query.type}&amount=#{req.query.amount}&currency=true"

  http.get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      try
        exchange = 1000 / JSON.parse(chunk).out
        exchange = (Math.ceil(exchange * 100) / 100).toString()
      catch e
        exchange = ""

      res.writeHead(200, 
        'Content-Length': exchange.length,
        'Content-Type': 'text/plain')
      res.write(exchange)
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

app.post('/users', (req, res) ->
    params = []
    for k,v of req.body
      params.push(encodeURIComponent(k), '=', encodeURIComponent(v), '&') 
    params.pop() if (params.length) 
    res.redirect('calculator?' + params.join(''))
)

app.post('/:user/transactions', (req, res) ->
  user = req.params.user
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
  console.log(req.user)
  res.render('calculator', 
    js: (-> global.js), 
    css: (-> global.css),
  )
)

app.get('/:user/edit', ensureAuthenticated, (req, res) ->
  res.render('user', 
    user: req.params.user, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.get('/:user', (req, res) ->
  console.log(req.user)
  res.render('calculator', 
    user: req.params.user, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.use((err, req, res, next) ->
  res.status(500)
  console.log(err)
  res.end()
)

app.listen(3000)
