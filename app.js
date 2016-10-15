(function() {
  var RedisStore, app, authorize, bcoin, bodyParser, cache, config, cookieParser, express, fetchRates, fs, passport, path, proxy, proxyContext, proxyMiddleware, proxyOptions, request, session, sessionStore, sessions, startBcoin, transactions, users,
    indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  request = require('request');

  express = require('express');

  bodyParser = require('body-parser');

  cookieParser = require('cookie-parser');

  path = require('path');

  passport = require('./passport');

  config = require('./config');

  fs = require('fs');

  bcoin = require('bcoin').set('testnet');

  proxyMiddleware = require('http-proxy-middleware');

  sessions = require("./routes/sessions")(passport);

  transactions = require("./routes/transactions");

  users = require("./routes/users")(sessions);

  session = require('express-session');

  RedisStore = require('connect-redis')(session);

  sessionStore = new RedisStore(require('./redis').host, {
    ttl: 172800
  });

  proxyContext = '/blockcypher';

  proxyOptions = {
    target: 'https://api.blockcypher.com',
    changeOrigin: true,
    pathRewrite: {
      '^/blockcypher/': '/'
    },
    onProxyReq: function(proxyReq, req, res) {
      var symbol;
      symbol = indexOf.call(proxyReq.path, '?') >= 0 ? '&' : '?';
      return proxyReq.path += symbol + "token=" + config.blockcypher_token;
    }
  };

  proxy = proxyMiddleware(proxyContext, proxyOptions);

  app = express();

  app.enable('trust proxy');

  app.engine('html', require('hogan-express'));

  app.set('view engine', 'html');

  app.set('views', __dirname + '/views');

  app.use(express["static"](__dirname + '/public'));

  app.use(proxy);

  app.use(bodyParser.urlencoded({
    extended: true
  }));

  app.use(bodyParser.json());

  app.use(bodyParser.json({
    type: 'application/vnd.api+json'
  }));

  app.use(cookieParser(config.secret));

  app.use(session({
    resave: true,
    saveUninitialized: true,
    secret: config.secret,
    store: sessionStore,
    cookie: {
      maxAge: 1209600000
    },
    key: 'vanbtc.sid'
  }));

  app.use(passport.initialize());

  app.use(passport.session());

  authorize = function(req, res, next) {
    var ref, ref1;
    if (req.params.user === ((ref = req.user) != null ? ref.username : void 0) || ((ref1 = req.user) != null ? ref1.username : void 0) === 'admin') {
      return next();
    }
    req.session.redirect = req.path;
    return res.redirect('/login');
  };

  cache = function(req, res, next) {
    if (req.path !== '/login') {
      res.setHeader("Cache-Control", "public, max-age=900");
    }
    return next();
  };

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
      } catch (undefined) {}
    });
    return setTimeout(fetchRates, 120000);
  })();

  (startBcoin = function() {
    var chain, pool;
    chain = new bcoin.chain({
      db: 'leveldb',
      location: process.env.HOME + '/chain.db',
      spv: true
    });
    pool = new bcoin.pool({
      chain: chain,
      spv: true
    });
    return pool.open(function(err) {
      pool.watchAddress('mhwWUZAmP4ycvwj4DdfGRy2JNRwDXeuwtj');
      pool.connect();
      pool.startSync();
      pool.on('error', function(err) {});
      return pool.on('tx', function(tx) {
        return console.log(tx);
      });
    });
  })();

  app.get('/', cache, sessions["new"]);

  app.get('/address', cache, function(req, res) {
    return res.render('address', {
      layout: 'layout',
      js: (function() {
        return global.js;
      }),
      css: (function() {
        return global.css;
      })
    });
  });

  app.get('/ticker', cache, function(req, res) {
    fs = require('fs');
    return fs.readFile("./public/js/rates.json", function(err, data) {
      var base, base1, base2, e, error1, exchange;
      (base = req.query).currency || (base.currency = 'CAD');
      (base1 = req.query).symbol || (base1.symbol = 'quadrigacx');
      (base2 = req.query).type || (base2.type = 'bid');
      try {
        exchange = JSON.parse(data)[req.query.currency][req.query.symbol]['rates'][req.query.type].toString();
      } catch (error1) {
        e = error1;
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

  app.get('/tips', cache, function(req, res) {
    return res.render('tips', {
      notice: true,
      layout: 'layout',
      js: (function() {
        return global.js;
      }),
      css: (function() {
        return global.css;
      })
    });
  });

  app.get('/login', cache, sessions["new"]);

  app.post('/login', sessions.create);

  app.get('/logout', sessions.destroy);

  app.get('/users.json', users.index);

  app.get('/register', cache, users["new"]);

  app.get('/users/new', cache, users["new"]);

  app.post('/users', users.create);

  app.get('/verify/:token', users.verify);

  app.post('/:user', authorize, users.update);

  app.get('/:user/edit', authorize, users.edit);

  app.get('/:user/profile', authorize, users.profile);

  app.get('/:user/wallet', authorize, users.wallet);

  app.get('/:user/transactions.json', authorize, transactions.json);

  app.post('/:user/transactions', transactions.create);

  app.post('/transactions/:txid', transactions.update);

  app["delete"]('/:user/transactions/:txid', transactions["delete"]);

  app.get('/:user/report', authorize, transactions.index);

  app.get('/:user.json', users.json);

  app.get('/:user', cache, users.show);

  app.use(function(err, req, res, next) {
    res.status(500);
    res.send('An error occurred');
    console.error(err.stack);
    return res.end();
  });

  app.listen(3000);

}).call(this);
