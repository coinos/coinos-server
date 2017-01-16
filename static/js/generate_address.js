;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function() {
  var g, genKey;

  g = this;

  $(function() {
    genKey();
    $('.regenerate').click(genKey);
    $('#encrypt').submit(function() {
      $('.form-control').blur();
      if ($('.has-error').length > 0) {
        $('.has-error').effect('shake', 500);
        return false;
      }
      $('#modal').modal();
      return false;
    });
    $('#modal').on('shown.bs.modal', function() {
      var bip38;
      bip38 = new Bip38;
      g.enc_privkey = bip38.encrypt(g.privkey, $('#password').val(), g.pubkey);
      $('#modal-body').html('Done!');
      return setTimeout(function() {
        return $('#modal').modal('hide');
      }, 1000);
    });
    $('#modal').on('hidden.bs.modal', function() {
      if ($('#password').val() === '') {
        g.enc_privkey = g.privkey;
        $('#status').html('');
      } else {
        $('#status').html('Encrypted');
      }
      $('#privkey').html(g.enc_privkey);
      $('#privqr').html('');
      return new QRCode('privqr', {
        text: $('#privkey').html(),
        width: 260,
        height: 260
      });
    });
    $('.print').click(function() {
      return window.print();
    });
    $('#password').pwstrength({
      showVerdicts: false
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
    return $('#confirm').blur(function() {
      if ($('#password').val() === $('#confirm').val()) {
        return $('#confirm').parent().removeClass('has-error');
      } else {
        return $('#confirm').parent().addClass('has-error');
      }
    });
  });

  genKey = function() {
    var key;
    $('#password').focus();
    key = bitcoin.ECKey.makeRandom(false);
    g.privkey = key.toWIF();
    g.pubkey = key.pub.getAddress().toString();
    $('#pubkey').html(g.pubkey);
    $('#privkey').html(g.privkey);
    $('#pubqr, #privqr, #status').html('');
    $('#password, #confirm').val('').keyup().parent().removeClass('has-error');
    new QRCode('pubqr', {
      text: $('#pubkey').html(),
      width: 260,
      height: 260
    });
    return new QRCode('privqr', {
      text: $('#privkey').html(),
      width: 260,
      height: 260
    });
  };

}).call(this);


},{}]},{},[1])
;