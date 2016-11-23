(function() {
  var ADDRESS_FAIL, API_URL, EXCHANGE_FAIL, SOCKET_FAIL, TEST_URL, clear, fail, fetchExchangeRate, g, getAddress, listen, logTransaction, multiplier, setup, updateTotal;

  EXCHANGE_FAIL = "Problem fetching exchange rate";

  SOCKET_FAIL = "Problem connecting to payment server, notifications may not appear";

  ADDRESS_FAIL = "Invalid address";

  API_URL = "wss://socket.blockcypher.com/v1/btc/main";

  TEST_URL = "wss://socket.blockcypher.com/v1/btc/test3";

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.errors = [];

  g.amount_requested = 0;

  g.amount = 0..toFixed(2);

  g.tip = 1;

  g.transactions = [];

  $(function() {
    $.ajax({
      url: $('#user').val() + '.json',
      dataType: 'json',
      success: function(data) {
        g.user = data;
        return setup();
      }
    });
    $('button').click(function(e) {
      return e.preventDefault();
    });
    $('.numpad .btn').off('click').click(function(e) {
      var m, n;
      e.preventDefault();
      m = $(this).html();
      n = parseFloat($('.amount').html());
      if (m === 'C') {
        g.amount = 0..toFixed(2);
        updateTotal();
        return;
      }
      if (n > 10000000) {
        return;
      }
      if (m === '00') {
        n = 100 * n;
      } else {
        n = 10 * n + parseFloat(m) / 100;
      }
      g.amount = n.toFixed(2);
      return updateTotal();
    });
    $('.numpad .btn:last').off('click').click(function(e) {
      e.preventDefault();
      g.amount = (Math.floor(100 * (parseFloat($('.amount').html()) / 10)) / 100).toFixed(2);
      return updateTotal();
    });
    $('.tippad .btn').off('click').click(function(e) {
      var text, value;
      e.preventDefault();
      text = $(this).html();
      if (text === 'No Tip') {
        value = 0;
      } else {
        value = text.slice(1, -1);
      }
      $(this).addClass('active');
      $(this).siblings().removeClass('active');
      g.tip = 1 + (parseFloat(value) / 100);
      return updateTotal();
    });
    $('#received').click(function() {
      return window.location = "/" + g.user.username + "/report";
    });
    return $('#slide').click(function() {
      $('#controls').slideToggle();
      return $(this).find('i').toggleClass('fa-sort-up').toggleClass('fa-sort-down');
    });
  });

  setup = function() {
    var base, base1, base2, base3, base4, ext, src;
    (base = g.user).address || (base.address = '');
    (base1 = g.user).commission || (base1.commission = 0);
    (base2 = g.user).currency || (base2.currency = 'CAD');
    (base3 = g.user).symbol || (base3.symbol = 'quadrigacx');
    (base4 = g.user).unit || (base4.unit = 'BTC');
    if (g.user.title) {
      $('#title').html("<a href='/" + g.user.username + "/edit'>" + g.user.title + "</a>").show();
    }
    if (g.user.logo) {
      ext = g.user.logo.substr(g.user.logo.length - 3);
      src = "/img/logos/" + g.user.username + "." + ext;
      $('#logo').attr('src', src).show();
    }
    getAddress();
    if (g.user.address[0] === 'm') {
      API_URL = TEST_URL;
    }
    $('.symbol').html(g.user.currency);
    $('.currency').html(g.user.currency);
    $('.unit').html(g.user.unit);
    $('#received').hide();
    fetchExchangeRate();
    return listen();
  };

  fetchExchangeRate = function() {
    $.ajax({
      url: "ticker?currency=" + g.user.currency + "&symbol=" + g.user.symbol + "&type=bid",
      success: function(exchange) {
        if (exchange != null) {
          clear(EXCHANGE_FAIL);
        } else {
          fail(EXCHANGE_FAIL);
          return;
        }
        g.exchange = (exchange - exchange * g.user.commission * 0.01).toFixed(2);
        $('#exchange').html(g.exchange);
        updateTotal();
        if (!g.setupComplete) {
          return g.setupComplete = true;
        }
      },
      error: function() {
        return fail(EXCHANGE_FAIL);
      }
    });
    return setTimeout(fetchExchangeRate, 900000);
  };

  updateTotal = function() {
    var precision, size, subtotal, time, total;
    precision = 9 - multiplier().toString().length;
    subtotal = parseFloat(g.amount * g.tip).toFixed(2);
    total = (subtotal * multiplier() / g.exchange).toFixed(precision);
    g.amount_requested = (subtotal / g.exchange).toFixed(8);
    if (!$.isNumeric(total)) {
      total = '';
    }
    $('#received').hide();
    $('#payment').fadeIn('slow');
    $('.tip').html((subtotal - g.amount).toFixed(2));
    $('.subtotal').html(subtotal.toString());
    $('.amount').html(g.amount);
    $('.exchange').html(g.exchange);
    $('.symbol').html(g.user.symbol);
    if (g.user.commission < 0) {
      $('.commission').html("+" + (Math.abs(g.user.commission)) + "%");
    }
    $('#total').html(total.toString());
    size = 300;
    $('#qr').css('height', size);
    time = 0;
    if (g.timeout) {
      time = 10;
    }
    clearTimeout(g.timeout);
    return g.timeout = setTimeout(function() {
      $('#qr').html('');
      return new QRCode('qr', {
        text: "bitcoin:" + g.user.address + "?amount=" + (g.amount_requested.toString()),
        width: size,
        height: size
      });
    }, time);
  };

  listen = function() {
    g.attempts++;
    if (g.blockchain && g.blockchain.readyState === 1) {
      return setTimeout(listen, 12000);
    } else {
      if (g.attempts > 3) {
        fail(SOCKET_FAIL);
      }
      g.blockchain = new WebSocket(API_URL);
      g.blockchain.onopen = function() {
        if (g.blockchain.readyState === 1) {
          g.attempts = 0;
          clear(SOCKET_FAIL);
          return g.blockchain.send('{"event":"unconfirmed-tx", "address":"' + g.user.address + '"}');
        } else {
          return setTimeout(g.blockchain.onopen, 12000 * g.attempts);
        }
      };
      g.blockchain.onerror = function() {
        fail(SOCKET_FAIL);
        g.blockchain.close();
        delete g.blockchain;
        return listen();
      };
      g.blockchain.onclose = function() {
        delete g.blockchain;
        return listen();
      };
      return g.blockchain.onmessage = function(e) {
        var amount, j, len, output, ref, tx;
        tx = JSON.parse(e.data);
        amount = 0;
        if (tx.hash === g.last_seen) {
          return;
        }
        g.last_seen = tx.hash;
        ref = tx.outputs;
        for (j = 0, len = ref.length; j < len; j++) {
          output = ref[j];
          if (output.addresses[0] === g.user.address) {
            amount += output.value / 100000000;
          }
        }
        return logTransaction(tx.hash, amount);
      };
    }
  };

  logTransaction = function(txid, amount) {
    if ($('#received').is(":hidden") && amount >= g.amount_requested) {
      $('#payment').hide();
      $('#received').fadeIn('slow');
      $('#success')[0].play();
      g.user.index++;
      if (g.transactions.indexOf(txid) === -1) {
        g.transactions.push(txid);
        $.post("/" + g.user.username + "/transactions", {
          txid: txid,
          address: g.user.address,
          date: moment().format("YYYY-MM-DD HH:mm:ss"),
          received: amount,
          exchange: g.exchange,
          tip: g.tip
        });
      }
      return getAddress();
    }
  };

  getAddress = function() {
    var child, error, master;
    try {
      bitcoin.address.fromBase58Check(g.user.pubkey);
      g.user.address = g.user.pubkey;
    } catch (error) {
      master = bitcoin.HDNode.fromBase58(g.user.pubkey);
      child = master.derive(0).derive(g.user.index);
      g.user.address = child.getAddress().toString();
      if (g.blockchain) {
        g.blockchain.close();
      }
      listen();
    }
    return $('#address').html("<a href='https://blockchain.info/address/" + g.user.address + "'>" + g.user.address + "</a>");
  };

  fail = function(msg) {
    g.errors.push(msg);
    g.errors = g.errors.uniq();
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

  Array.prototype.uniq = function() {
    var j, key, output, ref, results, value;
    output = {};
    for (key = j = 0, ref = this.length; 0 <= ref ? j < ref : j > ref; key = 0 <= ref ? ++j : --j) {
      output[this[key]] = this[key];
    }
    results = [];
    for (key in output) {
      value = output[key];
      results.push(value);
    }
    return results;
  };

  multiplier = function() {
    switch (g.user.unit) {
      case 'BTC':
        return 1;
      case 'mBTC':
        return 1000;
      case 'µBTC':
        return 1000000;
      case 'bits':
        return 1000000;
      case 'satoshis':
        return 100000000;
    }
  };

}).call(this);
