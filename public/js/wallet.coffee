buffer = require('buffer')

g = exports ? this
g.proceed = false
g.api = 'https://api.blockcypher.com/v1/btc/main'

$(->
  getToken()

  $('button[data-toggle=tooltip]').tooltip(trigger: 'hover')

  $('#keys form input[type=button]').click(->
    $('.form-control').blur()
    if $('.has-error').length > 0
      $('.has-error').effect('shake', 500)

    $.ajax(
      url: "#{g.api}/wallets/hd/#{g.user.username}?token=#{g.token}"
      type: 'DELETE'
    )

    $.post("/#{g.user.username}", $('#settings form').serializeObject(), ->
      $('#keys .alert-success').fadeIn().delay(2000).fadeOut()
      setTimeout(-> 
        $('#withdraw').click()
      , 2000)
    )

    return false
  )

  $('#withdrawal form input[type=button]').click(->
    sendTransaction()
  )

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
    try
      g.privkey = CryptoJS.AES.decrypt(g.user.privkey, $(this).val()).toString(CryptoJS.enc.Utf8)
  )

  $('#manage, #withdraw').click(->
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
    g.balance = (balance * multiplier() / 100000000).toFixed(precision())
    fiat = (g.balance * g.exchange / multiplier()).toFixed(2)
    $('#balance').html(g.balance)
    $('.wallet').fadeIn()
    $('#fiat').html("#{fiat} #{g.user.currency}")
    $('#amount').attr('max', g.balance)
    $('#amount').val(0.00001)
    $('#recipient').val('13zP2yHXd6pMM9cATwRtQcTx7CgZsi6saE')
    $('#amount').focus()
  )

sendTransaction = ->
  params = 
    inputs: [{wallet_name: g.user.username, wallet_token: g.token}]
    outputs: [{addresses: [$('#recipient').val()], value: 1}]
    preference: $('#priority').val()

  $.post("#{g.api}/txs/new?token=#{g.token}", JSON.stringify(params)).done((data) ->
    if data.errors
      dialog.getModalBody().html('')
      for e in data.errors
        dialog.getModalBody().append("<div class='alert alert-danger'>#{e}</div>")

    try
      master = bitcoin.HDNode.fromBase58(g.privkey)

    if !master or typeof master.keyPair.d is 'undefined'
      $('#withdrawal .alert-danger').fadeIn().delay(3000).fadeOut()
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
          key = master.derive(path[1]).derive(path[2])
          data.pubkeys.push(key.getPublicKeyBuffer().toString('hex'))
          return key.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex")
        )

        amount = data.tx.outputs[0].value
        fee = data.tx.fees
        total = amount
        if value > parseFloat(g.balance).toSatoshis() - data.tx.fees 
          total += fee

        if data.tx.outputs.length is 2
          $('#change').show()
          change = data.tx.outputs[1].value
          $('.dialog .change').html("#{(change.toBTC())} #{g.user.unit} (#{change.toFiat()} #{g.user.currency})")

        $('.dialog .amount').html("#{(amount.toBTC())} #{g.user.unit} (#{amount.toFiat()} #{g.user.currency})")
        $('.dialog .fee').html("#{(fee.toBTC())} #{g.user.unit} (#{fee.toFiat()} #{g.user.currency})")
        $('.dialog .total').html("#{(total.toBTC())} #{g.user.unit} (#{total.toFiat()} #{g.user.currency})")
        $('.dialog .address').html(data.tx.outputs[0].addresses[0])

        dialog.getModalBody().html($('.dialog').html())
        dialog.getModal().find('.btn-primary').click(-> 
          $.post("#{g.api}/txs/send?token=#{g.token}", JSON.stringify(data)).then((finaltx) ->
            $('#withdrawal .alert-success').fadeIn().delay(2000).fadeOut()
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
  (this / 100000000 * multiplier()).toFixed(precision())

Number.prototype.toFiat = ->
  (this * g.exchange / 100000000).toFixed(2)

Number.prototype.toSatoshis = ->
  parseInt(this * 100000000 / multiplier())
