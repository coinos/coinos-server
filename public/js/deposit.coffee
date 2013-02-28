#= require jquery-1.8.2.min.js
#= require moment.min.js
#= require qr.js
#= require bootstrap.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

g = exports ? this

$(->
  g.address or= '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'
  setupSocket()
)

setupSocket = ->
  g.address = "1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr"
  setTimeout(setupSocket, 10000)

  unless g.websocket and g.websocket.readyState is 1
    g.websocket = new WebSocket("ws://api.blockchain.info:8335/inv")

    g.websocket.onopen = -> 
      g.websocket.send('{"op":"addr_sub", "addr":"' + g.address + '"}')
    
    g.websocket.onerror = g.websocket.onclose = ->
      fail(SOCKET_FAIL)

    g.websocket.onmessage = (e) ->
      results = eval('(' + e.data + ')')
      from_address = ''
      total = 0
      received = 0
      
      $.each(results.x.out, (i, v) ->
        if (v.addr == g.address) 
          received += v.value / 100000000
      )

      $.each(results.x.inputs, (i, v) ->
        from_address = v.prev_out.addr
        if (v.prev_out.addr == g.address) 
          input -= v.prev_out.value / 100000000
      )

      $.get("/issue/#{received}", (data) ->
        $('#received').html(data.replace(/\n/g, '<br />'))
      )

fail = (msg) ->
  g.errors.push(msg)
  g.errors = g.errors.uniq()
  $('#calculator').hide()
  $('#error').show().html(g.errors.toString())
  
clear = (msg) ->
  i = g.errors.indexOf(msg)
  g.errors.splice(i, 1) if i >= 0
  if (g.errors.length > 0)
    $('#error').show().html(g.errors.toString())
  else
    $('#error').hide()
    $('#calculator').fadeIn('slow')

get = (name) ->
  name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]")
  regexS = "[\\?&]" + name + "=([^&#]*)"
  regex = new RegExp(regexS)
  results = regex.exec(window.location.search)

  if (results == null)
    return ""
  else
    return decodeURIComponent(results[1].replace(/\+/g, " "))

Array::uniq = ->
  output = {}
  output[@[key]] = @[key] for key in [0...@length]
  value for key, value of output
