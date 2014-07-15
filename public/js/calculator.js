(function() {
  var ADDRESS_FAIL, EXCHANGE_FAIL, SOCKET_FAIL, activateTip, clear, fail, fetchExchangeRate, finalize, g, get, setup, setupSocket, tip, updateTotal;

  EXCHANGE_FAIL = "Error fetching exchange rate";

  SOCKET_FAIL = "Error connecting to payment server";

  ADDRESS_FAIL = "Invalid address";

  tip = 1;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    g.user = $('#user').val();
    g.title = get('title');
    g.address = get('address');
    g.symbol = get('symbol');
    g.currency = get('currency');
    g.commission = parseFloat(get('commission'));
    g.logo = get('logo');
    g.errors = [];
    g.receivable = 0;
    if (g.user) {
      $.ajax({
        url: g.user + '.json',
        dataType: 'json',
        success: function(data) {
          if (data != null) {
            g.title = data.title;
            g.address = data.address;
            g.currency = data.currency;
            g.symbol = data.symbol;
            g.commission = data.commission;
            g.logo = data.logo;
          }
          return setup();
        }
      });
    } else {
      setup();
    }
    $('#tip button').click(function() {
      var value;
      value = $(this).html().slice(0, -1);
      $(this).siblings().css('font-weight', 'normal').removeClass('active');
      $(this).css('font-weight', 'bold');
      tip = 1 + (parseFloat(value) / 100);
      return updateTotal();
    });
    $('#tip button').first().click();
    $('#amount').keyup(updateTotal);
    return $('#amount').focus(function() {
      $('#received').hide();
      $('#payment').fadeIn('slow');
      $(this).val('');
      return updateTotal();
    });
  });

  activateTip = function(p) {};

  setup = function() {
    var address;
    g.address || (g.address = '');
    g.commission || (g.commission = 0);
    g.symbol || (g.symbol = 'quadrigacx');
    if (g.title) {
      $('#title').html(g.title).show();
    }
    if (g.logo) {
      $('#logo').attr('src', g.logo).show();
    } else if (!g.title) {
      $('#logo').attr('src', 'img/bitcoin.png').show();
    }
    $('#logo').click(function() {
      return $(location).attr("href", "/" + g.user + "/edit");
    });
    address = g.address;
    if ((g.user != null) && g.user) {
      address = "<a href='http://blockchain.info/address/" + address + "'>" + address + "</a>";
    }
    if (check_address(g.address)) {
      $('#address').html(address);
    } else {
      fail(ADDRESS_FAIL);
    }
    $('#symbol').html(g.symbol + " bid");
    $('#currency').html(g.currency);
    $('#received').hide();
    return fetchExchangeRate();
  };

  fetchExchangeRate = function() {
    $.ajax({
      url: "ticker?currency=" + g.currency + "&symbol=" + g.symbol + "&type=bid",
      success: function(exchange) {
        if (exchange != null) {
          clear(EXCHANGE_FAIL);
        } else {
          fail(EXCHANGE_FAIL);
          return;
        }
        if (!g.setupComplete) {
          finalize();
        }
        g.exchange = exchange - exchange * g.commission * 0.01;
        $('#exchange').val(g.exchange.toFixed(2));
        return updateTotal();
      },
      error: function() {
        return fail(EXCHANGE_FAIL);
      }
    });
    return setTimeout(fetchExchangeRate, 900000);
  };

  finalize = function() {
    $('#amount').focus();
    return g.setupComplete = true;
  };

  setupSocket = function() {
    setTimeout(setupSocket, 10000);
    if (!(g.websocket && g.websocket.readyState === 1)) {
      g.websocket = new WebSocket("wss://ws.blockchain.info/inv");
      g.websocket.onopen = function() {
        return g.websocket.send('{"op":"addr_sub", "addr":"' + g.address + '"}');
      };
      g.websocket.onerror = function() {
        g.websocket = null;
        return fail(SOCKET_FAIL);
      };
      g.websocket.onclose = function() {
        return setupSocket();
      };
      return g.websocket.onmessage = function(e) {
        var from_address, received, results;
        results = eval('(' + e.data + ')');
        from_address = '';
        received = 0;
        $.each(results.x.out, function(i, v) {
          if (v.addr === g.address) {
            return received += v.value / 100000000;
          }
        });
        $.each(results.x.inputs, function(i, v) {
          from_address = v.prev_out.addr;
          if (v.prev_out.addr === g.address) {
            return input -= v.prev_out.value / 100000000;
          }
        });
        if (g.receivable <= received) {
          $('#amount').blur();
          $('#payment').hide();
          $('#received').fadeIn('slow');
        }
        if (g.user) {
          return $.post("/" + g.user + "/transactions", {
            address: from_address,
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            received: received,
            exchange: g.exchange
          });
        }
      };
    }
  };

  updateTotal = function() {
    var amount, total;
    amount = parseFloat($('#amount').val() * tip);
    total = (amount * 1000 / g.exchange).toFixed(5);
    g.receivable = (amount / g.exchange).toFixed(8);
    if (!$.isNumeric(total)) {
      total = '';
    }
    $('#total').html(total.toString());
    $('#qr').html('');
    return new QRCode('qr', "bitcoin:" + g.address + "?amount=" + (g.receivable.toString()));
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
