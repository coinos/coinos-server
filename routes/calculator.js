(function() {
  exports.address = function(req, res) {
    return res.render('calculator/address', {
      layout: 'layout',
      js: (function() {
        return global.js;
      }),
      css: (function() {
        return global.css;
      })
    });
  };

  exports.sweep = function(req, res) {
    return res.render('calculator/sweep', {
      layout: 'layout',
      navigation: true,
      js: (function() {
        return global.js;
      }),
      css: (function() {
        return global.css;
      })
    });
  };

  exports.ticker = function(req, res) {
    var fs;
    fs = require('fs');
    return fs.readFile("./public/js/rates.json", function(err, data) {
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
  };

}).call(this);
