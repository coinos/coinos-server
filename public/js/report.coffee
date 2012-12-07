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
    from = moment($('#from').val(), "MM/DD/YYYY")
    to = moment($('#to').val(), "MM/DD/YYYY")
    d = moment(e.date)

    return (!from? || d.diff(from) >= 0) && (!to? || d.diff(to) <= 0)
  )

  display(transactions)   

display = (transactions) ->
  $('tbody tr').remove()
  $.each(transactions, ->
    $('tbody').append("""
      <tr>
        <td>#{this.date}</td>
        <td>#{this.address}</td>
        <td>#{parseFloat(this.exchange).toFixed(2)}</td>
        <td>#{parseFloat(this.received).toFixed(2)}</td>
        <td>#{(this.received * this.exchange).toFixed(2)}</td>
      </tr>
    """)
  )

  btc = 0
  $('td:nth-child(4)').each(->
    btc += parseFloat($(this).html())
  )
  $('#btc').html(btc.toFixed(2))

  cad = 0
  $('td:nth-child(5)').each(->
    cad += parseFloat($(this).html())
  )
  $('#cad').html(cad.toFixed(2))
