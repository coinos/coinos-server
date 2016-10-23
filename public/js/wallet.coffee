g = exports ? this
g.proceed = false
g.api = '/blockcypher/v1/btc/main'

validators = 
  address: (e) ->
    return true if e.val() is ''
    try 
      bitcoin.address.fromBase58Check(e.val())
    catch
      return false

  key: (e) ->
    $('#keytype').val() != 'unknown'

errors = 
  address: 'Invalid address.'
  key: 'Could not detect key type.'

$(->
  getUser()
  
  $('#types').attr('data-content', """
    Bitcoin Address (starts with 1 or 3)<br />
    Private Key (starts with 5 or L)<br />
    HD Wallet pubkey (starts with xpub)<br />
    HD Wallet private key (starts with xprv)<br />
    AES Encrypted Private Key (starts with U)<br />
    BIP38 Encrypted Private Key (starts with 6)<br />
    BIP39 Mnemonic (series of 12-24 english words)
  """)
  .popover(html: true)
  .on("show.bs.popover", -> $(this).data("bs.popover").tip().css(minWidth: "400px"))

  $('form').validator(custom: validators, errors: errors, delay: 1200)
  $('[data-toggle=tooltip]').tooltip(trigger: 'hover')

  $('#key').keyup(->
    val = $(this).val()

    $('#keytype').val('unknown')

    switch val[0]
      when '1' 
        try 
          bitcoin.address.fromBase58Check(val)
          $('#keytype').val('address')
      when '5', \
           'L', \
           'K'
        try
          bitcoin.ECPair.fromWIF(val)
          $('#keytype').val('wif')
      when 'U' 
        try
          if CryptoJS.AES.decrypt(val, g.password).toString(CryptoJS.enc.Utf8)
            $('#keytype').val('aes')
      when '6' 
        if bip38().verify(val)
          $('#keytype').val('bip38')
      when 'x'
        if $(this).val()[3] is 'b'
          try
            bitcoin.HDNode.fromBase58(val)
            $('#keytype').val('xpub')
        else
          try
            bitcoin.HDNode.fromBase58(val)
            $('#keytype').val('xprv')
      else
        if val.split(' ').length in [12, 15, 18, 21, 24] and bip39.validateMnemonic(val)
          $('#keytype').val('bip39')
  )

  $('#save').click(->
    $('.form-control').blur()
    if $('#keys .has-error').length > 0
      $('#keys .has-error').effect('shake', 500)
      return

    key = $('#key').val()
    proceed = true

    switch $('#keytype').val()
      when 'address'
        $('#pubkey').val(key)
        $('#privkey').val('')
      when 'wif'
        pubkey = bitcoin.ECPair.fromWIF(key).getAddress()
        privkey = CryptoJS.AES.encrypt(key, g.password)
        $('#pubkey').val(pubkey)
        $('#privkey').val(privkey)
      when 'aes'
        try
          pubkey = bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt(key, g.password).toString(CryptoJS.enc.Utf8)).neutered().toString()
          $('#pubkey').val(pubkey)
          $('#privkey').val(key)
        catch
          try
            pubkey = bitcoin.ECPair.fromWIF(CryptoJS.AES.decrypt(key, g.password).toString(CryptoJS.enc.Utf8)).getAddress()
            $('#pubkey').val(pubkey)
            $('#privkey').val(key)
          catch
            proceed = false
      when 'bip38'
        wif = bip38().decrypt(key, g.password)
        pubkey = bitcoin.ECPair.fromWIF(wif).getAddress()
        privkey = CryptoJS.AES.encrypt(wif, g.password)
        $('#pubkey').val(pubkey)
        $('#privkey, #key').val(privkey)
      when 'xpub'
        $('#pubkey').val(key)
        $('#privkey').val('')
      when 'xprv'
        pubkey = bitcoin.HDNode.fromBase58(key).neutered().toString()
        privkey = CryptoJS.AES.encrypt(key, g.password)
        $('#pubkey').val(pubkey)
        $('#privkey').val(privkey)
      when 'bip39'
        master = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(key)).deriveHardened(44).deriveHardened(0)
        pubkey = master.neutered().toString()
        privkey = CryptoJS.AES.encrypt(master.toString(), g.password)
        $('#pubkey').val(pubkey)
        $('#privkey').val(privkey)

    if proceed
      updateUser() 
      $('#keys').hide()
      $('#keys_updated').fadeIn()
      $('#balances').hide()
      $('#fetching').show()
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
      $('#amount').val(g.balance).blur()
    else
      g.amount = parseFloat(g.balance).toFixed(precision())
      amount = (g.balance / multiplier() * g.exchange).toFixed(2)
      $('#amount').val(amount).blur()
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
      if g.user.privkey
        g.privkey = CryptoJS.AES.decrypt(g.user.privkey, $(this).val()).toString(CryptoJS.enc.Utf8)
      
        if g.privkey[0] is 'x'
          g.key = bitcoin.HDNode.fromBase58(g.privkey)
        else
          g.key = bitcoin.ECPair.fromWIF(g.privkey)

        $('#key').val(g.privkey).keyup()
      else
        $('#key').val(g.user.pubkey).keyup()

      $(this).closest('.form-group').hide()
      $('.wallet').fadeIn()
      g.password = $(this).val()
  )
    
  $('#manage').click(->
    $('#withdrawal').hide()
    $('#keys').show()
    $('#privkey').val(g.user.privkey)
  )

  $('#withdraw').click(->
    $('#withdrawal').show()
    $('#amount').focus()
    $('#keys').hide()
    $('#withdrawal form').validator('destroy')
    $('#withdrawal form').validator(custom: validators, errors: errors, delay: 1200)
  )

  $('#cancel').click(->
    $('#keys').hide()
    if g.balance > 0 and g.user.privkey
      $('#withdrawal form').validator('destroy')
      $('#withdrawal form').validator(custom: validators, errors: errors, delay: 1200)
      $('#withdrawal').show()
      $('#amount').focus()
  )

  $('#backup').click(->
    url = 'data:application/json;base64,' + btoa(JSON.stringify(g.user.privkey))
    a = document.createElement('a')
    a.setAttribute('href', url)
    a.setAttribute('download', 'wallet.json.aes')
    a.click()
  )

  $('#generate').click(->
    bootbox.confirm('<h3>Are you sure?</h3> <p>This will overwrite your existing wallet so make sure that you have the backup we sent to your email in case you want to restore it.</p>', (result) ->
      if result
        mnemonic = bip39.generateMnemonic()
        key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0)
        $('#key').val(key.toString()).effect('highlight', {}, 2000).keyup()
    )
  )

  $('.close').on('click', -> $(this).closest('.alert').fadeOut())
)

