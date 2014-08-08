(function() {
  var RedisStore, app, authorize, bodyParser, calculator, config, cookieParser, express, passport, path, session, sessionStore, sessions, transactions, users;

  express = require('express');

  bodyParser = require('body-parser');

  cookieParser = require('cookie-parser');

  path = require('path');

  passport = require('./passport');

  config = require('./config');

  calculator = require("./routes/calculator");

  sessions = require("./routes/sessions")(passport);

  transactions = require("./routes/transactions");

  users = require("./routes/users")(sessions);

  session = require('express-session');

  RedisStore = require('connect-redis')(session);

  sessionStore = new RedisStore(require('./redis').host, {
    ttl: 172800
  });

  app = express();

  app.enable('trust proxy');

  app.engine('html', require('hogan-express'));

  app.set('view engine', 'html');

  app.set('views', __dirname + '/views');

  app.use(express["static"](__dirname + '/public'));

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
    var _ref, _ref1;
    if (req.params.user === ((_ref = req.user) != null ? _ref.username : void 0) || ((_ref1 = req.user) != null ? _ref1.username : void 0) === 'admin') {
      return next();
    }
    return res.redirect('/login');
  };

  app.get('/', sessions["new"]);

  app.get('/register', users["new"]);

  app.get('/ticker', calculator.ticker);

  app.get('/sweep', calculator.sweep);

  app.get('/login', sessions["new"]);

  app.post('/login', sessions.create);

  app.get('/logout', sessions.destroy);

  app.get('/users/new', users["new"]);

  app.post('/users', users.create);

  app.get('/:user/edit', authorize, users.edit);

  app.post('/:user', authorize, users.update);

  app.get('/:user/transactions.json', authorize, transactions.json);

  app.post('/:user/transactions', authorize, transactions.create);

  app.get('/:user/report', authorize, transactions.index);

  app.get('/:user.json', authorize, users.json);

  app.get('/:user', authorize, users.show);

  app.use(require('connect-assets')({
    src: 'public',
    servePath: '/'
  }));

  app.use(function(err, req, res, next) {
    res.status(500);
    res.send('An error occurred');
    console.error(err.stack);
    return res.end();
  });

  app.listen(3000);

}).call(this);
