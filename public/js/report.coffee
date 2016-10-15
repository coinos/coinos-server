g = exports ? this

$(->
  from = moment().subtract(7, 'days')
  to = moment()

  $('#from').html(from.format("MMMM Do, YYYY"))
  $('#to').html(to.format("MMMM Do, YYYY"))

  $('#from_date').val(from.format("MM/DD/YYYY"))
  $('#to_date').val(to.format("MM/DD/YYYY"))

  $('#from_date').datepicker(onClose: filterDates)
  $('#to_date').datepicker(onClose: filterDates)

  $('#from').click(-> $('#from_date').datepicker('show').blur())
  $('#to').click(-> $('#to_date').datepicker('show').blur())

  $.getJSON('transactions.json', (data) ->
    g.transactions = data.transactions.filter((t) -> t.user is $('#user').val())
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
      (!from? || d.diff(from, 'days') >= 0) && (!to? || d.diff(to, 'days') <= 0) 
  )

  display(transactions)   

display = (transactions) ->
  $('.report tbody tr').remove()

  if transactions.length is 0
    $('.report').hide()
    $('.alert').fadeIn()
  else
    $('.alert').hide()
    btc_total = btc_tips_total = 0
    fiat_total = fiat_tips_total = 0

    $.each(transactions, ->
      btc_tip_str = ""
      fiat_tip_str = ""

      exchange = parseFloat(@exchange)
      tip = @tip
      btc = parseFloat(@received)
      fiat = btc * exchange

      btc_total += parseFloat(btc.toFixed(8))
      fiat_total += parseFloat(fiat.toFixed(2))

      if tip > 1
        btc = btc / tip
        btc_tip = (btc * tip - btc).toFixed(8)
        fiat_tip = (btc_tip * exchange).toFixed(2)

        btc_tips_total += parseFloat(btc_tip)
        fiat_tips_total += parseFloat(fiat_tip)

        btc_tip_str = "<br /><small>+ #{btc_tip}</small>"
        fiat_tip_str = "<br /><small>+ #{fiat_tip}</small>"

      fiat = btc * exchange

      notes = @notes
      txid = @txid
      date = moment(@date, 'YYYY-MM-DD h:mm:ss').format('MMM D h:mma')

      row = $("""
        <tr id='#{@txid}'>
          <td>#{date}&nbsp;&nbsp;<span class='glyphicon glyphicon-tag hidden'></span></td>
          <td>#{exchange.toFixed(2)}</td>
          <td>#{btc.toFixed(8)}#{btc_tip_str}</td>
          <td>#{fiat.toFixed(2)}#{fiat_tip_str}</td>
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

    $('#btc_total').html("#{parseFloat(btc_total).toFixed(8)}")
    $('#fiat_total').html("#{parseFloat(fiat_total).toFixed(2)}")
    $('#btc_tips').html("#{parseFloat(btc_tips_total).toFixed(8)}")
    $('#fiat_tips').html("#{parseFloat(fiat_tips_total).toFixed(2)}")
    $('#btc').html("#{parseFloat(btc_total - btc_tips_total).toFixed(8)}")
    $('#fiat').html("#{parseFloat(fiat_total - fiat_tips_total).toFixed(2)}")

    $('.report').fadeIn()
