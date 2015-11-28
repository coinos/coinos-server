#= require ../js/jquery-1.8.2.min.js
#= require ../js/jquery-ui.min.js
#= require ../js/jquery.printElement.min.js
#= require ../js/check_password.js
#= require ../js/bootstrap.min.js
#= require ../js/jsbn.js
#= require ../js/jsbn2.js
#= require ../js/crypto-min.js
#= require ../js/2.5.3-crypto-sha256.js
#= require ../js/sha512.js
#= require ../js/rfc1751.js
#= require ../js/bitcoinjs-lib.min.js
#= require ../js/modsqrt.js
#= require ../js/bip32.js
#= require ../js/secure_random.js
#= require ../js/qrcode.js
#= require ../js/aes.js
#= require ../js/buffer.js

g = exports ? this
g.proceed = false
g.api = 'https://api.blockcypher.com/v1/btc/main'

$(->
  getToken()
  $('#settings form input[type=button]').click(->
    $('.form-control').blur()
    if $('.has-error').length > 0
      $('.has-error').effect('shake', 500)

    $.ajax(
      url: "#{g.api}/wallets/hd/#{g.user.username}?token=#{g.token}"
      type: 'DELETE'
    )

    $.post("/#{g.user.username}", $('#settings form').serializeObject(), ->
      $('#settings .alert-success').fadeIn().delay(500).fadeOut()
    )

    localStorage.removeItem(g.user.username)
    return false
  )

  $('#withdraw form input[type=button]').click(->
    sendTransaction()
  )

  $('#currency_toggle').click(->
    if $(this).html() is g.user.unit
      g.amount = parseFloat($('#amount').val()).toFixed(precision())
      $('#amount').val((g.amount * g.exchange / multiplier()).toFixed(2))
      $(this).html(g.user.currency)
      $('#amount').attr('step', 0.01)
    else
      amount = parseFloat($('#amount').val() * multiplier() / g.exchange).toFixed(precision())
      difference = parseFloat(Math.abs(g.amount - amount).toFixed(precision()))
      tolerance = parseFloat((.000000005 * g.exchange * multiplier()).toFixed(precision()))
      if difference > tolerance
        $('#amount').val(amount)
      else
        $('#amount').val(g.amount)

      $(this).html(g.user.unit)
      $('#amount').attr('step', 0.00000001 * multiplier())
  )
  
  $('#max').click(->
    if $('#currency_toggle').html() is g.user.unit
      $('#amount').val(g.balance)
      $('#amount').attr('max', g.balance)
    else
      g.amount = parseFloat(g.balance).toFixed(precision())
      amount = (g.balance / multiplier() * g.exchange).toFixed(2)
      $('#amount').val(amount)
      $('#amount').attr('max', amount)
  )

  $('#amount').change(->
    if $('#currency_toggle').html() is g.user.unit
      $(this).val(parseFloat($(this).val()).toFixed(precision()))
    else
      $(this).val(parseFloat($(this).val()).toFixed(2))
  )
)


getToken = ->
  $.get("/token", (token) -> 
    g.token = token
    getUser()
  )

getUser = ->
  $.getJSON("/#{$('#username').val()}.json", (user) ->
    g.user = user
    $('#pubkey').val(user.pubkey)
    $('#privkey').val(user.privkey)
    $('#address').val(user.address)
    $('#unit').html(user.unit)
    $('#currency_toggle').html(user.unit)
    $('#amount').attr('step', 0.00000001 * multiplier())

    getExchangeRate()
  )

getExchangeRate = ->
  $.get("/ticker?currency=#{g.user.currency}&symbol=#{g.user.symbol}&type=bid", (exchange) -> 
    g.exchange = exchange
    createWallet()
  )

