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
      $('#phone').val(data.phone);
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
