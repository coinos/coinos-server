exports.new = (req, res) ->
  res.render('calculator/setup',  js: (-> global.js), css: (-> global.css))

exports.show = (req, res) ->
  res.render('calculator/show', 
    js: (-> global.js), 
    css: (-> global.css),
  )

exports.ticker = (req, res) ->
  options = 
    host: 'api.bitcoinaverage.com', 
    path: "/exchanges/CAD"

  require('http').get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      exchange = JSON.parse(chunk).cavirtex.rates[req.query.type].toString()

      res.writeHead(200, 
        'Content-Length': exchange.length,
        'Content-Type': 'text/plain')
      res.write(exchange)
      res.end()
    )
  )
