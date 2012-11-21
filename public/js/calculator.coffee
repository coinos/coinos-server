#= require jquery-1.8.2.min.js
#= require moment.min.js
#= require qr.js
#= require bootstrap.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js

g = exports ? this

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

$(->
  g.websocket = null
  g.user = $('#user').val()
  g.name = get('name')
  g.address = get('address')
  g.symbol = get('symbol')
  g.commission = parseFloat(get('commission'))
  g.logo = get('logo')
  g.exchange = 0
  g.errors = []

  setupPage()
  setupQR()
  setupSocket()

  if user? and user
    $.ajax(
      url: user + '.json', 
      cache: false,
      dataType: 'json',
      success: (data) ->
        return unless data?
        g.name = data.name
        g.address = data.address 
        g.symbol = data.symbol
        g.commission = data.commission 
        g.logo = data.logo 
        setupPage()
    )

  $('#amount').keyup(updateTotal)
  $('#amount').focus()
  $('#amount').focus(->
    $('#received').hide()
    $('#payment').fadeIn('slow')
    $(this).val('')
    updateTotal()
  )
)

updateTotal = ->
  amount = parseFloat($('#amount').val())
  total = amount / g.exchange
  total = Math.ceil(total * 10000) / 10000

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  displayQR('bitcoin:' + g.address + '?amount=' + total.toString())

fetchExchangeRate = ->
  $.ajax(
    url: 'ticker?symbol=' + g.symbol,
    dataType: 'json',
    cache: false,
    success: (data) -> 
      if data?
        clear(EXCHANGE_FAIL)
      else
        fail(EXCHANGE_FAIL)
        return

      exchange = 1000 / data.out
      exchange = exchange - exchange * g.commission * 0.01
      g.exchange = Math.ceil(exchange * 100) / 100
      $('#exchange').val(g.exchange.toFixed(2))
      updateTotal()
    error: -> fail(EXCHANGE_FAIL)
  )

  setTimeout(fetchExchangeRate, 900000)

fail = (msg) ->
  g.errors.push(msg)
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

setupPage = ->
  g.address or= '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'
  g.commission or= 0
  g.symbol or= 'virtexCAD'

  if g.logo
    $('#logo').attr('src', g.logo).show()
  else if not g.name
    $('#logo').attr('src', 'img/bitcoin.png').show()
  else
    $('#name').html(g.name).show()

  if check_address(g.address)
    $('#address').html("<a href='https://blockchain.info/address/#{g.address}'>#{g.address}</a>")
  else
    fail(ADDRESS_FAIL)
    
  symbol = g.symbol
  symbol += " - #{g.commission.toFixed(0)}%" if g.commission > 0 

  $('#symbol').html(symbol)
  $('#currency').html(g.symbol.slice(-3))
  $('#received').hide()

  if g.exchange is 0
    fetchExchangeRate()

setupSocket = ->
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

get = (name) ->
  name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]")
  regexS = "[\\?&]" + name + "=([^&#]*)"
  regex = new RegExp(regexS)
  results = regex.exec(window.location.search)

  if (results == null)
    return ""
  else
    return decodeURIComponent(results[1].replace(/\+/g, " "))

