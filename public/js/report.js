(function() {
  var display, filterDates, g;

  g = typeof exports !== "undefined" && exports !== null ? exports : this;

  $(function() {
    var from, to;
    from = moment().subtract(7, 'days');
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
      return $('#from_date').datepicker('show').blur();
    });
    $('#to').click(function() {
      return $('#to_date').datepicker('show').blur();
    });
    return $.getJSON('transactions.json', function(data) {
      g.transactions = data.transactions.filter(function(t) {
        return t.user === $('#user').val();
      });
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
      return !isNaN(parseFloat(amount)) && isFinite(amount) && ((from == null) || d.diff(from, 'days') >= 0) && ((to == null) || d.diff(to, 'days') <= 0);
    });
    return display(transactions);
  };

  display = function(transactions) {
    var btc_tips_total, btc_total, fiat_tips_total, fiat_total;
    $('.report tbody tr').remove();
    if (transactions.length === 0) {
      $('.report').hide();
      return $('.alert').fadeIn();
    } else {
      $('.alert').hide();
      btc_total = btc_tips_total = 0;
      fiat_total = fiat_tips_total = 0;
      $.each(transactions, function() {
        var btc, btc_tip, btc_tip_str, date, exchange, fiat, fiat_tip, fiat_tip_str, notes, row, tip, txid;
        btc_tip_str = "";
        fiat_tip_str = "";
        exchange = parseFloat(this.exchange);
        tip = this.tip;
        btc = parseFloat(this.received);
        fiat = btc * exchange;
        btc_total += parseFloat(btc.toFixed(8));
        fiat_total += parseFloat(fiat.toFixed(2));
        if (tip > 1) {
          btc = btc / tip;
          btc_tip = (btc * tip - btc).toFixed(8);
          fiat_tip = (btc_tip * exchange).toFixed(2);
          btc_tips_total += parseFloat(btc_tip);
          fiat_tips_total += parseFloat(fiat_tip);
          btc_tip_str = "<br /><small>+ " + btc_tip + "</small>";
          fiat_tip_str = "<br /><small>+ " + fiat_tip + "</small>";
        }
        fiat = btc * exchange;
        notes = this.notes;
        txid = this.txid;
        date = moment(this.date, 'YYYY-MM-DD h:mm:ss').format('MMM D h:mma');
        row = $("<tr id='" + this.txid + "'>\n  <td>" + date + "&nbsp;&nbsp;<span class='glyphicon glyphicon-tag hidden'></span></td>\n  <td>" + (exchange.toFixed(2)) + "</td>\n  <td>" + (btc.toFixed(8)) + btc_tip_str + "</td>\n  <td>" + (fiat.toFixed(2)) + fiat_tip_str + "</td>\n</tr>");
        if (notes) {
          row.attr('data-notes', notes);
          row.find('span').removeClass('hidden');
        }
        $('.report tbody').append(row);
        return row.click(function() {
          $('#confirm, #yousure').hide();
          $('#buttons, #modal textarea').show();
          notes = $(this).attr('data-notes');
          $('#modal').modal();
          $('#modal textarea').val('');
          $('#modal .btn-primary').toggle((txid != null) && txid.length > 5);
          $('#modal .btn-danger').off().click(function() {
            $('#yousure, #confirm').show();
            return $('#buttons, #modal textarea').hide();
          });
          $('#confirm .btn-danger').click(function() {
            $.ajax({
              type: 'delete',
              url: "/" + ($('#user').val()) + "/transactions/" + txid
            });
            $('#modal').modal('hide');
            return row.fadeOut('slow');
          });
          $('#modal .btn-primary').off().click(function() {
            window.open("https://blockchain.info/tx/" + txid, '_blank');
            return $('#modal').modal('hide');
          });
          $('#modal textarea').off().change(function() {
            notes = $(this).val();
            if (txid) {
              $.post("/transactions/" + txid, {
                notes: $(this).val()
              });
            }
            row.find('span').addClass('hidden');
            if (notes) {
              row.find('span').removeClass('hidden');
            }
            return row.attr('data-notes', $(this).val());
          });
          if (notes) {
            return $('#modal textarea').val(notes);
          }
        });
      });
      $('#btc_total').html("" + (parseFloat(btc_total).toFixed(8)));
      $('#fiat_total').html("" + (parseFloat(fiat_total).toFixed(2)));
      $('#btc_tips').html("" + (parseFloat(btc_tips_total).toFixed(8)));
      $('#fiat_tips').html("" + (parseFloat(fiat_tips_total).toFixed(2)));
      $('#btc').html("" + (parseFloat(btc_total - btc_tips_total).toFixed(8)));
      $('#fiat').html("" + (parseFloat(fiat_total - fiat_tips_total).toFixed(2)));
      return $('.report').fadeIn();
    }
  };

}).call(this);
