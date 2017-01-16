(function() {
  var app, config, engines, express, fetchRates, fs, path, request, route, routes, view, _fn;

  fs = require('fs');

  express = require('express');

  path = require('path');

  engines = require('consolidate');

  request = require('request');

  config = require('./config');

  app = express();

  app.enable('trust proxy');

  app.engine('html', require('mmm').__express);

  app.set('view engine', 'html');

  app.set('views', __dirname + '/views');

  app.use(express["static"](__dirname + '/public'));

  app.use(express.bodyParser());

  app.use(express.cookieParser());

  app.use(app.router);

  (fetchRates = function() {
    request("https://api.bitcoinaverage.com/exchanges/all", function(error, response, body) {
      var file, stream;
      try {
        require('util').isDate(JSON.parse(body).timestamp);
        file = 'public/js/rates.json';
        stream = fs.createWriteStream(file);
        return fs.truncate(file, 0, function() {
          return stream.write(body);
        });
      } catch (_error) {}
    });
    return setTimeout(fetchRates, 120000);
  })();

  routes = {
    '/': 'index',
    '/about': 'about',
    '/coinfest': 'coinfest',
    '/coinos': 'coinos',
    '/contact': 'contact',
    '/directors': 'directors',
    '/membership': 'membership',
    '/merchants': 'merchants',
    '/partners': 'partners',
    '/register': 'register'
  };

  _fn = function(route, view) {
    return app.get(route, function(req, res) {
      return res.render(view, {
        js: (function() {
          return global.js;
        }),
        css: (function() {
          return global.css;
        }),
        layout: 'layout'
      });
    });
  };
  for (route in routes) {
    view = routes[route];
    _fn(route, view);
  }

  app.get('/users', function(req, res) {
    var db;
    db = require('./redis');
    return db.keys('member:*', function(err, keys) {
      var i, key, users, _i, _len, _results;
      users = [];
      _results = [];
      for (i = _i = 0, _len = keys.length; _i < _len; i = ++_i) {
        key = keys[i];
        _results.push((function(i, db) {
          return db.hgetall(key, function(err, user) {
            if (!user["private"]) {
              users.push(user);
            }
            if (i >= keys.length - 1) {
              users.sort(function(a, b) {
                if (parseInt(a.number) < parseInt(b.number)) {
                  return -1;
                }
                if (parseInt(a.number) > parseInt(b.number)) {
                  return 1;
                }
                return 0;
              });
              res.write(JSON.stringify(users));
              return res.end();
            }
          });
        })(i, db));
      }
      return _results;
    });
  });

  app.post('/users', function(req, res) {
    var db, userkey;
    db = require('./redis');
    userkey = "member:" + req.body.email;
    return db.hgetall(userkey, function(err, obj) {
      if (obj) {
        res.status(500).send("Sorry, that email address is already registered");
        return;
      }
      db.sadd("users", userkey);
      return db.incr('members', function(err, number) {
        return db.hmset(userkey, {
          name: req.body.name,
          email: req.body.email,
          address: req.body.address,
          number: number,
          date: req.body.date,
          txid: req.body.txid
        }, function(err, obj) {
          var email;
          if (true || process.env.NODE_ENV === 'production') {
            email = req.body.email;
            res.render('welcome', {
              layout: 'mail',
              js: (function() {
                return global.js;
              }),
              css: (function() {
                return global.css;
              })
            }, function(err, html) {
              var sendgrid;
              sendgrid = require('sendgrid')(config.sendgrid_user, config.sendgrid_password);
              email = new sendgrid.Email({
                to: email,
                from: 'info@bitcoincoop.org',
                subject: 'Welcome to the Co-op!',
                html: html
              });
              return sendgrid.send(email);
            });
          }
          return res.end();
        });
      });
    });
  });

  app.get('/ticker', function(req, res) {
    var fd;
    fs = require('fs');
    return fd = fs.readFile("./public/js/rates.json", function(err, data) {
      var e, exchange, _base, _base1, _base2;
      (_base = req.query).currency || (_base.currency = 'CAD');
      (_base1 = req.query).symbol || (_base1.symbol = 'quadrigacx');
      (_base2 = req.query).type || (_base2.type = 'bid');
      try {
        exchange = JSON.parse(data)[req.query.currency][req.query.symbol]['rates'][req.query.type].toString();
      } catch (_error) {
        e = _error;
        exchange = "0";
      }
      res.writeHead(200, {
        'Content-Length': exchange.length,
        'Content-Type': 'text/plain'
      });
      res.write(exchange);
      return res.end();
    });
  });

  app.use(function(err, req, res, next) {
    res.status(500);
    console.log(err);
    return res.end();
  });

  app.listen(3002);

}).call(this);
