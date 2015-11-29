;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function() {
  var fetchExchangeRate, g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    fetchExchangeRate('ask');
    fetchExchangeRate('bid');
    $('#username').blur(function() {
      return $.get("/" + ($(this).val()) + "/exists", {
        username: $(this).val()
      }, function(data) {
        if (data === "true") {
          $('#username').prev().css('color', 'red').html('Username (taken)');
          return g.preventSubmit = true;
        } else {
          $('#username').prev().css('color', 'black').html('Username');
          return g.preventSubmit = false;
        }
      });
    });
    return $('#signup').submit(function() {
      if (g.preventSubmit) {
        return false;
      }
      return true;
    });
  });

  fetchExchangeRate = function(type) {
    var commission;
    commission = 0.015;
    if (type === 'bid') {
      commission *= -1;
    }
    return $.ajax({
      url: "/ticker?symbol=virtexCAD&type=" + type + "&amount=100",
      success: function(exchange) {
        if (exchange == null) {
          exchange = '??';
        }
        exchange = exchange - exchange * commission;
        return $("#" + type).html(exchange.toFixed(2));
      },
      error: function() {
        return $("#" + type).html('??');
      }
    });
  };

}).call(this);


},{}]},{},[1])
;