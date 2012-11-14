#= require jquery-1.8.2.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js

$(->
  symbols = ['mtgoxUSD', 'btceUSD', 'bitstampUSD', 'virwoxSLL', 'btcdeEUR', 'mtgoxEUR', 'btc24EUR', 'mtgoxAUD', 'cryptoxAUD', 'mtgoxGBP', 'btcnCNY', 'intrsngEUR', 'virtexCAD', 'mtgoxPLN', 'cbxUSD', 'bitcurexPLN', 'bitmarketEUR', 'bitfloorUSD', 'mrcdBRL', 'bcEUR']

  $.each(symbols, (i, v) ->
    $('#symbol').append("<option value='#{v}'>#{v}</option>")
  )

  $('#address').change(->
    if check_address($(this).val())
      $(this).css('color', 'black')
    else
      $(this).css('color', 'red')
  )
)
