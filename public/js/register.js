;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function() {
  var g;

  g = this;

  $(function() {
    var key, mnemonic, privkey;
    $('#username').focus();
    $('#password').pwstrength({
      showVerdicts: false
    });
    mnemonic = bip39.generateMnemonic();
    key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0);
    $('#pubkey').val(key.neutered().toString());
    privkey = key.toString();
    $('#password').keyup(function(e) {
      var enc_privkey;
      if (e.keyCode === 9 || e.keyCode === 16) {
        return;
      }
      enc_privkey = CryptoJS.AES.encrypt(privkey, $(this).val()).toString();
      if ($(this).val() === '') {
        enc_privkey = privkey;
      }
      return $('#privkey').val(enc_privkey);
    });
    $('#username').blur(function() {
      $(this).parent().next('.alert').remove();
      if (/^[a-z]+$/.test($(this).val()) && $(this).val().length > 2) {
        return $(this).parent().removeClass('has-error');
      } else {
        $(this).parent().addClass('has-error');
        return $(this).parent().after('<div class="alert alert-danger">Username must be lowecase and have at least 3 characters</div>');
      }
    });
    $('#password').blur(function() {
      $('#confirm').blur();
      $(this).parent().next('.alert').remove();
      if ($('.progress-bar-success').length > 0) {
        return $(this).parent().removeClass('has-error');
      } else {
        return $(this).parent().addClass('has-error');
      }
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
      $('.form-control').blur();
      if ($('.has-error').length > 0) {
        $('.has-error').effect('shake', 500);
        return false;
      }
    });
  });

}).call(this);


},{}]},{},[1])
;