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
      exchange = parseFloat(@exchange)
      received = parseFloat(@received)
      amount = received * exchange
      notes = @notes
      txid = @txid
      address = @address
      date = moment(@date, 'YYYY-MM-DD h:mm:ss').format('MMM D h:mma')

      row = $("""
        <tr id='#{@txid}'>
          <td>#{date}&nbsp;&nbsp;<span class='glyphicon glyphicon-tag hidden'></span></td>
          <td>#{exchange.toFixed(2)}</td>
          <td>#{received.toFixed(8)}</td>
          <td>#{amount.toFixed(2)}</td>
        </tr>
      """)

      if notes
        row.attr('data-notes', notes)
        row.find('span').removeClass('hidden')

      $('.report tbody').append(row) 
      
      row.click(-> 
        $('#confirm, #yousure').hide()
        $('#buttons, #modal textarea').show()
        notes = $(this).attr('data-notes')

        $('#modal').modal()
        $('#modal textarea').val('')
        $('#modal .btn-primary').toggle(txid? and txid.length > 5) 

        $('#modal .btn-danger').off().click(->
          $('#yousure, #confirm').show()
          $('#buttons, #modal textarea').hide()
        )

        $('#confirm .btn-danger').click(->
          $.ajax(type: 'delete', url: "/#{$('#user').val()}/transactions/#{txid}")
          $('#modal').modal('hide')
          row.fadeOut('slow')
        )

        $('#modal .btn-primary').off().click(->
          window.open("https://blockchain.info/tx/#{txid}", '_blank')
          $('#modal').modal('hide')
        )

        $('#modal textarea').off().change(->
          notes = $(this).val()
          $.post("/transactions/#{txid}", notes: $(this).val()) if txid

          row.find('span').addClass('hidden')
          if notes
            row.find('span').removeClass('hidden')

          row.attr('data-notes', $(this).val())
        )

        if notes
          $('#modal textarea').val(notes) 
      )
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
