var express = require('express')
  , http = require('http')
  , path = require('path')
  , engines = require('consolidate')
  , config = require('./config')
  , app = express();

app.engine('html', engines.hogan);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
  res.render('index');
});

app.get('/report', function(req, res) {
  res.render('report');
});

app.get('/calculator', function(req, res) {
  res.render('calculator');
});

app.get('/client/:login', function(req, res) {
  var connection = require('mysql').createConnection(config.database);

  connection.connect();
  connection.query("SELECT name, address, commission, logo FROM users WHERE login = ?", 
    [req.params.login], function(err, rows) {
      res.write(JSON.stringify(rows));
      connection.end();
      res.end();
    }
  );
});

app.get('/ticker', function(req, res) {
  var options = {
    host: 'bitcoincharts.com', 
    path: '/t/depthcalc.json?symbol=virtexCAD&type=bid&amount=1000&currency=true'
  }

  require('http').get(options, function(r) {
    r.setEncoding('utf-8');
    r.on('data', function(chunk) {
      res.send(chunk);
    }); 
  });
});

app.get('/:client', function(req, res) {
  res.render('calculator', { client: req.params.client });
});

app.listen(3000);
