#= require js/jquery-1.8.2.min.js
#= require js/moment.min.js
#= require js/qrcode.js
#= require js/bootstrap.min.js
#= require js/2.5.3-crypto-sha256.js
#= require js/jsbn.js
#= require js/jsbn2.js

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

g = exports ? this

$(->
  g.user = $('#user').val()
  g.errors = []
  g.amount_requested = 0
  g.tip = 1
  g.unit = 'BTC'

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
        g.unit = data.unit
      setup()
  )

  $('#tip button').click(->
    value = $(this).html().slice(0, -1)
    $(this).siblings().css('font-weight','normal').removeClass('active')
    $(this).css('font-weight','bold')
    g.tip = 1 + (parseFloat(value)/100)
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

setup = ->
  g.address or= ''
  g.commission or= 0
  g.symbol or= 'quadrigacx'

  if g.title 
    $('#title').html(g.title).show()

  if g.logo
    $('#logo').attr('src', g.logo).show()
  else unless g.title
    $('#logo').attr('src', '/assets/img/bitcoin.png').show()

  $('#logo').click -> $(location).attr("href","/#{g.user}/edit")
  $('#address').html("#{address} <a href='http://blockchain.info/address/#{address}' target='_blank'><img src='/assets/img/blockchain.png' /></a>")
  $('#symbol').html(g.symbol + " bid")
  $('#currency').html(g.currency)
  $('#unit').html(g.unit)
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

  unless g.btcd and g.btcd.readyState is 1
    g.btcd = new WebSocket("wss://coinos.io/ws")

    g.btcd.onopen = -> 
      $('#connection').fadeIn().removeClass('glyphicon-exclamation-sign').addClass('glyphicon-signal')
      msg = JSON.stringify { jsonrpc: "1.0", id: "coinos", method: 'notifyreceived', params: [[g.address]] }
      g.btcd.send(msg)
    
    g.btcd.onerror =  ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.btcd = null

    g.btcd.onclose = ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.btcd = null

    g.btcd.onmessage = (e) ->
      data = JSON.parse(e.data)
      amount_received = 0

      if data.result
        for output in data.result.vout
          if g.address in output.scriptPubKey.addresses
            amount_received += parseFloat(output.value)

        if g.user
          $.post("/#{g.user}/transactions",
            txid: data.result.txid,
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            received: amount_received,
            tip: g.tip,
            exchange: g.exchange
          )

        if amount_received >= g.amount_requested
          $('#amount').blur()
          $('#payment').hide()
          $('#received').fadeIn('slow')
          $('#chaching')[0].play()

      if data.method and data.method is 'recvtx' and data.params.length is 1
        msg = JSON.stringify { jsonrpc: "1.0", id: "coinos", method: 'decoderawtransaction', params: [data.params[0]] }
        g.btcd.send(msg)

updateTotal = ->
  precision = 9 - multiplier().toString().length
  amount = parseFloat($('#amount').val() * g.tip)
  total = (amount * multiplier() / g.exchange).toFixed(precision)
  g.amount_requested = (amount / g.exchange).toFixed(8)

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  $('#qr').html('')
  new QRCode('qr', "bitcoin:#{g.address}?amount=#{g.amount_requested.toString()}")

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

Array::uniq = ->
  output = {}
  output[@[key]] = @[key] for key in [0...@length]
  value for key, value of output

multiplier = ->
  switch g.unit
    when 'BTC' then 1
    when 'mBTC' then 1000
    when 'µBTC' then 1000000
    when 'satoshis' then 100000000