createWallet = ->
  if localStorage.getItem(g.user.username) is null
    localStorage.setItem(g.user.username, JSON.stringify(addresses: [], balances: []))

  if isBip32(g.user.pubkey)
    data = 
      name: g.user.username
      extended_public_key: g.user.pubkey
      subchain_indexes: [0,1]
    $.post("#{g.api}/wallets/hd?token=#{g.token}", JSON.stringify(data), getAddresses).fail(getAddresses)
  else
    $('#balance').html(99)
    $('#amount').val(99)

getAddresses = ->  
  addresses = []
  g.cache = JSON.parse(localStorage.getItem(g.user.username))
  $.get("#{g.api}/wallets/hd/#{g.user.username}/addresses?token=#{g.token}", (data) -> 
    count = g.cache.addresses.length
    balances = g.cache.balances

    for c in data.chains
      for a in c.chain_addresses
        addresses.push(a.address)

    g.cache.addresses = addresses
    localStorage.setItem(g.user.username, JSON.stringify(g.cache))

    chunks = []
    for i in [Math.floor(count / 10)..Math.floor(addresses.length / 10)]
      chunks.push(addresses.slice(10 * i + count, 10 * i + count + 10))

    getChunk = (chunk, i, last) ->
      setTimeout(->
        $.get("#{g.api}/addrs/#{chunk.join(';')}/balance?token=#{g.token}", (addresses) -> 
          addresses = [addresses] unless addresses instanceof Array
          for address in addresses
            g.cache.balances.push(parseInt(address.final_balance))

          if i is last
            localStorage.setItem(g.user.username, JSON.stringify(g.cache))
            calculateBalance() 
        )
      , i*1500)

    hit = false
    if chunks.length
      for chunk, i in chunks
        if chunk.length
          hit = true
          getChunk(chunk, i, chunks.length - 1) 

    calculateBalance() unless hit
  )

calculateBalance = ->
  balance = 0
  balances = JSON.parse(localStorage.getItem(g.user.username)).balances
  if balances.length
    balance = balances.reduce (t,s) -> t + s 

  g.balance = (balance * multiplier() / 100000000).toFixed(precision())
  fiat = (g.balance * g.exchange / multiplier()).toFixed(2)
  $('#balance').html(g.balance)
  $('#balance').parent().fadeIn()
  $('#fiat').html("#{fiat} #{g.user.currency}")
  $('#amount').val(g.balance)

sendTransaction = ->
  master = bitcoin.HDNode.fromBase58(g.user.privkey)
  if typeof master.keyPair.d isnt 'undefined'
    fee = 12500
    amount = parseInt($('#amount').val() * 100000000 / multiplier())
    amount = amount - fee
    req = 
      inputs: [{wallet_name: g.user.username, wallet_token: g.token}],
      outputs: [{addresses: [$('#recipient').val()], value: amount}]

    $.post("#{g.api}/txs/new?token=#{g.token}", JSON.stringify(req)).then((tx) ->
      tx.pubkeys = []
      tx.signatures = tx.tosign.map((tosign, i) ->
        path = tx.tx.inputs[i].hd_path.split('/')
        key = master.derive(path[1]).derive(path[2])
        tx.pubkeys.push(key.getPublicKeyBuffer().toString('hex'))
        return key.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex")
      )

      $.post("#{g.api}/txs/send?token=#{g.token}", JSON.stringify(tx)).then((finaltx) ->
        $('#withdraw .alert-success').fadeIn().delay(500).fadeOut()
      )
    )
  else
    $('#withdraw .alert-danger').fadeIn().delay(500).fadeOut()


check_address = (address) ->
  try
    bitcoin.address.fromBase58Check(address)
    return true
  catch
    return isBip32(address)

isBip32 = (address) ->
  try
    bitcoin.HDNode.fromBase58(address)
    return true
  catch
    return false

multiplier = ->
  switch g.user.unit
    when 'BTC' then 1
    when 'mBTC' then 1000
    when 'µBTC' then 1000000
    when 'bits' then 1000000
    when 'satoshis' then 100000000

precision = ->
  9 - multiplier().toString().length
