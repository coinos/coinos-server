#= require js/2.5.3-crypto-sha256.js
#= require js/jsbn.js
#= require js/jsbn2.js
#= require js/bitcoinjs-min.js
#= require js/bitcoinjs-min-1.0.2.js
#= require js/sha512.js
#= require js/modsqrt.js
#= require js/rfc1751.js
#= require js/bip32.js

check_address = (address) ->
  try
    bitcoin.Address.fromBase58Check(address)
    return true
  catch
    return isBip32(address)

isBip32 = (address) ->
  try
    bitcoin.Address.fromBase58Check(address)
    return true
  catch
    return false
