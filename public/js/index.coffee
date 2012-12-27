#= require jquery-1.8.2.min.js

$(->
  fetchExchangeRate('ask') 
  fetchExchangeRate('bid') 
)

fetchExchangeRate = (type) ->
  commission = 0.015
  commission *= -1 if type is 'bid'

  $.ajax(
    url: "/ticker?symbol=virtexCAD&type=#{type}&amount=100",
    success: (exchange) -> 
      if not exchange?
        exchange = '??'

      exchange = exchange - exchange * commission
      $("##{type}").html(exchange.toFixed(2))
    error: -> 
      $("##{type}").html('??')
  )
