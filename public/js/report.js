(function() {
  var display, filterDates, g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    var from, to;
    from = moment().subtract('days', 7);
    to = moment();
    $('#from').html(from.format("MMMM Do, YYYY"));
    $('#to').html(to.format("MMMM Do, YYYY"));
    $('#from_date').val(from.format("MM/DD/YYYY"));
    $('#to_date').val(to.format("MM/DD/YYYY"));
    $('#from_date').datepicker({
      onClose: filterDates
    });
    $('#to_date').datepicker({
      onClose: filterDates
    });
    $('#from').click(function() {
      return $('#from_date').datepicker('show');
    });
    $('#to').click(function() {
      return $('#to_date').datepicker('show');
    });
    return $.getJSON('transactions.json', function(data) {
      g.transactions = data.transactions;
      display(g.transactions);
      return filterDates();
    });
  });

  filterDates = function() {
    var transactions;
    $('#from').html(moment($('#from_date').datepicker('getDate')).format("MMMM Do, YYYY"));
    $('#to').html(moment($('#to_date').datepicker('getDate')).format("MMMM Do, YYYY"));
    transactions = $.grep(g.transactions, function(e, i) {
      var amount, d, from, to;
      if (!e) {
        return false;
      }
      from = moment($('#from_date').val(), "MM/DD/YYYY");
      to = moment($('#to_date').val(), "MM/DD/YYYY");
      d = moment(e.date);
      amount = parseFloat(e.exchange) * parseFloat(e.received);
      return !isNaN(parseFloat(amount)) && isFinite(amount) && ((from == null) || d.diff(from) >= 0) && ((to == null) || d.diff(to) <= 0);
    });
    return display(transactions);
  };

  display = function(transactions) {
    var btc, cad;
    $('.alert').remove();
    $('.report tbody tr').remove();
    $('.report').show();
    if (transactions.length === 0) {
      $('.report').before("<p class='alert alert-warning'>No transactions were found for the specified time period</p>");
      $('.report').hide();
    }
    $.each(transactions, function() {
      var amount, exchange, received;
      exchange = parseFloat(this.exchange);
      received = parseFloat(this.received);
      amount = received * exchange;
      received *= 1000;
      return $('.report tbody').append("<tr>\n  <td>" + this.date + "</td>\n  <td>" + this.address + "</td>\n  <td>" + (exchange.toFixed(2)) + "</td>\n  <td>" + (received.toFixed(5)) + "</td>\n  <td>" + (amount.toFixed(2)) + "</td>\n</tr>");
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
