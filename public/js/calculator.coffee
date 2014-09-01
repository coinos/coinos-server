#= require js/jquery-1.8.2.min.js
#= require js/moment.min.js
#= require js/qrcode.js
#= require js/bootstrap.min.js
#= require js/2.5.3-crypto-sha256.js
#= require js/jsbn.js
#= require js/jsbn2.js
#= require js/bitcoinjs-min.js
#= require js/sha512.js
#= require js/modsqrt.js
#= require js/rfc1751.js
#= require js/bip32.js

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

g = exports ? this

$(->
  $.ajax(
    url: $('#user').val() + '.json', 
    dataType: 'json',
    success: (data) ->
      g.user = data
      setup()
  )

  $('#tip button').click(->
    value = $(this).html().slice(0, -1)
    $(this).siblings().css('font-weight','normal').removeClass('active')
    $(this).css('font-weight','bold')
    g.tip = 1 + (parseFloat(value)/100)
    updateTotal()
  )

  $('#amount').keyup(updateTotal)
  $('#amount').focus(->
    $('#received').hide()
    $('#payment').fadeIn('slow')
    $(this).val('')
    updateTotal()
  )
)

setup = ->
  g.errors = []
  g.amount_requested = 0
  g.tip = 1
  g.user.address or= ''
  g.user.commission or= 0
  g.user.symbol or= 'quadrigacx'
  g.user.unit or= 'BTC'

  if g.user.logo
    $('#logo').attr('src', g.user.logo).show()
  else if g.user.title 
    $('#title').html("<a href='/#{g.user.username}/edit'>#{g.user.title}</a>").show()

  if g.user.bip32
    getAddress()
  else
    $('#bip32_notice').show()

  $('#symbol').html(g.user.symbol + " bid")
  $('#currency').html(g.user.currency)
  $('#unit').html(g.user.unit)
  $('#received').hide()
  $('#tip button').first().click()

  fetchExchangeRate()
  listen()

fetchExchangeRate = ->
  $.ajax(
    url: "ticker?currency=#{g.user.currency}&symbol=#{g.user.symbol}&type=bid",
    success: (exchange) -> 
      if exchange?
        clear(EXCHANGE_FAIL)
      else
        fail(EXCHANGE_FAIL)
        return

      g.exchange = exchange - exchange * g.user.commission * 0.01
      $('#exchange').val(g.exchange.toFixed(2))
      updateTotal()

      unless g.setupComplete
        $('#amount').focus()
        g.setupComplete = true

    error: -> fail(EXCHANGE_FAIL)
  )
  setTimeout(fetchExchangeRate, 900000)

updateTotal = ->
  precision = 9 - multiplier().toString().length
  amount = parseFloat($('#amount').val() * g.tip)
  total = (amount * multiplier() / g.exchange).toFixed(precision)
  g.amount_requested = (amount / g.exchange).toFixed(8)

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  $('#qr').html('')
  new QRCode('qr', text: "bitcoin:#{g.user.address}?amount=#{g.amount_requested.toString()}", width: 320, height: 320)

listen = ->
  setTimeout(listen, 10000)

  unless g.blockchain and g.blockchain.readyState is 1
    g.blockchain = new WebSocket("wss://ws.blockchain.info/inv")

    g.blockchain.onopen = -> 
      $('#connection').fadeIn().removeClass('glyphicon-exclamation-sign').addClass('glyphicon-signal')
      g.blockchain.send('{"op":"addr_sub", "addr":"' + g.user.address + '"}')
    
    g.blockchain.onerror =  ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.blockchain = null
      fail(SOCKET_FAIL)

    g.blockchain.onclose = ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.blockchain = null
      fail(SOCKET_FAIL)

    g.blockchain.onmessage = (e) ->
      results = eval('(' + e.data + ')')
      amount = 0
      txid = results.x.hash

      return if txid == g.last
      g.last = txid
      
      $.each(results.x.out, (i, v) ->
        if (v.addr == g.user.address) 
          amount += v.value / 100000000
      )

      logTransaction(txid, amount)

  unless g.btcd and g.btcd.readyState is 1
    g.btcd = new WebSocket("wss://coinos.io/ws")

    g.btcd.onopen = -> 
      $('#connection').fadeIn().removeClass('glyphicon-exclamation-sign').addClass('glyphicon-signal')
      msg = JSON.stringify { jsonrpc: "1.0", id: "coinos", method: 'notifyreceived', params: [[g.user.address]] }
      g.btcd.send(msg)
    
    g.btcd.onerror =  ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.btcd = null

    g.btcd.onclose = ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.btcd = null

    g.btcd.onmessage = (e) ->
      data = JSON.parse(e.data)
      amount = 0

      if data.result
        txid = data.result.txid
        return if txid == g.last
        g.last = txid

        for output in data.result.vout
          if g.user.address in output.scriptPubKey.addresses
            amount += parseFloat(output.value)

        logTransaction(txid, amount)

      if data.method and data.method is 'recvtx' and data.params.length is 1
        msg = JSON.stringify { jsonrpc: "1.0", id: "coinos", method: 'decoderawtransaction', params: [data.params[0]] }
        g.btcd.send(msg)

logTransaction = (txid, amount) ->
  if $('#received').is(":hidden") and amount >= g.amount_requested
    $('#amount').blur()
    $('#payment').hide()
    $('#received').fadeIn('slow')
    $('#chaching')[0].play()
    g.user.index++

    $.post("/#{g.user.username}/transactions",
      txid: txid,
      address: g.user.address,
      date: moment().format("YYYY-MM-DD HH:mm:ss"),
      received: amount,
      exchange: g.exchange
    )

    getAddress()

getAddress = ->
  i = g.user.index
  bip32 = new BIP32(g.user.bip32)
  result = bip32.derive("m/0/#{i}")
  hash160 = result.eckey.pubKeyHash
  g.user.address = (new Bitcoin.Address(hash160)).toString()
  s = """
    <a href='/#{g.user.username}/report'>#{g.user.address}</a> 
    <a href='http://blockchain.info/address/#{g.user.address}' target='_blank'>
      <img src='/assets/img/blockchain.png' />
    </a>
  """
  $('#address').html(s)

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
  switch g.user.unit
    when 'BTC' then 1
    when 'mBTC' then 1000
    when 'µBTC' then 1000000
    when 'satoshis' then 100000000


