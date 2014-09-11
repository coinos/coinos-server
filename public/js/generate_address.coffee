#= require js/jquery-1.8.2.min.js
#= require js/jquery-ui.min.js
#= require js/jquery.printElement.min.js
#= require js/bootstrap.min.js
#= require js/bitcoinjs-min-1.0.2.js
#= require js/qrcode.js
#= require js/bip38.js
#= require js/check_password.js

g = this

$(->
  genKey()
  $('.regenerate').click(genKey)

  $('#encrypt').submit(->
    $('.form-control').blur()
    if $('.has-error').length > 0
      $('.has-error').effect('shake', 500)
      return false

    $('#modal').modal()
    return false
  )

  $('#modal').on('shown.bs.modal', -> 
    bip38 = new Bip38
    g.enc_privkey = bip38.encrypt(g.privkey, $('#password').val(), g.pubkey)
    $('#modal-body').html('Done!')
    setTimeout(
      -> $('#modal').modal('hide')
      1000
    )
  )

  $('#modal').on('hidden.bs.modal', -> 
    if $('#password').val() == ''
      g.enc_privkey = g.privkey 
      $('#status').html('')
    else
      $('#status').html('Encrypted')

    $('#privkey').html(g.enc_privkey)
    $('#privqr').html('')
    new QRCode('privqr', text: $('#privkey').html(), width: 260, height: 260)
  )

  $('.print').click(-> window.print())
  $('#password').pwstrength(showVerdicts: false)
  $('#password').blur(->
    $('#confirm').blur()
    $(this).parent().next('.alert').remove()

    if $('.progress-bar-success').length > 0
      $(this).parent().removeClass('has-error')
    else
      $(this).parent().addClass('has-error')
  )
  $('#confirm').blur(->
    if $('#password').val() == $('#confirm').val()
      $('#confirm').parent().removeClass('has-error')
    else
      $('#confirm').parent().addClass('has-error')
  )
)

genKey = ->
  $('#password').focus()
  key = bitcoin.ECKey.makeRandom(false)
  g.privkey = key.toWIF()
  g.pubkey = key.pub.getAddress().toString()

  $('#pubkey').html(g.pubkey)
  $('#privkey').html(g.privkey)

  $('#pubqr, #privqr, #status').html('')
  $('#password, #confirm').val('').keyup().parent().removeClass('has-error')

  new QRCode('pubqr', text: $('#pubkey').html(), width: 260, height: 260)
  new QRCode('privqr', text: $('#privkey').html(), width: 260, height: 260)



