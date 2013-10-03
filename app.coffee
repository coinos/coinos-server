express = require('express')
path = require('path')
engines = require('consolidate')
passport = require('./passport')

calculator = require("./routes/calculator")
sessions = require("./routes/sessions")(passport)
transactions = require("./routes/transactions")
users = require("./routes/users")(sessions)

RedisStore = require('connect-redis')(express)
sessionStore = new RedisStore(ttl: 172800)

app = express()
app.enable('trust proxy')
app.engine('html', require('mmm').__express)
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))
app.use(require('connect-assets')(src: 'public'))
app.use(express.bodyParser())
app.use(express.cookieParser())
app.use(express.session(secret: 'weareallmadeofstars', store: sessionStore, key: 'vanbtc.sid'))
app.use(passport.initialize())
app.use(passport.session())
app.use(app.router)

authorize = (req, res, next) ->
  if req.params.user is req.user?.username or 
    req.user?.username is 'admin'
      return next() 
  res.redirect('/login')

app.get('/', calculator.show)
app.get('/register', users.new)
app.get('/setup', calculator.new)
app.get('/calculator', calculator.show)
app.get('/ticker', calculator.ticker)

app.get('/login', sessions.new)
app.post('/login', sessions.create)
app.get('/logout', sessions.destroy)

app.get('/:user/exists', users.exists)
app.get('/:user.json', users.json)
app.get('/:user', users.show)

app.get('/users/new', users.new)
app.post('/users', users.create)

app.get('/:user/edit', authorize, users.edit)
app.post('/:user/update', authorize, users.update)

app.get('/:user/transactions.json', authorize, transactions.json)
app.post('/:user/transactions', authorize, transactions.create)
app.get('/:user/report', authorize, transactions.index)

app.use((err, req, res, next) ->
  res.status(500)
  console.log(err)
  res.end()
)

app.listen(3000)

# Setup DB
db = require("redis").createClient()
db.sismember("mts","mt:othr", (err,res) ->
   if !res
      db.hmset("mt:rest",{code: rest, label: "Restaurant/Bar"}, ->
          db.sadd("mts","mt:rest")
      )	  
      db.hmset("mt:coff",{code: rest, label: "Coffee Shop"}, ->
          db.sadd("mts","mt:coff")
      )	        
      console.log("Added merchant types.")
)

   
