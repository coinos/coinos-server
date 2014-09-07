#= require ../js/jquery-1.8.2.min.js
#= require ../js/jquery-ui.min.js
#= require ../js/jquery.printElement.min.js
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
      $('#title').val(data.title)
      $('#logo').val(data.logo)
      $('#pubkey').val(data.pubkey)
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

  $('#title').blur(->
    if $(this).val() == '' and $('#logo').val() == ''
      $(this).parent().addClass('has-error')
    else
        $(this).parent().removeClass('has-error')
  )

  $('#pubkey').blur(->
    if check_address($(this).val())
      $(this).parent().removeClass('has-error')
    else 
      $(this).parent().addClass('has-error')
  )

  $('#generate').click(->
    key = new Key()
    g.pubkey = key.extended_public_key_string()
    g.privkey = key.extended_private_key_string()

    $('#modal').modal()
    $('#privkey').html(g.privkey)
    $('#qr').html('')
    new QRCode('qr', text: g.privkey, width: 260, height: 260)
  )

  $('#encryption-password').keyup((e) ->
    return if e.keyCode is 9 or e.keyCode is 16
    enc_privkey = CryptoJS.AES.encrypt(g.privkey, $(this).val()).toString()
    enc_privkey = g.privkey if $(this).val() == ''
    $('#privkey').html(enc_privkey)
    $('#qr').html('')
    new QRCode('qr', text: enc_privkey, width: 260, height: 260)

    if $(this).val()
      $('#status').html('(Encrypted)')
    else
      $('#status').html('(Unencrypted Plaintext)')
  )

  $('#confirm').blur(->
    $('#confirm_error').remove() 
    if $('#password').val() != $('#confirm').val()
      $('#password, #confirm').parent().addClass('has-error')
      $('#confirm').parent().after('<div id="confirm_error" class="alert alert-danger">Passwords don\'t match</div>')
    else
      $('#password, #confirm').parent().removeClass('has-error')
  )

  $('#encryption-password, #encryption-confirm').keyup((e) -> check_passwords(e) unless e.keyCode is 9)
  $('#encryption-password, #encryption-confirm').blur((e) -> check_passwords(e))

  check_passwords = (e) ->
    if $('#encryption-password').val() != $('#encryption-confirm').val() or $('#encryption-password').val() is ''
      $('#encryption-password, #encryption-confirm').parent().addClass('has-error')
      $('#modal .alert').removeClass('alert-success').addClass('alert-danger')
    else
      $('#encryption-password, #encryption-confirm').parent().removeClass('has-error')
      $('#modal .alert').removeClass('alert-danger').addClass('alert-success')

  $('#print').click(->
    $('#key-dialog').printElement(printMode: 'popup')
  )

  $('a[data-toggle="tab"]').on('shown.bs.tab', (e) ->
    $('#encryption-password').focus()
    switch e.target.attributes.href.value
      when '#step1'
        $('.modal-footer button:first').hide()
        $('.modal-footer button:last').html('Next').off().on('click', -> $('a[data-toggle="tab"]:eq(1)').click())
      when '#step2'
        $('.modal-footer button:first').show().html('Back').off().on('click', -> $('a[data-toggle="tab"]:eq(0)').click())
        $('.modal-footer button:last').html('Next').off().on('click', -> $('a[data-toggle="tab"]:eq(2)').click())
      when '#step3'
        $('.modal-footer button:first').show().html('Back').off().on('click', -> $('a[data-toggle="tab"]:eq(1)').click())
        $('.modal-footer button:last').html('Got it!').off().on('click', -> 
          $('#modal .form-control').blur()
          if $('#modal .has-error').length > 0
            $('a[data-toggle="tab"]:eq(1)').click()
            $('#modal .has-error').effect('shake', 500)
          else
            g.update_pub_key = true
            $('#modal').modal('hide')
        )
  )

  $('.modal-footer button:last').on('click', -> $('a[data-toggle="tab"]:eq(1)').click())
  $('#modal').on('shown.bs.modal', -> 
    g.update_pub_key = false
    $('#encryption-password, #encryption-confirm').val('').blur()
    if $('.tab-pane:eq(2)').hasClass('active')
      $('a[data-toggle="tab"]:eq(1)').click()
  ).on('hidden.bs.modal', ->
    $('#pubkey').val(g.pubkey) if g.update_pub_key
  )

  $('#setup').submit(->
    $('#setup .form-control').blur()
    if $('#setup .has-error').length > 0
      $('#setup .has-error').effect('shake', 500)
      return false
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
