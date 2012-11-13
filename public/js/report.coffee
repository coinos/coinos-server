#= require jquery-1.8.2.min.js
#= require jquery-ui-1.9.0.custom.min.js

$(->
  $('.date').datepicker()

  $.getJSON('transactions', (data) ->
    $.each(data.transactions, ->
      $('tbody').append("""
        <tr>
          <td>#{this.date}</td>
          <td>#{this.address}</td>
          <td>#{this.exchange}</td>
          <td>#{this.received}</td>
          <td>#{(this.received * this.exchange).toFixed(2)}</td>
        </tr>
      """)
    )

    btc = 0
    $('td:nth-child(4)').each(->
      btc += parseFloat($(this).html())
    )
    $('#btc').html(btc)

    cad = 0
    $('td:nth-child(5)').each(->
      cad += parseFloat($(this).html())
    )
    $('#cad').html(cad)
  )
)
