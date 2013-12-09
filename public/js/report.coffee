#= require jquery-1.8.2.min.js
#= require jquery-ui-1.9.0.custom.min.js
#= require moment.min.js

g = exports ? this

$(->
  $('#from').val(moment().subtract('days', 7).format("MM/DD/YYYY"))
  $('#to').val(moment().format("MM/DD/YYYY"))
  $('.date').datepicker(onClose: filterDates)
  $.getJSON('transactions.json', (data) ->
    g.transactions = data.transactions
    display(g.transactions)
    filterDates()
  )
)

filterDates = ->
  transactions = $.grep(g.transactions, (e, i) ->
    return false unless e

    from = moment($('#from').val(), "MM/DD/YYYY")
    to = moment($('#to').val(), "MM/DD/YYYY")
    d = moment(e.date)
    amount = parseFloat(e.exchange) * parseFloat(e.received)

    !isNaN(parseFloat(amount)) && isFinite(amount) &&
      (!from? || d.diff(from) >= 0) && (!to? || d.diff(to) <= 0) 
  )

  display(transactions)   

display = (transactions) ->
  $('tbody tr').remove()
  $('thead, tfoot').show()

  if transactions.length is 0
    $('tbody').append("""
      <tr>
        <td colspan='5'>
          No transactions were found for the specified time period
        </td>
      </tr>
    """)
    $('thead, tfoot').hide()

  $.each(transactions, ->
    exchange = parseFloat(this.exchange)
    received = parseFloat(this.received)
    amount = received * exchange
    received *= 1000

    $('tbody').append("""
      <tr>
        <td>#{this.date}</td>
        <td>#{this.address}</td>
        <td>#{exchange.toFixed(2)}</td>
        <td>#{received.toFixed(5)}</td>
        <td>#{amount.toFixed(2)}</td>
      </tr>
    """)
  )

  btc = 0
  $('td:nth-child(4)').each(->
    btc += parseFloat($(this).html())
  )
  $('#btc').html(btc.toFixed(5))

  cad = 0
  $('td:nth-child(5)').each(->
    cad += parseFloat($(this).html())
  )
  $('#cad').html(cad.toFixed(2))
