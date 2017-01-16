;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function() {
  var g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.proceed = false;

  $(function() {
    var units;
    $('#encryption-password').pwstrength({
      showVerdicts: false
    });
    $.getJSON("/js/rates.json", function(data) {
      var currencies, user;
      currencies = Object.keys(data);
      currencies = currencies.sort();
      currencies.pop();
      $.each(currencies, function(i, v) {
        return $('#currency').append("<option value='" + v + "'>" + v + "</option>");
      });
      $("#currency option[value='CAD']").attr('selected', 'selected');
      $('#currency').change(function() {
        var currency, symbols;
        currency = $(this).val();
        if (!currency) {
          return;
        }
        $('#symbol option').remove();
        symbols = Object.keys(data[currency]);
        $.each(symbols, function(i, v) {
          if (v === 'localbitcoins') {
            return;
          }
          return $('#symbol').append("<option value='" + v + "'>" + v + "</option>");
        });
        switch (currency) {
          case 'CAD':
            return $("#symbol option[value='quadrigacx']").attr('selected', 'selected');
          case 'USD':
            return $("#symbol option[value='bitstamp']").attr('selected', 'selected');
        }
      });
      user = $('#username').val();
      return $.getJSON("/" + user + ".json", function(data) {
        if (data.commission == null) {
          data.commission = 0;
        }
        if (data.unit == null) {
          data.unit = 'BTC';
        }
        $('#email').val(data.email);
        $('#title').val(data.title);
        $('#logo').val(data.logo);
        $('#address').val(data.address);
        $('#commission').val(data.commission);
        $('#unit').val(data.unit);
        $("#currency option[value='" + data.currency + "']").attr('selected', 'selected');
        $('#currency').change();
        $("#symbol option[value='" + data.symbol + "']").attr('selected', 'selected');
        $('#setup').fadeIn();
        return $('#title').focus();
      });
    });
    units = ['BTC', 'mBTC', '&micro;BTC', 'bits', 'satoshis'];
    $.each(units, function(i, v) {
      return $('#unit').append("<option value='" + v + "'>" + v + "</option>");
    });
    return $('#setup').submit(function() {
      $('#setup .form-control').blur();
      if ($('#setup .has-error').length > 0) {
        $('#setup .has-error').effect('shake', 500);
        return false;
      }
    });
  });

}).call(this);


},{}]},{},[1])
;