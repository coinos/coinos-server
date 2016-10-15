EXCHANGE_FAIL = "Problem fetching exchange rate"
SOCKET_FAIL = "Problem connecting to payment server, notifications may not appear"
ADDRESS_FAIL = "Invalid address"

g = exports ? this
g.errors = []
g.amount_requested = 0
g.amount = 0.toFixed(2)
g.tip = 1
g.transactions = []

$(->
  $.ajax(
    url: $('#user').val() + '.json', 
    dataType: 'json',
    success: (data) ->
      g.user = data
      setup()
  )

  $('button').click((e) ->
    e.preventDefault()
  )

  $('.numpad .btn').off('click').click((e) ->
    e.preventDefault()

    m = $(this).html()
    n = parseFloat($('.amount').html())

    if m is 'C'
      g.amount = 0.toFixed(2)
      updateTotal()
      return

    return if n > 10000000
    
    if m is '00'
      n = 100 * n
    else
      n = 10 * n + parseFloat(m) / 100

    g.amount = n.toFixed(2)

    updateTotal()
  )

  $('.numpad .btn:last').off('click').click((e) ->
    e.preventDefault()

    g.amount = (Math.floor(100 * (parseFloat($('.amount').html()) / 10)) / 100).toFixed(2)
    updateTotal()
  )

  $('.tippad .btn').off('click').click((e) ->
    e.preventDefault()

    text = $(this).html()
    if text is 'No Tip'
      value = 0
    else
      value = text.slice(1, -1)

    $(this).addClass('active')
    $(this).siblings().removeClass('active')
    g.tip = 1 + (parseFloat(value)/100)
    updateTotal()
  )

  $('#received').click(-> window.location = "/#{g.user.username}/report")
  $('#slide').click(-> 
    $('#controls').slideToggle() 
    $(this).find('i').toggleClass('fa-sort-up').toggleClass('fa-sort-down')
  )
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
    ext = g.user.logo.substr(g.user.logo.length - 3)
    src = "/img/logos/#{g.user.username}.#{ext}"
    $('#logo').attr('src', src).show()

  getAddress()

  $('.symbol').html(g.user.currency)
  $('.currency').html(g.user.currency)
  $('.unit').html(g.user.unit)

  $('#received').hide()

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
        g.setupComplete = true

    error: -> fail(EXCHANGE_FAIL)
  )
  setTimeout(fetchExchangeRate, 900000)

updateTotal = ->
  precision = 9 - multiplier().toString().length
  subtotal = parseFloat(g.amount * g.tip).toFixed(2)
  total = (subtotal * multiplier() / g.exchange).toFixed(precision)
  g.amount_requested = (subtotal / g.exchange).toFixed(8)

  unless $.isNumeric(total)
    total = ''

  $('#received').hide()
  $('#payment').fadeIn('slow')

  $('.tip').html((subtotal - g.amount).toFixed(2))
  $('.subtotal').html(subtotal.toString())
  $('.amount').html(g.amount)
  $('.exchange').html(g.exchange)
  $('.symbol').html(g.user.symbol)

  if g.user.commission < 0
    $('.commission').html("+#{Math.abs(g.user.commission)}%")


  $('#total').html(total.toString())
 
  # size = $('#calculator').width() * 0.7
  size = 300
  $('#qr').css('height', size)

  time = 0
  if g.timeout
    time = 10

  clearTimeout(g.timeout)
  g.timeout = setTimeout(->
    $('#qr').html('')
    new QRCode('qr', 
      text: "bitcoin:#{g.user.address}?amount=#{g.amount_requested.toString()}"
      width: size
      height: size
    )
  , time)

listen = ->
  g.attempts++
  if g.blockchain and g.blockchain.readyState is 1
    setTimeout(listen, 12000)
  else
    fail(SOCKET_FAIL) if g.attempts > 3
    g.blockchain = new WebSocket("wss://ws.blockchain.info/inv")

    g.blockchain.onopen = -> 
      if g.blockchain.readyState is 1
        g.attempts = 0
        clear(SOCKET_FAIL)
        g.blockchain.send('{"op":"addr_sub", "addr":"' + g.user.address + '"}')
      else
        setTimeout(g.blockchain.onopen, 12000 * g.attempts)
    
    g.blockchain.onerror =  ->
      fail(SOCKET_FAIL)
      g.blockchain.close()
      delete g.blockchain
      listen()

    g.blockchain.onclose = ->
      delete g.blockchain
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
    $('#payment').hide()
    $('#received').fadeIn('slow')
    $('#success')[0].play()
    g.user.index++

    if g.transactions.indexOf(txid) is -1
      g.transactions.push(txid)
      $.post("/#{g.user.username}/transactions",
        txid: txid,
        address: g.user.address,
        date: moment().format("YYYY-MM-DD HH:mm:ss"),
        received: amount,
        exchange: g.exchange
        tip: g.tip
      )

    getAddress()

getAddress = ->
  try
    bitcoin.address.fromBase58Check(g.user.pubkey)
    g.user.address = g.user.pubkey
  catch
    master = bitcoin.HDNode.fromBase58(g.user.pubkey)
    child = master.derive(0).derive(g.user.index)
    g.user.address = child.getAddress().toString()
    g.blockchain.close() if g.blockchain
    listen()

  $('#address').html("<a href='https://tradeblock.com/bitcoin/address/#{g.user.address}'>#{g.user.address}</a>")

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


