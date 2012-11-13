express = require('express')
http = require('http')
path = require('path')
engines = require('consolidate')
config = require('./config')
app = express()

app.engine('html', engines.hogan)
app.set('view engine', 'html')
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/public'))
app.use(require('connect-assets')(src: 'public'))
app.use(express.bodyParser());
app.use((err, req, res, next) ->
  res.status(500)
  res.render('error', error: err )
)

app.get('/', (req, res) ->
  res.render('index',  js: (-> global.js), css: (-> global.css))
)

app.get('/:user/report', (req, res) ->
  res.render('report',  user: req.params.user, js: (-> global.js), css: (-> global.css))
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
  symbol = req.params.symbol
  symbol or= 'virtexCAD'

  options = 
    host: 'bitcoincharts.com', 
    path: '/t/depthcalc.json?symbol=' + symbol + '&type=bid&amount=1000&currency=true'
  
  require('http').get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      res.send(chunk)
    ) 
  )
)

app.post('/users', (req, res) ->
  db = require("redis").createClient()
  db.hmset(req.body.login, req.body, ->
    res.writeHead(302, 'Location': '/' + req.body.login)
    res.end()
  )
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

app.get('/:user', (req, res) ->
  res.render('calculator', 
    user: req.params.user, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.use((err, req, res, next) ->
  console.log(err)
)

app.listen(3000)
