$(->
  $('.date').datepicker()

  $.getJSON('transactions', (data) ->
    $.each(data.transactions, ->
      keys = Object.keys(this)
      transaction = this

      $.each(keys, (i,v) ->
        $('tbody tr:last td:eq(' + i + ')').html(transaction[v])
      })

      $('tbody:last').append($('tbody tr:last').clone())
    })
    $('tbody tr:last').remove()

    btc = 0
    $('td:nth-child(4)').each(->
      btc += parseFloat($(this).html())
    })
    $('#btc').html(btc)

    cad = 0
    $('td:nth-child(5)').each(->
      cad += parseFloat($(this).html())
    })
    $('#cad').html(cad)
  })
)
