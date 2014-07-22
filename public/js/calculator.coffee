#= require jquery-1.8.2.min.js
#= require moment.min.js
#= require qrcode.js
#= require bootstrap.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js
#= require socket.io.js

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

tip = 1

g = exports ? this

$(->
  g.user = $('#user').val()
  g.title = get('title')
  g.address = get('address')
  g.symbol = get('symbol')
  g.currency = get('currency')
  g.commission = parseFloat(get('commission'))
  g.logo = get('logo')
  g.errors = []
  g.receivable = 0

  if g.user
    $.ajax(
      url: g.user + '.json', 
      dataType: 'json',
      success: (data) ->
        if data?
          g.title = data.title
          g.address = data.address 
          g.currency = data.currency
          g.symbol = data.symbol
          g.commission = data.commission 
          g.logo = data.logo 
        setup()
    )
  else 
    setup()

  $('#tip button').click(->
    value = $(this).html().slice(0, -1)
    $(this).siblings().css('font-weight','normal').removeClass('active')
    $(this).css('font-weight','bold')
    tip = 1 + (parseFloat(value)/100)
    updateTotal()
  )

  $('#tip button').first().click()

  $('#amount').keyup(updateTotal)
  $('#amount').focus(->
    $('#received').hide()
    $('#payment').fadeIn('slow')
    $(this).val('')
    updateTotal()
  )
)

activateTip = (p) ->

setup = ->
  g.address or= ''
  g.commission or= 0
  g.symbol or= 'quadrigacx'

  if g.title 
    $('#title').html(g.title).show()

  if g.logo
    $('#logo').attr('src', g.logo).show()
  else unless g.title
    $('#logo').attr('src', 'img/bitcoin.png').show()

  $('#logo').click -> $(location).attr("href","/#{g.user}/edit")
  address = g.address
  if g.user? and g.user
    address = "#{address} <a href='http://blockchain.info/address/#{address}' target='_blank'><img src='/img/blockchain.png' /></a>"

  if check_address(g.address)
    $('#address').html(address)
  else
    fail(ADDRESS_FAIL)
    
  $('#symbol').html(g.symbol + " bid")
  $('#currency').html(g.currency)
  $('#received').hide()

  setupSocket()
  fetchExchangeRate()

fetchExchangeRate = ->
  $.ajax(
    url: "ticker?currency=#{g.currency}&symbol=#{g.symbol}&type=bid",
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
    g.websocket = new WebSocket("wss://ws.blockchain.info/inv")

    g.websocket.onopen = -> 
      $('#connection').fadeIn().removeClass('glyphicon-exclamation-sign').addClass('glyphicon-signal')
      g.websocket.send('{"op":"addr_sub", "addr":"' + g.address + '"}')
    
    g.websocket.onerror =  ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.websocket = null
      fail(SOCKET_FAIL)

    g.websocket.onclose = ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.websocket = null
      fail(SOCKET_FAIL)

    g.websocket.onmessage = (e) ->
      results = eval('(' + e.data + ')')
      from_address = ''
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

      if (g.receivable <= received) 
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
  amount = parseFloat($('#amount').val() * tip)
  total = (amount * 1000 / g.exchange).toFixed(5)
  g.receivable = (amount / g.exchange).toFixed(8)

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  $('#qr').html('')
  new QRCode('qr', "bitcoin:#{g.address}?amount=#{g.receivable.toString()}")


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
