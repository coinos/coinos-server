$(function() {
  $('.date').datepicker();

  $.getJSON('transactions.json', function(data) {
    $.each(data.transactions, function() {
      var keys = Object.keys(this);
      var transaction = this;

      $.each(keys, function(i,v) {
        $('tbody tr:last td:eq(' + i + ')').html(transaction[v]);
      });

      $('tbody:last').append($('tbody tr:last').clone());
    });
    $('tbody tr:last').remove();

    var btc = 0;
    $('td:nth-child(4)').each(function() {
      btc += parseFloat($(this).html());
    });
    $('#btc').html(btc);

    var cad = 0;
    $('td:nth-child(5)').each(function() {
      cad += parseFloat($(this).html());
    });
    $('#cad').html(cad);
  });
});
