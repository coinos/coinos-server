$(function() {
  var websocket = new WebSocket("ws://api.blockchain.info:8335/inv");
  var exchange = 0;
  var total = 0;
  var received = 0;
  var address = getParameterByName('address');
  
  if (address == "")
    window.location = 'index.html?address=1KDaKixtYqPdDNsu3fMeAHHB52R2WHvXCQ'

  setupqr();
  $('#received').hide()
  $('div.container-fluid').css('width', Math.min(screen.width, 600) + 'px');
  $('#address').html(address);

  websocket.onopen = function() { 
    websocket.send('{"op":"addr_sub", "addr":"' + address + '"}');
  }

  websocket.onmessage = function(e) { 
    var results = eval('(' + e.data + ')');
    var from_address = '';
    
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
        date: getFormattedDate(),
        received: received,
        exchange: exchange
      }
    );
  }

  $.getJSON('ticker.json', function (data) {
    exchange = 1000 / data.out;
    exchange = exchange + exchange * 0.03;
    exchange = Math.ceil(exchange * 100) / 100;
    $('#exchange').val(exchange.toFixed(2));
    updateTotal();
  });

  $('#amount').keyup(updateTotal);
  $('#amount').focus();
  $('#amount').focus(function() {
    $('#payment').show();
    $('#received').hide();
    $('#total').html('0');
    $(this).val('');
  });

  function updateTotal() {
    var amount = parseFloat($('#amount').val());
    total = amount / exchange;
    total = Math.ceil(total * 10000) / 10000;
    if (!$.isNumeric(total)) total = '';
    $('#total').html(total.toString());
    doqr('bitcoin:' + address + '?amount=' + total.toString());
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

function getFormattedDate() {
    var date = new Date();
    var str = date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate() + " " +  date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();

    return str;
}

