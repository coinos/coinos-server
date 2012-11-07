var express = require('express')
  , http = require('http')
  , path = require('path')
  , engines = require('consolidate')
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

app.get('/ticker', function(req, res) {
  var options = {
    host: 'bitcoincharts.com', 
    path: '/t/depthcalc.json?symbol=virtexCAD&type=bid&amount=1001&currency=true'
  }

  require('http').get(options, function(r) {
    r.setEncoding('utf-8');
    r.on('data', function(chunk) {
      res.send(chunk);
    }); 
  });
});

app.get('/:client', function(req, res) {
  res.render('calculator', { title: req.param('client') });
});

app.listen(3000);
