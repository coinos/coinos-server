$(function() {
  var websocket = null;
  var client = getParameterByName('client');
  var title = getParameterByName('title');
  var address = getParameterByName('address');
  var commission = getParameterByName('commission');
  var logo = getParameterByName('logo');
  var exchange = 0;

  setupPage();
  setupQR();
  setupSocket();

  if (client != "") {
    $.getJSON('client.json', { name: client }, function(data) {
      title = data.title; 
      address = data.address; 
      commission = data.commission; 
      logo = data.logo; 
      setupPage();
    });
  }

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

  function exchangeFail() {
    $('#error').show().html("Error fetching exchange rate");
    $('#calculator').hide();
  }

  function fetchExchangeRate() {
    $.getJSON('ticker.php') 
      .success(function (data) {
        if (data == null) {
          exchangeFail();
          return;
        }

        exchange = 1000 / data.out;
        exchange = exchange - exchange * commission * 0.01;
        exchange = Math.ceil(exchange * 100) / 100;
        $('#exchange').val(exchange.toFixed(2));
        updateTotal();

        $('#error').hide();
        $('#calculator').fadeIn('slow');
      }
    ).error(exchangeFail);

    setTimeout(fetchExchangeRate, 900000);
  }

  function setupPage() {
    if (address == "")
      address = '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'

    if (commission == "")
      commission = 3;

    if (logo != "") 
      $('#logo').attr('src', logo).show();
    else
      $('#title').html(title);

    $('#address').html(address);
    $('#received').hide();
  }

  function setupSocket() {
    setTimeout(setupSocket, 10000);

    if (!websocket || websocket.readyState != 1) {
      websocket = new WebSocket("ws://api.blockchain.info:8335/inv");

      websocket.onopen = function() { 
        websocket.send('{"op":"addr_sub", "addr":"' + address + '"}');
        fetchExchangeRate();
      }

      websocket.onerror = websocket.onclose = function() {
        $('#calculator').hide();
        $('#error').show().html("Error connecting to payment server");
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
