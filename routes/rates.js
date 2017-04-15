const request = require('request')

module.exports = (function (app) {
  return {
    fetchRates () {
      request("https://api.bitcoinaverage.com/exchanges/all", function(error, response, body) {
        try {
          require('util').isDate(JSON.parse(body).timestamp)
          app.set('rates', body)
        } catch (undefined) {}
      })
      return setTimeout(this.fetchRates, 120000)
    },
    index (req, res) {
      res.write(app.get('rates'))
    }, 
    ticker (req, res) {
      fs = require('fs')
      var base, base1, base2, e, error1, exchange
      (base = req.query).currency || (base.currency = 'CAD')
      (base1 = req.query).symbol || (base1.symbol = 'quadrigacx')
      (base2 = req.query).type || (base2.type = 'bid')
      try {
        exchange = JSON.parse(app.get('rates'))[req.query.currency][req.query.symbol]['rates'][req.query.type].toString()
      } catch (error1) {
        e = error1
        exchange = "0"
      }
      res.writeHead(200, {
        'Content-Length': exchange.length,
        'Content-Type': 'text/plain'
      })
      res.write(exchange)
      return res.end()
    }
  }
}).call(this)
