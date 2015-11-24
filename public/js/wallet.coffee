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
#= require ../js/bitcoinjs-min-1.0.2.js
#= require ../js/bitcoinjs-min.js
#= require ../js/modsqrt.js
#= require ../js/bip32.js
#= require ../js/secure_random.js
#= require ../js/qrcode.js
#= require ../js/aes.js
#= require ../js/key.js

g = exports ? this
g.proceed = false
g.api = 'https://api.blockcypher.com/v1/btc/main'

$(->
  getToken()
  $('form').submit(->
    $('.form-control').blur()
    if $('.has-error').length > 0
      $('.has-error').effect('shake', 500)
      return false
  )

  $('#currency_toggle').click(->
    if $(this).html() is g.user.unit
      g.amount = parseFloat($('#amount').val()).toFixed(precision())
      $('#amount').val((g.amount * g.exchange / multiplier()).toFixed(2))
      $(this).html(g.user.currency)
      $('#amount').attr('step', 0.01)
    else
      amount = parseFloat($('#amount').val() * multiplier() / g.exchange).toFixed(precision())
      if Math.abs(g.amount - amount).toFixed(precision()) > (.000000005 * g.exchange * multiplier()).toFixed(precision())
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
    $('#address').val(user.address)
    $('#unit').html(user.unit)
    $('#currency_toggle').html(user.unit)
    $('form').fadeIn()
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
  else
    getAddresses()

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
    for i in [0..Math.floor(count / 10)]
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

    if chunks.length
      for chunk, i in chunks
        getChunk(chunk, i, chunks.length - 1) if chunk.length

    calculateBalance()
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

check_address = (address) ->
  try
    bitcoin.Address.fromBase58Check(address)
    return true
  catch
    return isBip32(address)

isBip32 = (address) ->
  try
    new BIP32(address)
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
