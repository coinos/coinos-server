#= require jquery-1.8.2.min.js
#= require moment.min.js
#= require qrcode.js
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
  g.user = $('#user').val()
  g.title = get('title')
  g.address = get('address')
  g.symbol = get('symbol')
  g.commission = parseFloat(get('commission'))
  g.logo = get('logo')
  g.errors = []

  if g.user
    $.ajax(
      url: g.user + '.json', 
      dataType: 'json',
      success: (data) ->
        if data?
          g.title = data.title
          g.address = data.address 
          g.symbol = data.symbol
          g.commission = data.commission 
          g.logo = data.logo 
        setup()
    )
  else 
    setup()

  $('#amount').keyup(updateTotal)
  $('#amount').focus(->
    $('#received').hide()
    $('#payment').fadeIn('slow')
    $(this).val('')
    updateTotal()
  )
)

setup = ->
  g.address or= '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'
  g.commission or= 0
  g.symbol or= 'mtgoxUSD'

  if g.title 
    $('#title').html(g.title).show()

  if g.logo
    $('#logo').attr('src', g.logo).show()
  else unless g.title
    $('#logo').attr('src', 'img/bitcoin.png').show()

  address = g.address
  if g.user? and g.user
    address = "<a href='/#{g.user}/report'>#{address}</a>"

  if check_address(g.address)
    $('#address').html(address)
  else
    fail(ADDRESS_FAIL)
    
  symbol = g.symbol

  $('#symbol').html(symbol)
  $('#currency').html(g.symbol.slice(-3))
  $('#received').hide()

  setupSocket()
  fetchExchangeRate()

fetchExchangeRate = ->
  $.ajax(
    url: "ticker?symbol=#{g.symbol}&type=ask&amount=1000",
    success: (exchange) -> 
      if exchange?
        clear(EXCHANGE_FAIL)
      else
        fail(EXCHANGE_FAIL)
        return

      unless g.setupComplete
        finalize() 

      g.exchange = exchange - exchange * g.commission * 0.01
      $('#exchange').val(g.exchange.toFixed(2))
      updateTotal()
    error: -> fail(EXCHANGE_FAIL)
  )
  setTimeout(fetchExchangeRate, 900000)

finalize = ->
  $('#amount').focus()
  g.setupComplete = true

setupSocket = ->
  setTimeout(setupSocket, 10000)

  unless g.websocket and g.websocket.readyState is 1
    g.websocket = new WebSocket("ws://ws.blockchain.info/inv")

    g.websocket.onopen = -> 
      g.websocket.send('{"op":"addr_sub", "addr":"' + g.address + '"}')
    
    g.websocket.onerror =  ->
      g.websocket = null
      fail(SOCKET_FAIL)

    g.websocket.onclose = ->
      setupSocket()

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

      if (total <= received) 
        $('#amount').blur()
        $('#payment').hide()
        $('#received').fadeIn('slow')

      if g.user
        $.post("/#{g.user}/transactions",
          address: from_address,
          date: moment().format("YYYY-MM-DD HH:mm:ss"),
          received: received,
          exchange: g.exchange
        )

updateTotal = ->
  amount = parseFloat($('#amount').val())
  total = amount / g.exchange
  total = Math.ceil(total * 10000) / 10000

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  $('#qr').html('')
  new QRCode('qr', "bitcoin:#{g.address}?amount=#{total.toString()}")

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
