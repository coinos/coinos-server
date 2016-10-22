(function() {
  var g;

  g = this;

  $(function() {
    $('#username').focus();
    $('#username').blur(function() {
      $(this).parent().next('.alert').remove();
      if (/^[a-z]+$/.test($(this).val())) {
        return $(this).parent().removeClass('has-error');
      } else {
        $(this).parent().addClass('has-error');
        return $(this).parent().after('<div class="alert alert-danger">Username must be all lowercase</div>');
      }
    });
    $('#password').blur(function() {
      $('#confirm').blur();
      return $(this).parent().next('.alert').remove();
    });
    $('#confirm').blur(function() {
      if ($(this).val() === '') {
        return;
      }
      $(this).parent().next('.alert').remove();
      if ($('#password').val() === $('#confirm').val()) {
        return $('#confirm').parent().removeClass('has-error');
      } else {
        $('#confirm').parent().addClass('has-error');
        return $('#confirm').parent().after('<div class="alert alert-danger">Passwords don\'t match</div>');
      }
    });
    $('#email').blur(function() {
      if ($(this).val() === '') {
        return;
      }
      $(this).parent().next('.alert').remove();
      if (validateEmail($(this).val())) {
        return $(this).parent().removeClass('has-error');
      } else {
        $(this).parent().addClass('has-error');
        return $(this).parent().after('<div class="alert alert-danger">Invalid email</div>');
      }
    });
    return $('#register').submit(function() {
      var key, mnemonic;
      $('.form-control').blur();
      if ($('.has-error').length > 0) {
        $('.has-error').effect('shake', 500);
        return false;
      } else {
        mnemonic = bip39.generateMnemonic();
        key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0);
        $('#pubkey').val(key.neutered().toString());
        return $('#privkey').val(CryptoJS.AES.encrypt(key.toString(), $('#password').val()).toString());
      }
    });
  });

}).call(this);