getUser = ->
  $.getJSON("/#{$('#username').val()}.json", (user) ->
    g.user = user
    $('#key').val(user.pubkey)
    $('#pubkey').val(user.pubkey)
    $('#privkey').val(user.privkey)
    $('#address').val(user.address)
    $('#unit').html(user.unit)
    $('#currency_toggle').html(user.unit)
    $('#amount').attr('step', 0.00000001 * multiplier())
    $('#password').closest('.form-group').show()
    $('#password').focus()

    getExchangeRate()
    $('#password').keyup()
  )

getExchangeRate = ->
  $.get("/ticker?currency=#{g.user.currency}&symbol=#{g.user.symbol}&type=bid", (exchange) -> 
    g.exchange = exchange
    createWallet()
  )

createWallet = ->
  $.get("#{g.api}/wallets", (data) ->
    if g.user.username in data.wallet_names
      getBalance()
    else
      params = name: g.user.username

      if isBip32(g.user.pubkey)
        params.extended_public_key = g.user.pubkey
        params.subchain_indexes = [0,1]

        $.post("#{g.api}/wallets/hd", JSON.stringify(params)).done(getBalance).fail(-> $('.wallet').fadeIn())
      else
        params.addresses = [g.user.pubkey]
        $.post("#{g.api}/wallets", JSON.stringify(params)).done(getBalance).fail(-> $('.wallet').fadeIn())
  )


