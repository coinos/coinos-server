(function() {
  var g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.proceed = false;

  $(function() {
    $('#title').focus();
    return $.getJSON("/js/rates.json", function(data) {
      var currencies, user;
      currencies = Object.keys(data);
      currencies = currencies.sort();
      currencies.pop();
      $.each(currencies, function(i, v) {
        return $('#currency').append("<option value='" + v + "'>" + v + "</option>");
      });
      $("#currency option[value='CAD']").attr('selected', 'selected');
      user = $('#username').val();
      $('#currency').change(function() {
        var symbol, symbols;
        $('#symbol option').remove();
        symbol = $(this).val();
        if (!symbol) {
          return;
        }
        symbols = Object.keys(data[symbol]);
        $.each(symbols, function(i, v) {
          return $('#symbol').append("<option value='" + v + "'>" + v + " bid price</option>");
        });
        switch ($(this).val()) {
          case 'CAD':
            return $("#symbol option[value='quadrigacx']").attr('selected', 'selected');
          case 'USD':
            return $("#symbol option[value='bitstamp']").attr('selected', 'selected');
        }
      }).change();
      $('#address').change(function() {
        if (check_address($(this).val())) {
          return $(this).css('color', 'black');
        } else {
          return $(this).css('color', 'red');
        }
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
      $('#setup').submit(function() {
        if ($('.has-error').length()) {
          return false;
        }
      });
      if (user) {
        $('#setup').attr('action', "/" + user + "/update").attr('method', 'post');
        return $.getJSON("/" + user + ".json", function(data) {
          $('#title').val(data.title);
          $('#logo').val(data.logo);
          $('#address').val(data.address);
          $("#symbol option[value='" + data.symbol + "']").attr('selected', 'selected');
          return $('#commission').val(data.commission);
        });
      }
    });
  });

}).call(this);
