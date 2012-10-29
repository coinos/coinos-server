$(function() {
  var websocket = null;
  var title = getParameterByName('title');
  var address = getParameterByName('address');
  var commission = getParameterByName('commission');
  var logo = getParameterByName('logo');
  var exchange = 0;

  if (title != "")
    $('#title').html(title);

  if (commission == "")
    commission = 3;

  if (logo != "") {
    $('#logo').attr('src', logo).show();
    $('#title').hide();
  }

  if (address == "")
    address = '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'
  $('#address').html(address);

  $('#received').hide()
  setupQR();
  setupSocket();

  $('#amount').keyup(updateTotal);
  $('#amount').focus();
  $('#amount').focus(function() {
    $('#received').hide();
    $('#payment').fadeIn('slow');
    $(this).val('');
    updateTotal();
  });

  $('#error').click(function() {
    location.reload();
  });

  function updateTotal() {
    var amount = parseFloat($('#amount').val());
    var total = amount / exchange;
    total = Math.ceil(total * 10000) / 10000;

    if (!$.isNumeric(total)) {
      total = '';
    }

    $('#total').html(total.toString());
    displayQR('bitcoin:' + address + '?amount=' + total.toString());
  }

  function fetchExchangeRate() {
    $.getJSON('ticker.php', function (data) {
      if (data == null) {
        $('#error').show();
      } else {
        exchange = 1000 / data.out;
        exchange = exchange - exchange * commission * 0.01;
        exchange = Math.ceil(exchange * 100) / 100;
        $('#exchange').val(exchange.toFixed(2));
        updateTotal();

        $('#error').hide();
        $('#calculator').fadeIn('slow');
      }
    });

    setTimeout(fetchExchangeRate, 900000);
  }

  function setupSocket() {
    setTimeout(setupSocket, 10000);

    if (!websocket || websocket.readystate != 1) {
      websocket = new WebSocket("ws://api.blockchain.info:8335/inv");

      websocket.onopen = function() { 
        websocket.send('{"op":"addr_sub", "addr":"' + address + '"}');
        fetchExchangeRate();
      }

      websocket.onerror = websocket.onclose = function() {
        $('#calculator').hide();
        $('#error').show();
      };

      websocket.onmessage = function(e) { 
        var results = eval('(' + e.data + ')');
        var from_address = '';
        var total = 0;
        var received = 0;
        
        $.each(results.x.out, function(i, v) {
          if (v.addr == address) {
            received += v.value / 100000000;
          }
        });

        $.each(results.x.inputs, function(i, v) {
          from_address = v.prev_out.addr
          if (v.prev_out.addr == address) {
            input -= v.prev_out.value / 100000000;
          }
        });

        if (total <= received) {
          $('#amount').blur();
          $('#payment').hide();
          $('#received').fadeIn('slow');
        }

        $.get('record_transaction.php',
          { 
            address: from_address,
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            received: received,
            exchange: exchange
          }
        );
      }
    }
  }
});

function getParameterByName(name) {
  name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
  var regexS = "[\\?&]" + name + "=([^&#]*)";
  var regex = new RegExp(regexS);
  var results = regex.exec(window.location.search);
  if(results == null)
    return "";
  else
    return decodeURIComponent(results[1].replace(/\+/g, " "));
}
