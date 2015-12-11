g = exports ? this
g.proceed = false
g.api = 'https://api.blockcypher.com/v1/btc/main'

validators = 
  address: (e) ->
    try 
      bitcoin.address.fromBase58Check(e.val())
    catch
      return false

  password: (e) ->
    g.master = null
    try
      g.master = bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt($('#privkey').val(), e.val()).toString(CryptoJS.enc.Utf8))
      $('#invalid_keys').fadeOut()
    catch
      return false


errors = 
  address: 'Invalid address'
  password: 'Wrong password'

$(->
  getToken()
  $('form').validator(custom: validators, errors: errors)

  $('button[data-toggle=tooltip]').tooltip(trigger: 'hover')

  $('#keys form input[type=button]').click(->
    $('.form-control').blur()
    if $('#keys .has-error').length > 0
      $('#keys .has-error').effect('shake', 500)
      return

    $('#withdraw').click()
    $('#keys_updated').fadeIn()

    $.post("/#{g.user.username}", $('#keys form').serializeObject(), ->
      $.ajax(
        url: "#{g.api}/wallets/hd/#{g.user.username}?token=#{g.token}"
        type: 'DELETE'
      ).done(->
        setTimeout(->
          data = 
            name: g.user.username
            extended_public_key: $('#pubkey').val()
            subchain_indexes: [0,1]
    
          $.post("#{g.api}/wallets/hd?token=#{g.token}", JSON.stringify(data)).always(->
            $.post("#{g.api}/wallets/hd/#{g.user.username}/addresses/derive?token=#{g.token}").always(->
              getBalance()
            )
          )
        , 300)
      )
    )

    return false
  )

  $('#withdrawal form input[type=button]').click(sendTransaction)

  $('#currency_toggle').click(->
    if $(this).html() is g.user.unit
      $(this).html(g.user.currency)
      g.amount = parseFloat($('#amount').val()).toFixed(precision())
      amount = (g.amount * g.exchange / multiplier()).toFixed(2)
      $('#amount').val(amount)
      $('#amount').attr('step', 0.01)
      $('#amount').attr('max', (g.balance * g.exchange / multiplier()).toFixed(2))
    else
      $(this).html(g.user.unit)
      $('#amount').val(convertedAmount())
      $('#amount').attr('step', 0.00000001 * multiplier())
      $('#amount').attr('max', g.balance)
  )
  
  $('#max').click(->
    if $('#currency_toggle').html() is g.user.unit
      $('#amount').val(g.balance)
    else
      g.amount = parseFloat(g.balance).toFixed(precision())
      amount = (g.balance / multiplier() * g.exchange).toFixed(2)
      $('#amount').val(amount)
  )

  $('#amount').change(->
    if $('#currency_toggle').html() is g.user.unit
      $(this).val(parseFloat($(this).val()).toFixed(precision()))
    else
      $(this).val(parseFloat($(this).val()).toFixed(2))

    if parseFloat($(this).val()) > parseFloat($(this).attr('max'))
      $(this).val($(this).attr('max'))
  )

  $('#password').keyup(->
  )

  $('#new_password').keyup(->
    $('#privkey').val(CryptoJS.AES.encrypt(g.privkey, $(this).val()))

    try
      bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt(g.user.privkey, $(this).val()).toString(CryptoJS.enc.Utf8))
    catch
  )

  $('#manage').click(->
    $('#withdrawal').hide()
    $('#keys').show()
    $('#withdraw').toggle(g.balance > 0)
    $('#manage').hide()
    $('#privkey').val(g.user.privkey)
  )

  $('#withdraw').click(->
    $('#keys, #withdrawal').toggle()
    $('#withdraw, #manage').toggle()
  )

  $('#backup').click(->
    url = 'data:application/json;base64,' + btoa(JSON.stringify(g.user.privkey))
    pom = document.createElement('a')
    pom.setAttribute('href', url)
    pom.setAttribute('download', 'coinos-wallet.aes.json')
    pom.click()
  )

  $('#generate').click(->
    mnemonic = bip39.generateMnemonic()
    key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0)
    g.privkey = key.toString()
    $('#pubkey').val(key.neutered().toString()).effect('highlight', {}, 2000)
    $('#privkey').val('')
    $('#new_password').parent().show()
    $('#new_password').effect('shake', 500).focus()
  )

  $('.close').on('click', -> $(this).closest('.alert').fadeOut())
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
  $.get("#{g.api}/wallets?token=#{g.token}", (data) ->
    if g.user.username in data.wallet_names
      getBalance()
    else
      if isBip32(g.user.pubkey)
        data = 
          name: g.user.username
          extended_public_key: g.user.pubkey
          subchain_indexes: [0,1]

        $.post("#{g.api}/wallets/hd?token=#{g.token}", JSON.stringify(data)).always(getBalance)
      else
        # TODO implement this properly
        $('#balance').html(99)
        $('#amount').val(99)
  )


