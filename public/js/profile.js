;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function() {
  var g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.proceed = false;

  $(function() {
    var user;
    $('[data-toggle=popover]').popover();
    $('#title').focus();
    user = $('#username').val();
    $.getJSON("/" + user + ".json", function(data) {
      $('#email').val(data.email);
      return $('#profile').fadeIn();
    });
    $('#confirm').blur(function() {
      $('#confirm_error').remove();
      if ($('#password').val() !== $('#confirm').val()) {
        $('#password, #confirm').parent().addClass('has-error');
        return $('#confirm').parent().after('<div id="confirm_error" class="alert alert-danger">Passwords don\'t match</div>');
      } else {
        return $('#password, #confirm').parent().removeClass('has-error');
      }
    });
    return $('#profile').submit(function() {
      $('#profile .form-control').blur();
      if ($('#profile .has-error').length > 0) {
        $('#profile .has-error').effect('shake', 500);
        return false;
      }
    });
  });

}).call(this);


},{}]},{},[1])
;