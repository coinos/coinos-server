#= require jquery-1.8.2.min.js

$(->
  fetchExchangeRate('ask') 
  fetchExchangeRate('bid') 
  setTimeout(fetchExchangeRate, 900000)
)

fetchExchangeRate = (type) ->
  commission = 0.03
  commission *= -1 if type is 'bid'

  $.ajax(
    url: "/ticker?symbol=virtexCAD&type=#{type}&amount=1000",
    success: (exchange) -> 
      if not exchange?
        exchange = '??'

      exchange = exchange - exchange * commission
      $("##{type}").html(exchange.toFixed(2))
    error: -> 
      $("##{type}").html('??')
  )
