;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0](function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function(){(function() {
  var check_address, convertedAmount, createWallet, displayErrors, g, getBalance, getExchangeRate, getToken, getUser, isBip32, multiplier, precision, sendTransaction,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.proceed = false;

  g.api = 'https://api.blockcypher.com/v1/bcy/test';

  $(function() {
    getToken();
    $('button[data-toggle=tooltip]').tooltip({
      trigger: 'hover'
    });
    $('#keys form input[type=button]').click(function() {
      $('.form-control').blur();
      if ($('#keys .has-error').length > 0) {
        $('#keys .has-error').effect('shake', 500);
        return;
      }
      $('#withdraw').click();
      $('#keys_updated').fadeIn();
      $.post("/" + g.user.username, $('#keys form').serializeObject(), function() {
        return $.ajax({
          url: "" + g.api + "/wallets/hd/" + g.user.username + "?token=" + g.token,
          type: 'DELETE'
        }).done(function() {
          return setTimeout(function() {
            var data;
            data = {
              name: g.user.username,
              extended_public_key: $('#pubkey').val(),
              subchain_indexes: [0, 1]
            };
            return $.post("" + g.api + "/wallets/hd?token=" + g.token, JSON.stringify(data)).always(function() {
              return $.post("" + g.api + "/wallets/hd/" + g.user.username + "/addresses/derive?token=" + g.token).always(function() {
                return getBalance();
              });
            });
          }, 300);
        });
      });
      return false;
    });
    $('#withdrawal form input[type=button]').click(function() {
      return sendTransaction();
    });
    $('#currency_toggle').click(function() {
      var amount;
      if ($(this).html() === g.user.unit) {
        $(this).html(g.user.currency);
        g.amount = parseFloat($('#amount').val()).toFixed(precision());
        amount = (g.amount * g.exchange / multiplier()).toFixed(2);
        $('#amount').val(amount);
        $('#amount').attr('step', 0.01);
        return $('#amount').attr('max', (g.balance * g.exchange / multiplier()).toFixed(2));
      } else {
        $(this).html(g.user.unit);
        $('#amount').val(convertedAmount());
        $('#amount').attr('step', 0.00000001 * multiplier());
        return $('#amount').attr('max', g.balance);
      }
    });
    $('#max').click(function() {
      var amount;
      if ($('#currency_toggle').html() === g.user.unit) {
        return $('#amount').val(g.balance);
      } else {
        g.amount = parseFloat(g.balance).toFixed(precision());
        amount = (g.balance / multiplier() * g.exchange).toFixed(2);
        return $('#amount').val(amount);
      }
    });
    $('#amount').change(function() {
      if ($('#currency_toggle').html() === g.user.unit) {
        $(this).val(parseFloat($(this).val()).toFixed(precision()));
      } else {
        $(this).val(parseFloat($(this).val()).toFixed(2));
      }
      if (parseFloat($(this).val()) > parseFloat($(this).attr('max'))) {
        return $(this).val($(this).attr('max'));
      }
    });
    $('#password').keyup(function() {
      g.master = null;
      try {
        g.master = bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt($('#privkey').val(), $(this).val()).toString(CryptoJS.enc.Utf8));
        $(this).parent().removeClass('has-error').addClass('has-success');
        return $('#invalid_keys').fadeOut();
      } catch (_error) {
        return $(this).parent().addClass('has-error').removeClass('has-success');
      }
    });
    $('#new_password').keyup(function() {
      $('#privkey').val(CryptoJS.AES.encrypt(g.privkey, $(this).val()));
      try {
        bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt(g.user.privkey, $(this).val()).toString(CryptoJS.enc.Utf8));
        return $(this).parent().removeClass('has-error').addClass('has-success');
      } catch (_error) {
        return $(this).parent().addClass('has-error').removeClass('has-success');
      }
    });
    $('#manage').click(function() {
      $('#keys, #withdrawal').toggle();
      $('#withdraw, #manage').toggle();
      return $('#privkey').val(g.user.privkey);
    });
    $('#withdraw').click(function() {
      $('#keys, #withdrawal').toggle();
      return $('#withdraw, #manage').toggle();
    });
    $('#backup').click(function() {
      var pom, url;
      url = 'data:application/json;base64,' + btoa(JSON.stringify(g.user.privkey));
      pom = document.createElement('a');
      pom.setAttribute('href', url);
      pom.setAttribute('download', 'coinos-wallet.aes.json');
      return pom.click();
    });
    $('#generate').click(function() {
      var key, mnemonic;
      mnemonic = bip39.generateMnemonic();
      key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0);
      g.privkey = key.toString();
      $('#pubkey').val(key.neutered().toString()).effect('highlight', {}, 2000);
      $('#privkey').val('');
      $('#new_password').parent().show();
      return $('#new_password').effect('shake', 500).focus();
    });
    return $('[data-hide]').on('click', function() {
      return $(this).closest('.alert').fadeOut();
    });
  });

  getToken = function() {
    return $.get("/token", function(token) {
      g.token = token;
      return getUser();
    });
  };

  getUser = function() {
    return $.getJSON("/" + ($('#username').val()) + ".json", function(user) {
      g.user = user;
      $('#pubkey').val(user.pubkey);
      $('#privkey').val(user.privkey);
      $('#address').val(user.address);
      $('#unit').html(user.unit);
      $('#currency_toggle').html(user.unit);
      $('#amount').attr('step', 0.00000001 * multiplier());
      return getExchangeRate();
    });
  };

  getExchangeRate = function() {
    return $.get("/ticker?currency=" + g.user.currency + "&symbol=" + g.user.symbol + "&type=bid", function(exchange) {
      g.exchange = exchange;
      return createWallet();
    });
  };

  createWallet = function() {
    return $.get("" + g.api + "/wallets?token=" + g.token, function(data) {
      var _ref;
      if (_ref = g.user.username, __indexOf.call(data.wallet_names, _ref) >= 0) {
        return getBalance();
      } else {
        if (isBip32(g.user.pubkey)) {
          data = {
            name: g.user.username,
            extended_public_key: g.user.pubkey,
            subchain_indexes: [0, 1]
          };
          return $.post("" + g.api + "/wallets/hd?token=" + g.token, JSON.stringify(data)).always(getBalance);
        } else {
          $('#balance').html(99);
          return $('#amount').val(99);
        }
      }
    });
  };

  getBalance = function() {
    return $.get("" + g.api + "/addrs/" + g.user.username + "/balance?token=" + g.token + "&omitWalletAddresses=true", function(data) {
      var balance, fiat;
      balance = data.final_balance;
      g.balance = balance.toBTC();
      fiat = balance.toFiat();
      $('#balance').html(g.balance);
      $('#fiat').html("" + fiat + " " + g.user.currency);
      $('#amount').attr('max', g.balance);
      $('#amount').val(g.balance);
      $('#recipient').val('CAdJXbDTotrZt4DjC7oj9npQUZgKKMF5e3');
      $('#amount').focus();
      return $('.wallet').fadeIn();
    });
  };

  sendTransaction = function() {
    var dialog, params;
    if (!g.master || typeof g.master.keyPair.d === 'undefined') {
      $('#invalid_keys').fadeIn();
      return $('#password').focus();
    } else {
      dialog = new BootstrapDialog({
        title: '<h3>Confirm Transaction</h3>',
        message: '<i class="fa fa-spinner fa-spin"></i> Calculating fee...</i>',
        buttons: [
          {
            label: 'Send',
            cssClass: 'btn-primary'
          }, {
            label: ' Cancel',
            cssClass: 'btn-default',
            action: function(dialogItself) {
              return dialogItself.close();
            },
            icon: 'glyphicon glyphicon-ban-circle'
          }
        ]
      }).open();
      params = {
        inputs: [
          {
            wallet_name: g.user.username,
            wallet_token: g.token
          }
        ],
        outputs: [
          {
            addresses: [$('#recipient').val()],
            value: 1
          }
        ],
        preference: $('#priority').val()
      };
      return $.post("" + g.api + "/txs/new?token=" + g.token, JSON.stringify(params)).done(function(data) {
        var amount, value;
        if ($('#currency_toggle').html() === g.user.unit) {
          amount = $('#amount').val();
        } else {
          amount = convertedAmount();
        }
        value = parseInt(amount * 100000000 / multiplier());
        params.fees = data.tx.fees;
        params.outputs[0].value = value;
        if (value > parseFloat(g.balance).toSatoshis() - params.fees) {
          params.outputs[0].value -= params.fees;
        }
        return $.post("" + g.api + "/txs/new?token=" + g.token, JSON.stringify(params)).done(function(data) {
          var fee, total;
          data.pubkeys = [];
          data.signatures = data.tosign.map(function(tosign, i) {
            var key, path;
            path = data.tx.inputs[i].hd_path.split('/');
            key = g.master.derive(path[1]).derive(path[2]);
            data.pubkeys.push(key.keyPair.getPublicKeyBuffer().toString('hex'));
            return key.keyPair.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex");
          });
          g.data = data;
          amount = data.tx.outputs[0].value;
          fee = data.tx.fees;
          total = amount;
          if (value > parseFloat(g.balance).toSatoshis() - data.tx.fees) {
            total += fee;
          }
          $('.dialog .amount').html("" + (amount.toBTC()) + " " + g.user.unit + " (" + (amount.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .fee').html("" + (fee.toBTC()) + " " + g.user.unit + " (" + (fee.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .total').html("" + (total.toBTC()) + " " + g.user.unit + " (" + (total.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .address').html(data.tx.outputs[0].addresses[0]);
          dialog.getModalBody().html($('.dialog').html());
          return dialog.getModal().find('.btn-primary').click(function() {
            return $.post("" + g.api + "/txs/send?token=" + g.token, JSON.stringify(g.data)).then(function(finaltx) {
              var balance, fiat;
              $('#transaction_sent').fadeIn();
              balance = g.balance.toSatoshis() - finaltx.tx.outputs[0].value - finaltx.tx.fees;
              g.balance = balance.toBTC();
              fiat = balance.toFiat();
              $('#balance').html(g.balance);
              $('#fiat').html("" + fiat + " " + g.user.currency);
              $('#blockchain').off('click').on('click', function() {
                return window.open('https://live.blockcypher.com/bcy/tx/' + finaltx.tx.hash, '_blank');
              });
              return dialog.close();
            });
          });
        }).fail(function(data) {
          return displayErrors(data.responseJSON, dialog);
        });
      }).fail(function(data) {
        return displayErrors(data.responseJSON, dialog);
      });
    }
  };

  displayErrors = function(data, dialog) {
    var e, _i, _len, _ref, _results;
    if (data.errors) {
      dialog.getModalBody().html('');
      dialog.getModal().find('.btn-primary').hide();
      _ref = data.errors;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        e = _ref[_i];
        _results.push(dialog.getModalBody().append("<div class='alert alert-danger'>" + e.error + "</div>"));
      }
      return _results;
    }
  };

  convertedAmount = function() {
    var amount, difference, tolerance;
    amount = parseFloat($('#amount').val() * multiplier() / g.exchange).toFixed(precision());
    difference = parseFloat(Math.abs(g.amount - amount).toFixed(precision()));
    tolerance = parseFloat((.00000002 * g.exchange * multiplier()).toFixed(precision()));
    if (difference > tolerance) {
      return amount;
    } else {
      return g.amount;
    }
  };

  check_address = function(address) {
    try {
      bitcoin.address.fromBase58Check(address);
      return true;
    } catch (_error) {
      return isBip32(address);
    }
  };

  isBip32 = function(address) {
    try {
      bitcoin.HDNode.fromBase58(address);
      return true;
    } catch (_error) {
      return false;
    }
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

  precision = function() {
    return 9 - multiplier().toString().length;
  };

  Number.prototype.toBTC = function() {
    return parseFloat((this / 100000000 * multiplier()).toFixed(precision()));
  };

  Number.prototype.toFiat = function() {
    return (this * g.exchange / 100000000).toFixed(2);
  };

  Number.prototype.toSatoshis = function() {
    return parseInt(this * 100000000 / multiplier());
  };

}).call(this);


})()
},{}]},{},[1])
;