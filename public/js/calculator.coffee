#= require js/jquery-1.8.2.min.js
#= require js/moment.min.js
#= require js/qrcode.js
#= require js/bootstrap.min.js
#= require js/2.5.3-crypto-sha256.js
#= require js/jsbn.js
#= require js/jsbn2.js
#= require js/bitcoinjs-min.js
#= require js/bitcoinjs-min-1.0.2.js
#= require js/sha512.js
#= require js/modsqrt.js
#= require js/rfc1751.js

EXCHANGE_FAIL = "Error fetching exchange rate"
SOCKET_FAIL = "Error connecting to payment server"
ADDRESS_FAIL = "Invalid address"

g = exports ? this
g.errors = []
g.amount_requested = 0
g.tip = 1

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

  $('#received').click(-> window.location = "/#{g.user.username}/report")
)

setup = ->
  g.user.address or= ''
  g.user.commission or= 0
  g.user.currency or= 'CAD'
  g.user.symbol or= 'quadrigacx'
  g.user.unit or= 'BTC'

  if g.user.title 
    $('#title').html("<a href='/#{g.user.username}/edit'>#{g.user.title}</a>").show()

  if g.user.logo
    $('#logo').attr('src', g.user.logo).show()

  getAddress()

  $('#symbol').html(g.user.currency)
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

      g.exchange = (exchange - exchange * g.user.commission * 0.01).toFixed(2)
      $('#exchange').html(g.exchange)
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
      clear(SOCKET_FAIL)
      g.blockchain.send('{"op":"addr_sub", "addr":"' + g.user.address + '"}')
    
    g.blockchain.onerror =  ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.blockchain = null
      fail(SOCKET_FAIL)

    g.blockchain.onclose = ->
      $('#connection').addClass('glyphicon-exclamation-sign').removeClass('glyphicon-signal')
      g.blockchain = null
      fail(SOCKET_FAIL)
      listen()

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
  try
    bitcoin.Address.fromBase58Check(g.user.pubkey)
    g.user.address = g.user.pubkey
  catch
    try
      master = bitcoin.HDNode.fromBase58(g.user.pubkey)
      child = master.derive(0).derive(g.user.index)
      g.user.address = child.pubKey.getAddress().toString()
    catch
      fail(ADDRESS_FAIL)

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
    when 'bits' then 1000000
    when 'satoshis' then 100000000


