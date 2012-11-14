#= require jquery-1.8.2.min.js

$(->
  symbols = ['mtgoxUSD', 'btceUSD', 'bitstampUSD', 'virwoxSLL', 'btcdeEUR', 'mtgoxEUR', 'btc24EUR', 'mtgoxAUD', 'cryptoxAUD', 'mtgoxGBP', 'btcnCNY', 'intrsngEUR', 'virtexCAD', 'mtgoxPLN', 'cbxUSD', 'bitcurexPLN', 'bitmarketEUR', 'bitfloorUSD', 'mrcdBRL', 'bcEUR']

  $.each(symbols, (i, v) ->
    $('#symbol').append("<option>#{v}</option>")
  )
)
