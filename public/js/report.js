(function() {
  var display, filterDates, g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    $('#from').val(moment().subtract('days', 7).format("MM/DD/YYYY"));
    $('#to').val(moment().format("MM/DD/YYYY"));
    $('.date').datepicker({
      onClose: filterDates
    });
    return $.getJSON('transactions.json', function(data) {
      g.transactions = data.transactions;
      display(g.transactions);
      return filterDates();
    });
  });

  filterDates = function() {
    var transactions;
    transactions = $.grep(g.transactions, function(e, i) {
      var amount, d, from, to;
      if (!e) {
        return false;
      }
      from = moment($('#from').val(), "MM/DD/YYYY");
      to = moment($('#to').val(), "MM/DD/YYYY");
      d = moment(e.date);
      amount = parseFloat(e.exchange) * parseFloat(e.received);
      return !isNaN(parseFloat(amount)) && isFinite(amount) && ((from == null) || d.diff(from) >= 0) && ((to == null) || d.diff(to) <= 0);
    });
    return display(transactions);
  };

  display = function(transactions) {
    var btc, cad;
    $('tbody tr').remove();
    $('thead, tfoot').show();
    if (transactions.length === 0) {
      $('tbody').append("<tr>\n  <td colspan='5'>\n    No transactions were found for the specified time period\n  </td>\n</tr>");
      $('thead, tfoot').hide();
    }
    $.each(transactions, function() {
      var amount, exchange, received;
      exchange = parseFloat(this.exchange);
      received = parseFloat(this.received);
      amount = received * exchange;
      received *= 1000;
      return $('tbody').append("<tr>\n  <td>" + this.date + "</td>\n  <td>" + this.address + "</td>\n  <td>" + (exchange.toFixed(2)) + "</td>\n  <td>" + (received.toFixed(5)) + "</td>\n  <td>" + (amount.toFixed(2)) + "</td>\n</tr>");
    });
    btc = 0;
    $('table.report td:nth-child(4)').each(function() {
      return btc += parseFloat($(this).html());
    });
    $('#btc').html(btc.toFixed(5));
    cad = 0;
    $('table.report td:nth-child(5)').each(function() {
      return cad += parseFloat($(this).html());
    });
    return $('#cad').html(cad.toFixed(2));
  };

}).call(this);