getBalance = ->
  $.get("#{g.api}/addrs/#{g.user.username}/balance?token=#{g.token}&omitWalletAddresses=true", (data) ->
    balance = data.final_balance
    g.balance = balance.toBTC()
    fiat = balance.toFiat()
    $('#balance').html(g.balance)
    $('#fiat').html("#{fiat} #{g.user.currency}")
    $('#amount').attr('max', g.balance)
    $('.wallet').fadeIn()

    if g.balance > 0
      $('#withdrawal').show()
      $('#amount').focus()
    else
      $('#manage').click()
  )

sendTransaction = ->
  if !g.master or typeof g.master.keyPair.d is 'undefined'
    $('#invalid_keys').fadeIn()
    $('#password').focus()
  else
    dialog = new BootstrapDialog(
      title: '<h3>Confirm Transaction</h3>'
      message: '<i class="fa fa-spinner fa-spin"></i> Calculating fee...</i>'
      buttons: [
        label: 'Send'
        cssClass: 'btn-primary'
      ,
        label: ' Cancel'
        cssClass: 'btn-default'
        action: (dialogItself) -> dialogItself.close()
        icon: 'glyphicon glyphicon-ban-circle'
      ]
    ).open()

    params = 
      inputs: [{wallet_name: g.user.username, wallet_token: g.token}]
      outputs: [{addresses: [$('#recipient').val()], value: 1}]
      preference: $('#priority').val()

    $.post("#{g.api}/txs/new?token=#{g.token}", JSON.stringify(params)).done((data) ->
      if $('#currency_toggle').html() is g.user.unit
        amount = $('#amount').val()
      else
        amount = convertedAmount()

      value = parseInt(amount * 100000000 / multiplier())

      params.fees = data.tx.fees
      params.outputs[0].value = value
      if value > parseFloat(g.balance).toSatoshis() - params.fees 
        params.outputs[0].value -= params.fees

      $.post("#{g.api}/txs/new?token=#{g.token}", JSON.stringify(params)).done((data) ->
        data.pubkeys = []
        data.signatures = data.tosign.map((tosign, i) ->
          path = data.tx.inputs[i].hd_path.split('/')
          key = g.master.derive(path[1]).derive(path[2])
          data.pubkeys.push(key.keyPair.getPublicKeyBuffer().toString('hex'))
          return key.keyPair.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex")
        )

        g.data = data

        amount = data.tx.outputs[0].value
        fee = data.tx.fees
        total = amount
        if value > parseFloat(g.balance).toSatoshis() - data.tx.fees 
          total += fee

        $('.dialog .amount').html("#{(amount.toBTC())} #{g.user.unit} (#{amount.toFiat()} #{g.user.currency})")
        $('.dialog .fee').html("#{(fee.toBTC())} #{g.user.unit} (#{fee.toFiat()} #{g.user.currency})")
        $('.dialog .total').html("#{(total.toBTC())} #{g.user.unit} (#{total.toFiat()} #{g.user.currency})")
        $('.dialog .address').html(data.tx.outputs[0].addresses[0])

        dialog.getModalBody().html($('.dialog').html())

        dialog.getModal().find('.btn-primary').click(-> 
          $.post("#{g.api}/txs/send?token=#{g.token}", JSON.stringify(g.data)).then((finaltx) ->
            $('#transaction_sent').fadeIn()
            balance = g.balance.toSatoshis() - finaltx.tx.outputs[0].value - finaltx.tx.fees
            g.balance = balance.toBTC()
            fiat = balance.toFiat()
            $('#balance').html(g.balance)
            $('#fiat').html("#{fiat} #{g.user.currency}")
            $('#blockchain').off('click').on('click', -> window.open('https://live.blockcypher.com/btc/main/' + finaltx.tx.hash, '_blank'))
            dialog.close()
          )
        )
      ).fail((data) ->
        displayErrors(data.responseJSON, dialog)
      )
    ).fail((data) ->
      displayErrors(data.responseJSON, dialog)
    )

displayErrors = (data, dialog) ->
  if data.errors
    dialog.getModalBody().html('')
    dialog.getModal().find('.btn-primary').hide()
    for e in data.errors
      dialog.getModalBody().append("<div class='alert alert-danger'>#{e.error}</div>")


convertedAmount = ->
  amount = parseFloat($('#amount').val() * multiplier() / g.exchange).toFixed(precision())
  difference = parseFloat(Math.abs(g.amount - amount).toFixed(precision()))
  tolerance = parseFloat((.00000002 * g.exchange * multiplier()).toFixed(precision()))
  if difference > tolerance
    return amount
  else
    return g.amount


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

Number.prototype.toBTC = ->
  parseFloat((this / 100000000 * multiplier()).toFixed(precision()))

Number.prototype.toFiat = ->
  (this * g.exchange / 100000000).toFixed(2)

Number.prototype.toSatoshis = ->
  parseInt(this * 100000000 / multiplier())


