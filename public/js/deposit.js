(function() {
  var ADDRESS_FAIL, EXCHANGE_FAIL, SOCKET_FAIL, clear, fail, g, get, setupSocket;

  EXCHANGE_FAIL = "Error fetching exchange rate";

  SOCKET_FAIL = "Error connecting to payment server";

  ADDRESS_FAIL = "Invalid address";

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    g.address || (g.address = '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr');
    setupSocket();
    setupQR();
    return displayQR('bitcoin:' + g.address);
  });

  setupSocket = function() {
    g.address = "1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr";
    setTimeout(setupSocket, 10000);
    if (!(g.websocket && g.websocket.readyState === 1)) {
      g.websocket = new WebSocket("ws://api.blockchain.info:8335/inv");
      g.websocket.onopen = function() {
        return g.websocket.send('{"op":"addr_sub", "addr":"' + g.address + '"}');
      };
      g.websocket.onerror = g.websocket.onclose = function() {
        return fail(SOCKET_FAIL);
      };
      return g.websocket.onmessage = function(e) {
        var from_address, received, results, total;
        results = eval('(' + e.data + ')');
        from_address = '';
        total = 0;
        received = 0;
        $.each(results.x.out, function(i, v) {
          if (v.addr === g.address) {
            return received += v.value;
          }
        });
        $.each(results.x.inputs, function(i, v) {
          from_address = v.prev_out.addr;
          if (v.prev_out.addr === g.address) {
            return input -= v.prev_out.value;
          }
        });
        return $.get("/issue/" + received, function(data) {
          return $('#received').text(data);
        });
      };
    }
  };

  fail = function(msg) {
    g.errors.push(msg);
    g.errors = g.errors.uniq();
    $('#calculator').hide();
    return $('#error').show().html(g.errors.toString());
  };

  clear = function(msg) {
    var i;
    i = g.errors.indexOf(msg);
    if (i >= 0) {
      g.errors.splice(i, 1);
    }
    if (g.errors.length > 0) {
      return $('#error').show().html(g.errors.toString());
    } else {
      $('#error').hide();
      return $('#calculator').fadeIn('slow');
    }
  };

  get = function(name) {
    var regex, regexS, results;
    name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
    regexS = "[\\?&]" + name + "=([^&#]*)";
    regex = new RegExp(regexS);
    results = regex.exec(window.location.search);
    if (results === null) {
      return "";
    } else {
      return decodeURIComponent(results[1].replace(/\+/g, " "));
    }
  };

  Array.prototype.uniq = function() {
    var key, output, value, _i, _ref, _results;
    output = {};
    for (key = _i = 0, _ref = this.length; 0 <= _ref ? _i < _ref : _i > _ref; key = 0 <= _ref ? ++_i : --_i) {
      output[this[key]] = this[key];
    }
    _results = [];
    for (key in output) {
      value = output[key];
      _results.push(value);
    }
    return _results;
  };

}).call(this);
