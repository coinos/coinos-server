#= require js/jquery-1.8.2.min.js
#= require js/bootstrap.min.js

g = exports ? this

$(->
  fetchExchangeRate('ask') 
  fetchExchangeRate('bid') 

  $('#username').blur(->
    $.get(
      "/#{$(this).val()}/exists", 
      username: $(this).val(),
      (data) ->
        if data is "true"
          $('#username').prev().css('color', 'red').html('Username (taken)')
          g.preventSubmit = true
        else
          $('#username').prev().css('color', 'black').html('Username')
          g.preventSubmit = false
    )
  )

  $('#signup').submit(->
    return false if g.preventSubmit
    return true
  )
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
