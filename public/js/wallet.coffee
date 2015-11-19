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
    if $(this).html() is 'BTC'
      g.amount = $('#amount').val()
      $('#amount').val((g.amount * g.exchange).toFixed(2))
      $(this).html(g.user.currency)
    else
      amount = $('#amount').val() / g.exchange
      if Math.abs(g.amount - amount) > 0.00001
        $('#amount').val(parseFloat(amount).toFixed(8))
      else
        $('#amount').val(parseFloat(g.amount).toFixed(8))

      $(this).html('BTC')
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
    $('form').fadeIn()

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
      $.post("#{g.api}/wallets/hd?token=#{g.token}", JSON.stringify(data), getAddresses)
    else
      $('#balance').html(99)
      $('#amount').val(99)
  else
    getAddresses()

getAddresses = ->  
  addresses = []
  $.get("#{g.api}/wallets/hd/#{g.user.username}/addresses?token=#{g.token}", (data) -> 
    count = JSON.parse(localStorage.getItem(g.user.username)).addresses.length
    balances = JSON.parse(localStorage.getItem(g.user.username)).balances

    for c in data.chains
      for a in c.chain_addresses
        addresses.push(a.address)

    chunks = []
    for i in [0..Math.floor(count / 10)]
      chunks.push(addresses.slice(10 * i + count, 10 * i + count + 10))

    getChunk = (chunk, i, last) ->
      setTimeout(->
        $.get("#{g.api}/addrs/#{chunk.join(';')}/balance?token=#{g.token}", (addresses) -> 
          for address in addresses
            balances.push(parseInt(address.final_balance))

          if i is last
            localStorage.setItem(g.user.username, JSON.stringify(addresses: addresses, balances: balances))
            calculateBalance() 
        )
      , i*1500)

    if chunks[0].length
      for chunk, i in chunks
        getChunk(chunk, i, chunks.length)
    else
      calculateBalance()

    localStorage.setItem(g.user.username, JSON.stringify(addresses: addresses, balances: balances))
  )

calculateBalance = ->
  balances = JSON.parse(localStorage.getItem(g.user.username)).balances
  balance = balances.reduce (t,s) -> t + s
  g.balance = (balance / 100000000).toFixed(8)
  $('#balance').html(g.balance)
  $('#fiat').html("#{(g.balance * g.exchange).toFixed(2)} #{g.user.currency}")
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
