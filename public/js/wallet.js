(function() {
  var check_address, convertedAmount, createWallet, displayErrors, errors, g, getBalance, getExchangeRate, getUser, isBip32, multiplier, precision, sendTransaction, updateUser, validators,
    indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  g.proceed = false;

  g.api = '/blockcypher/v1/btc/main';

  validators = {
    address: function(e) {
      var error;
      if (e.val() === '') {
        return true;
      }
      try {
        return bitcoin.address.fromBase58Check(e.val());
      } catch (error) {
        return false;
      }
    },
    key: function(e) {
      return $('#keytype').val() !== 'unknown';
    }
  };

  errors = {
    address: 'Invalid address.',
    key: 'Could not detect key type.'
  };

  $(function() {
    getUser();
    $('#types').attr('data-content', "Bitcoin Address (starts with 1 or 3)<br />\nPrivate Key (starts with 5 or L)<br />\nHD Wallet pubkey (starts with xpub)<br />\nHD Wallet private key (starts with xprv)<br />\nAES Encrypted Private Key (starts with U)<br />\nBIP38 Encrypted Private Key (starts with 6)<br />\nBIP39 Mnemonic (series of 12-24 english words)").popover({
      html: true
    }).on("show.bs.popover", function() {
      return $(this).data("bs.popover").tip().css({
        minWidth: "400px"
      });
    });
    $('form').validator({
      custom: validators,
      errors: errors,
      delay: 1200
    });
    $('[data-toggle=tooltip]').tooltip({
      trigger: 'hover'
    });
    $('#key').keyup(function() {
      var ref, val;
      val = $(this).val();
      $('#keytype').val('unknown');
      switch (val[0]) {
        case '1':
          try {
            bitcoin.address.fromBase58Check(val);
            return $('#keytype').val('address');
          } catch (undefined) {}
          break;
        case '5':
        case 'L':
        case 'K':
          try {
            bitcoin.ECPair.fromWIF(val);
            return $('#keytype').val('wif');
          } catch (undefined) {}
          break;
        case 'U':
          try {
            if (CryptoJS.AES.decrypt(val, g.password).toString(CryptoJS.enc.Utf8)) {
              return $('#keytype').val('aes');
            }
          } catch (undefined) {}
          break;
        case '6':
          if (bip38().verify(val)) {
            return $('#keytype').val('bip38');
          }
          break;
        case 'x':
          if ($(this).val()[3] === 'b') {
            try {
              bitcoin.HDNode.fromBase58(val);
              return $('#keytype').val('xpub');
            } catch (undefined) {}
          } else {
            try {
              bitcoin.HDNode.fromBase58(val);
              return $('#keytype').val('xprv');
            } catch (undefined) {}
          }
          break;
        default:
          if (((ref = val.split(' ').length) === 12 || ref === 15 || ref === 18 || ref === 21 || ref === 24) && bip39.validateMnemonic(val)) {
            return $('#keytype').val('bip39');
          }
      }
    });
    $('#save').click(function() {
      var error, error1, key, master, privkey, proceed, pubkey, wif;
      $('.form-control').blur();
      if ($('#keys .has-error').length > 0) {
        $('#keys .has-error').effect('shake', 500);
        return;
      }
      key = $('#key').val();
      proceed = true;
      switch ($('#keytype').val()) {
        case 'address':
          $('#pubkey').val(key);
          $('#privkey').val('');
          break;
        case 'wif':
          pubkey = bitcoin.ECPair.fromWIF(key).getAddress();
          privkey = CryptoJS.AES.encrypt(key, g.password);
          $('#pubkey').val(pubkey);
          $('#privkey').val(privkey);
          break;
        case 'aes':
          try {
            pubkey = bitcoin.HDNode.fromBase58(CryptoJS.AES.decrypt(key, g.password).toString(CryptoJS.enc.Utf8)).neutered().toString();
            $('#pubkey').val(pubkey);
            $('#privkey').val(key);
          } catch (error) {
            try {
              pubkey = bitcoin.ECPair.fromWIF(CryptoJS.AES.decrypt(key, g.password).toString(CryptoJS.enc.Utf8)).getAddress();
              $('#pubkey').val(pubkey);
              $('#privkey').val(key);
            } catch (error1) {
              proceed = false;
            }
          }
          break;
        case 'bip38':
          wif = bip38().decrypt(key, g.password);
          pubkey = bitcoin.ECPair.fromWIF(wif).getAddress();
          privkey = CryptoJS.AES.encrypt(wif, g.password);
          $('#pubkey').val(pubkey);
          $('#privkey, #key').val(privkey);
          break;
        case 'xpub':
          $('#pubkey').val(key);
          $('#privkey').val('');
          break;
        case 'xprv':
          pubkey = bitcoin.HDNode.fromBase58(key).neutered().toString();
          privkey = CryptoJS.AES.encrypt(key, g.password);
          $('#pubkey').val(pubkey);
          $('#privkey').val(privkey);
          break;
        case 'bip39':
          master = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(key)).deriveHardened(44).deriveHardened(0);
          pubkey = master.neutered().toString();
          privkey = CryptoJS.AES.encrypt(master.toString(), g.password);
          $('#pubkey').val(pubkey);
          $('#privkey').val(privkey);
      }
      if (proceed) {
        updateUser();
        $('#keys').hide();
        $('#keys_updated').fadeIn();
        $('#balances').hide();
        return $('#fetching').show();
      }
    });
    $('#withdrawal form input[type=button]').click(sendTransaction);
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
        return $('#amount').val(g.balance).blur();
      } else {
        g.amount = parseFloat(g.balance).toFixed(precision());
        amount = (g.balance / multiplier() * g.exchange).toFixed(2);
        return $('#amount').val(amount).blur();
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
      try {
        if (g.user.privkey) {
          g.privkey = CryptoJS.AES.decrypt(g.user.privkey, $(this).val()).toString(CryptoJS.enc.Utf8);
          if (g.privkey[0] === 'x') {
            g.key = bitcoin.HDNode.fromBase58(g.privkey);
          } else {
            g.key = bitcoin.ECPair.fromWIF(g.privkey);
          }
          $('#key').val(g.privkey).keyup();
        } else {
          $('#key').val(g.user.pubkey).keyup();
        }
        $(this).closest('.form-group').hide();
        $('.wallet').fadeIn();
        return g.password = $(this).val();
      } catch (undefined) {}
    });
    $('#manage').click(function() {
      $('#withdrawal').hide();
      $('#keys').show();
      return $('#privkey').val(g.user.privkey);
    });
    $('#withdraw').click(function() {
      $('#withdrawal').show();
      $('#amount').focus();
      $('#keys').hide();
      $('#withdrawal form').validator('destroy');
      return $('#withdrawal form').validator({
        custom: validators,
        errors: errors,
        delay: 1200
      });
    });
    $('#cancel').click(function() {
      $('#keys').hide();
      if (g.balance > 0 && g.user.privkey) {
        $('#withdrawal form').validator('destroy');
        $('#withdrawal form').validator({
          custom: validators,
          errors: errors,
          delay: 1200
        });
        $('#withdrawal').show();
        return $('#amount').focus();
      }
    });
    $('#backup').click(function() {
      var a, url;
      url = 'data:application/json;base64,' + btoa(JSON.stringify(g.user.privkey));
      a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', 'wallet.json.aes');
      return a.click();
    });
    $('#generate').click(function() {
      return bootbox.confirm('<h3>Are you sure?</h3> <p>This will overwrite your existing wallet so make sure that you have the backup we sent to your email in case you want to restore it.</p>', function(result) {
        var key, mnemonic;
        if (result) {
          mnemonic = bip39.generateMnemonic();
          key = bitcoin.HDNode.fromSeedBuffer(bip39.mnemonicToSeed(mnemonic)).deriveHardened(44).deriveHardened(0);
          return $('#key').val(key.toString()).effect('highlight', {}, 2000).keyup();
        }
      });
    });
    return $('.close').on('click', function() {
      return $(this).closest('.alert').fadeOut();
    });
  });

  getUser = function() {
    return $.getJSON("/" + ($('#username').val()) + ".json", function(user) {
      g.user = user;
      $('#key').val(user.pubkey);
      $('#pubkey').val(user.pubkey);
      $('#privkey').val(user.privkey);
      $('#address').val(user.address);
      $('#unit').html(user.unit);
      $('#currency_toggle').html(user.unit);
      $('#amount').attr('step', 0.00000001 * multiplier());
      $('#password').closest('.form-group').show();
      $('#password').focus();
      getExchangeRate();
      return $('#password').keyup();
    });
  };

  getExchangeRate = function() {
    return $.get("/ticker?currency=" + g.user.currency + "&symbol=" + g.user.symbol + "&type=bid", function(exchange) {
      g.exchange = exchange;
      return createWallet();
    });
  };

  createWallet = function() {
    return $.get(g.api + "/wallets", function(data) {
      var params, ref;
      if (ref = g.user.username, indexOf.call(data.wallet_names, ref) >= 0) {
        return getBalance();
      } else {
        params = {
          name: g.user.username
        };
        if (isBip32(g.user.pubkey)) {
          params.extended_public_key = g.user.pubkey;
          params.subchain_indexes = [0, 1];
          return $.post(g.api + "/wallets/hd", JSON.stringify(params)).done(getBalance).fail(function() {
            return $('.wallet').fadeIn();
          });
        } else {
          params.addresses = [g.user.pubkey];
          return $.post(g.api + "/wallets", JSON.stringify(params)).done(getBalance).fail(function() {
            return $('.wallet').fadeIn();
          });
        }
      }
    });
  };

  getBalance = function() {
    return $.get(g.api + "/addrs/" + g.user.username + "/balance?omitWalletAddresses=true", function(data) {
      var balance, fiat;
      balance = data.final_balance;
      g.balance = parseFloat(balance.toBTC());
      fiat = balance.toFiat();
      $('#balance').html(g.balance);
      $('#fiat').html(fiat + " " + g.user.currency);
      $('#amount').attr('max', g.balance);
      $('#balances').show();
      $('#fetching').hide();
      if (g.balance > 0 && g.user.privkey) {
        $('#keys').hide();
        $('#withdrawal form').validator('destroy');
        $('#withdrawal form').validator({
          custom: validators,
          errors: errors,
          delay: 1200
        });
        $('#withdrawal').show();
        return $('#amount').focus();
      }
    });
  };

  updateUser = function() {
    var data;
    data = $('#keys form').serializeObject();
    delete data['key'];
    return $.post("/" + g.user.username, data, function() {
      return $.ajax({
        url: g.api + "/wallets/" + g.user.username,
        type: 'DELETE'
      }).always(function() {
        return $.ajax({
          url: g.api + "/wallets/hd/" + g.user.username,
          type: 'DELETE'
        }).always(function() {
          return getUser();
        });
      });
    });
  };

  sendTransaction = function() {
    var dialog, params;
    if (g.key && !(typeof g.key.d === 'undefined' && typeof g.key.keyPair.d === 'undefined')) {
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
      return $.post(g.api + "/txs/new", JSON.stringify(params)).done(function(data) {
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
        return $.post(g.api + "/txs/new", JSON.stringify(params)).done(function(data) {
          var fee, total;
          data.pubkeys = [];
          if (g.key instanceof bitcoin.ECPair) {
            data.signatures = data.tosign.map(function(tosign, i) {
              data.pubkeys.push(g.key.getPublicKeyBuffer().toString('hex'));
              return g.key.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex");
            });
          } else {
            data.signatures = data.tosign.map(function(tosign, i) {
              var key, path;
              path = data.tx.inputs[i].hd_path.split('/');
              key = g.key.derive(parseInt(path[1])).derive(parseInt(path[2]));
              data.pubkeys.push(key.keyPair.getPublicKeyBuffer().toString('hex'));
              return key.keyPair.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex");
            });
          }
          g.data = data;
          amount = data.tx.outputs[0].value;
          fee = data.tx.fees;
          total = amount;
          if (value > parseFloat(g.balance).toSatoshis() - data.tx.fees) {
            total += fee;
          }
          $('.dialog .amount').html((amount.toBTC()) + " " + g.user.unit + " (" + (amount.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .fee').html((fee.toBTC()) + " " + g.user.unit + " (" + (fee.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .total').html((total.toBTC()) + " " + g.user.unit + " (" + (total.toFiat()) + " " + g.user.currency + ")");
          $('.dialog .address').html(data.tx.outputs[0].addresses[0]);
          dialog.getModalBody().html($('.dialog').html());
          if (amount.toBTC() < 0.00000534) {
            displayErrors({
              errors: [
                {
                  error: 'Amount left over after fee is too small to send'
                }
              ]
            }, dialog);
          }
          return dialog.getModal().find('.btn-primary').click(function() {
            return $.post(g.api + "/txs/send", JSON.stringify(g.data)).then(function(finaltx) {
              var balance, fiat;
              $('#transaction_sent').fadeIn();
              balance = g.balance.toSatoshis() - finaltx.tx.outputs[0].value - finaltx.tx.fees;
              g.balance = balance.toBTC();
              fiat = balance.toFiat();
              $('#balance').html(g.balance);
              $('#fiat').html(fiat + " " + g.user.currency);
              $('#blockchain').off('click').on('click', function() {
                return window.open('https://blockchain.info/tx/' + finaltx.tx.hash, '_blank');
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
    var e, j, len, ref, results;
    if (data.errors) {
      dialog.getModalBody().html('');
      dialog.getModal().find('.btn-primary').hide();
      ref = data.errors;
      results = [];
      for (j = 0, len = ref.length; j < len; j++) {
        e = ref[j];
        results.push(dialog.getModalBody().append("<div class='alert alert-danger'>" + e.error + "</div>"));
      }
      return results;
    }
  };

  convertedAmount = function() {
    var amount, difference, tolerance;
    if (!(g.amount && !isNaN(parseFloat(g.amount)))) {
      g.amount = amount;
    }
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
    var error;
    try {
      bitcoin.address.fromBase58Check(address);
      return true;
    } catch (error) {
      return isBip32(address);
    }
  };

  isBip32 = function(address) {
    var error;
    try {
      bitcoin.HDNode.fromBase58(address);
      return true;
    } catch (error) {
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
    return parseFloat(this / 100000000 * multiplier()).toFixed(precision());
  };

  Number.prototype.toFiat = function() {
    return parseFloat(this * g.exchange / 100000000).toFixed(2);
  };

  Number.prototype.toSatoshis = function() {
    return parseInt(this * 100000000 / multiplier());
  };

}).call(this);
