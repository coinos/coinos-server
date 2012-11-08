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

app.get('/', (req, res) ->
  res.render('index',  js: (-> global.js), css: (-> global.css))
)

app.get('/report', (req, res) ->
  res.render('report',  js: (-> global.js), css: (-> global.css))
)

app.get('/client/:login', (req, res) ->
  connection = require('mysql').createConnection(config.database)

  connection.connect()
  connection.query("SELECT name, address, commission, logo FROM users WHERE login = ?", 
    [req.params.login], (err, rows) ->
      res.write(JSON.stringify(rows))
      connection.end()
      res.end()
  )
)

app.get('/transactions/:login', (req, res) ->
  connection = require('mysql').createConnection(config.database)

  connection.connect()
  connection.query("SELECT * FROM transactions", 
    [req.params.login], (err, rows) ->
      res.write(JSON.stringify(rows))
      connection.end()
      res.end()
  )
)

app.get('/ticker', (req, res) ->
  options = 
    host: 'bitcoincharts.com', 
    path: '/t/depthcalc.json?symbol=virtexCAD&type=bid&amount=1000&currency=true'
  
  require('http').get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      res.send(chunk)
    ) 
  )
)

app.get('/:client', (req, res) ->
  res.render('calculator', 
    client: req.params.client, 
    js: (-> global.js), 
    css: (-> global.css) 
  )
)

app.use((err, req, res, next) ->
  console.log(err)
)

app.listen(3000)
