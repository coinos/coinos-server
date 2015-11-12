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
  $('#encryption-password').pwstrength(showVerdicts: false)

  $.getJSON("/js/rates.json", (data) ->
    currencies = Object.keys(data)
    currencies = currencies.sort()
    currencies.pop()

    $.each(currencies, (i, v) ->
      $('#currency').append("<option value='#{v}'>#{v}</option>")
    )
    $("#currency option[value='CAD']").attr('selected', 'selected')

    $('#currency').change(->
      $('#symbol option').remove()
      symbol = $(this).val()
      return unless symbol
      symbols = Object.keys(data[symbol])
      $.each(symbols, (i, v) ->
        return if v == 'localbitcoins'
        $('#symbol').append("<option value='#{v}'>#{v}</option>")
      )

      switch $(this).val()
        when 'CAD'
          $("#symbol option[value='quadrigacx']").attr('selected', 'selected')
        when 'USD'
          $("#symbol option[value='bitstamp']").attr('selected', 'selected')
    )

    user = $('#username').val()
    $.getJSON("/#{user}.json", (data) ->
      $('#email').val(data.email)
      $('#title').val(data.title)
      $('#logo').val(data.logo)
      $('#address').val(data.address)
      $("#symbol option[value='#{data.symbol}']").attr('selected', 'selected')
      $('#commission').val(data.commission)
      $('#unit').val(data.unit)
      $('#currency').change()
      $('#setup').fadeIn()
      $('#title').focus()
    )
  )

  units = ['BTC', 'mBTC', '&micro;BTC', 'bits', 'satoshis']
  $.each(units, (i, v) ->
    $('#unit').append("<option value='#{v}'>#{v}</option>")
  )

  $('#setup').submit(->
    $('#setup .form-control').blur()
    if $('#setup .has-error').length > 0
      $('#setup .has-error').effect('shake', 500)
      return false
  )
)

