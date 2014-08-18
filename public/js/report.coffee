#= require ../js/jquery-1.8.2.min.js
#= require ../js/jquery-ui.min.js
#= require ../js/bootstrap.min.js
#= require ../js/moment.min.js

g = exports ? this

$(->
  from = moment().subtract('days', 7)
  to = moment()

  $('#from').html(from.format("MMMM Do, YYYY"))
  $('#to').html(to.format("MMMM Do, YYYY"))

  $('#from_date').val(from.format("MM/DD/YYYY"))
  $('#to_date').val(to.format("MM/DD/YYYY"))

  $('#from_date').datepicker(onClose: filterDates)
  $('#to_date').datepicker(onClose: filterDates)

  $('#from').click(-> $('#from_date').datepicker('show'))
  $('#to').click(-> $('#to_date').datepicker('show'))

  $.getJSON('transactions.json', (data) ->
    g.transactions = data.transactions
    display(g.transactions)
    filterDates()
  )
)

filterDates = ->
  $('#from').html(moment($('#from_date').datepicker('getDate')).format("MMMM Do, YYYY")) 
  $('#to').html(moment($('#to_date').datepicker('getDate')).format("MMMM Do, YYYY"))

  transactions = $.grep(g.transactions, (e, i) ->
    return false unless e

    from = moment($('#from_date').val(), "MM/DD/YYYY")
    to = moment($('#to_date').val(), "MM/DD/YYYY")

    d = moment(e.date)
    amount = parseFloat(e.exchange) * parseFloat(e.received)

    !isNaN(parseFloat(amount)) && isFinite(amount) &&
      (!from? || d.diff(from) >= 0) && (!to? || d.diff(to) <= 0) 
  )

  display(transactions)   

display = (transactions) ->
  $('.report tbody tr').remove()

  if transactions.length is 0
    $('.report').hide()
    $('.alert').fadeIn()
  else
    $('.alert').hide()
    $.each(transactions, ->
      exchange = parseFloat(this.exchange)
      received = parseFloat(this.received)
      amount = received * exchange

      $('.report tbody').append("""
        <tr>
          <td>#{moment(this.date, 'YYYY-MM-DD h:mm:ss').format('MMM D h:mma')}</td>
          <td>#{exchange.toFixed(2)}</td>
          <td>#{received.toFixed(8)}</td>
          <td>#{amount.toFixed(2)}</td>
        </tr>
      """)
    )

    btc = 0
    $('table.report tbody td:nth-child(3)').each(->
      btc += parseFloat($(this).html())
    )
    $('#btc').html(btc.toFixed(8))

    cad = 0
    $('table.report tbody td:nth-child(4)').each(->
      cad += parseFloat($(this).html())
    )
    $('#cad').html(cad.toFixed(2))

    $('.report').fadeIn()
