exports.address = (req, res) ->
  res.render('calculator/address', 
    layout: 'layout',
    js: (-> global.js), 
    css: (-> global.css)
  )

exports.sweep = (req, res) ->
  res.render('calculator/sweep', 
    layout: 'layout',
    navigation: true,
    js: (-> global.js), 
    css: (-> global.css)
  )

exports.ticker = (req, res) ->
  fs = require('fs')
  fs.readFile("./public/js/rates.json", (err, data) ->
    req.query.currency ||= 'CAD'
    req.query.symbol ||= 'quadrigacx'
    req.query.type ||= 'bid'

    try 
      exchange = JSON.parse(data)[req.query.currency][req.query.symbol]['rates'][req.query.type].toString()
    catch e 
      exchange = "0"

    res.writeHead(200, 
      'Content-Length': exchange.length,
      'Content-Type': 'text/plain')
    res.write(exchange)
    res.end()
  )