getBalance = ->
  $.get("#{g.api}/addrs/#{g.user.username}/balance?omitWalletAddresses=true", (data) ->
    balance = data.final_balance
    g.balance = parseFloat(balance.toBTC())
    fiat = balance.toFiat()
    $('#balance').html(g.balance)
    $('#fiat').html("#{fiat} #{g.user.currency}")
    $('#amount').attr('max', g.balance)
    $('#balances').show()
    $('#fetching').hide()

    if g.balance > 0 and g.user.privkey
      $('#keys').hide()
      $('#withdrawal form').validator('destroy')
      $('#withdrawal form').validator(custom: validators, errors: errors, delay: 1200)
      $('#withdrawal').show()
      $('#amount').focus()
  )

updateUser = ->
  data = $('#keys form').serializeObject()
  delete data['key']

  $.post("/#{g.user.username}", data, ->
    $.ajax(
      url: "#{g.api}/wallets/#{g.user.username}"
      type: 'DELETE'
    ).always(->
      $.ajax(
        url: "#{g.api}/wallets/hd/#{g.user.username}"
        type: 'DELETE'
      ).always(->
        getUser()
      )
    )
  )

sendTransaction = ->
  if g.key and not (typeof g.key.d is 'undefined' and typeof g.key.keyPair.d is 'undefined')
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

    $.post("#{g.api}/txs/new", JSON.stringify(params)).done((data) ->
      if $('#currency_toggle').html() is g.user.unit
        amount = $('#amount').val()
      else
        amount = convertedAmount()

      value = parseInt(amount * 100000000 / multiplier())

      params.fees = data.tx.fees
      params.outputs[0].value = value
      if value > parseFloat(g.balance).toSatoshis() - params.fees 
        params.outputs[0].value -= params.fees

      $.post("#{g.api}/txs/new", JSON.stringify(params)).done((data) ->
        data.pubkeys = []
        if g.key instanceof bitcoin.ECPair
          data.signatures = data.tosign.map((tosign, i) ->
            data.pubkeys.push(g.key.getPublicKeyBuffer().toString('hex'))
            g.key.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex")
          )
        else
          data.signatures = data.tosign.map((tosign, i) ->
            path = data.tx.inputs[i].hd_path.split('/')
            key = g.key.derive(parseInt(path[1])).derive(parseInt(path[2]))
            data.pubkeys.push(key.keyPair.getPublicKeyBuffer().toString('hex'))
            key.keyPair.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex")
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

        if amount.toBTC() < 0.00000534
          displayErrors({errors: [error: 'Amount left over after fee is too small to send']}, dialog)

        dialog.getModal().find('.btn-primary').click(-> 
          $.post("#{g.api}/txs/send", JSON.stringify(g.data)).then((finaltx) ->
            $('#transaction_sent').fadeIn()
            balance = g.balance.toSatoshis() - finaltx.tx.outputs[0].value - finaltx.tx.fees
            g.balance = balance.toBTC()
            fiat = balance.toFiat()
            $('#balance').html(g.balance)
            $('#fiat').html("#{fiat} #{g.user.currency}")
            $('#blockchain').off('click').on('click', -> window.open('https://blockchain.info/tx/' + finaltx.tx.hash, '_blank'))
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
  g.amount = amount unless g.amount and !isNaN(parseFloat(g.amount))
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
  parseFloat((this / 100000000 * multiplier())).toFixed(precision())

Number.prototype.toFiat = ->
  parseFloat((this * g.exchange / 100000000)).toFixed(2)

Number.prototype.toSatoshis = ->
  parseInt(this * 100000000 / multiplier())


