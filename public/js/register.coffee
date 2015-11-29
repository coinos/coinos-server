g = this

$(->
  $('#username').focus()
  $('#password').pwstrength(showVerdicts: false)

  key = new Key()
  $('#pubkey').val(key.extended_public_key_string())
  privkey = key.extended_private_key_string()

  $('#password').keyup((e) ->
    return if e.keyCode is 9 or e.keyCode is 16
    enc_privkey = CryptoJS.AES.encrypt(privkey, $(this).val()).toString()
    enc_privkey = privkey if $(this).val() == ''
    $('#privkey').val(enc_privkey)
  )

  $('#username').blur(->
    $(this).parent().next('.alert').remove()

    if /^[a-z]+$/.test($(this).val()) and $(this).val().length > 2
      $(this).parent().removeClass('has-error')
    else
      $(this).parent().addClass('has-error')
      $(this).parent().after('<div class="alert alert-danger">Username must be lowecase and have at least 3 characters</div>')
  )

  $('#password').blur(->
    $('#confirm').blur()
    $(this).parent().next('.alert').remove()

    if $('.progress-bar-success').length > 0
      $(this).parent().removeClass('has-error')
    else
      $(this).parent().addClass('has-error')
  )

  $('#confirm').blur(->
    return if $(this).val() == ''
    $(this).parent().next('.alert').remove()

    if $('#password').val() == $('#confirm').val()
      $('#confirm').parent().removeClass('has-error')
    else
      $('#confirm').parent().addClass('has-error')
      $('#confirm').parent().after('<div class="alert alert-danger">Passwords don\'t match</div>')
  )

  $('#email').blur(->
    return if $(this).val() == ''
    $(this).parent().next('.alert').remove()
    if validateEmail($(this).val())
      $(this).parent().removeClass('has-error')
    else
      $(this).parent().addClass('has-error')
      $(this).parent().after('<div class="alert alert-danger">Invalid email</div>')
  )

  $('#register').submit(->
    $('.form-control').blur()
    if $('.has-error').length > 0
      $('.has-error').effect('shake', 500)
      return false
  )
)
