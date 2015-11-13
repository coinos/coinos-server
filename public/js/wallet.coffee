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

$(->
  api = 'https://api.blockcypher.com/v1/btc/main'
  addresses = []
  balance = 0
  token = ''
  $('#balance, #amount').hide()
  $.get("/token", (data) -> 
    token = data
    $.get("#{api}/wallets/hd/yummy/addresses?token=#{token}", (data) -> 
      for c in data.chains
        for a in c.chain_addresses
          addresses.push(a.address)

      chunks = []
      for i in [0 .. addresses.length] by 10 
        chunks.push(addresses.slice(i,i+10))

      doSetTimeout = (c,i) ->
        setTimeout(->
          $.get("#{api}/addrs/#{c.join(';')}/balance?token=#{token}", (addresses) -> 
            for address in addresses
              balance = parseInt(balance) + parseInt(address.final_balance)
              val = (balance / 100000000).toFixed(8)

            $('#balance').html(val)
            $('#amount').val(val)
            $('#balance, #amount').fadeIn()
          )
        , i*1500)

      for c, i in chunks
        doSetTimeout(c, i)
    )
  )

  user = $('#username').val()
  $.getJSON("/#{user}.json", (data) ->
    $('#pubkey').val(data.pubkey)
    $('#address').val(data.address)
    $('#setup').fadeIn()
  )
)

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
