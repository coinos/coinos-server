exports.new = (req, res) ->
  res.render('calculator/setup',  js: (-> global.js), css: (-> global.css))

exports.show = (req, res) ->
  res.render('calculator/show', 
    js: (-> global.js), 
    css: (-> global.css),
  )

exports.ticker = (req, res) ->
  options = 
    host: 'bitcoincharts.com', 
    path: "/t/depthcalc.json?symbol=#{req.query.symbol}&type=#{req.query.type}&amount=#{req.query.amount}&currency=true"

  require('http').get(options, (r) ->
    r.setEncoding('utf-8')
    r.on('data', (chunk) ->
      try
        exchange = req.query.amount / JSON.parse(chunk).out
        exchange = (Math.ceil(exchange * 100) / 100).toString()
      catch e
        exchange = ""

      res.writeHead(200, 
        'Content-Length': exchange.length,
        'Content-Type': 'text/plain')
      res.write(exchange)
      res.end()
    )
  )
