g = exports ? this
g.proceed = false

$(->
  $('#encryption-password').pwstrength(showVerdicts: false)

  $.getJSON("/js/rates.json", (data) ->
    currencies = Object.keys(data)
    currencies = currencies.sort()
    currencies.pop()

    $.each(currencies, (i, v) ->
      $('#currency').append("<option value='#{v}'>#{v}</option>")
    )
    $("#currency option[value='CAD']").attr('selected', 'selected')

    $('#currency').change(->
      $('#symbol option').remove()
      symbol = $(this).val()
      return unless symbol
      symbols = Object.keys(data[symbol])
      $.each(symbols, (i, v) ->
        return if v == 'localbitcoins'
        $('#symbol').append("<option value='#{v}'>#{v}</option>")
      )

      switch $(this).val()
        when 'CAD'
          $("#symbol option[value='quadrigacx']").attr('selected', 'selected')
        when 'USD'
          $("#symbol option[value='bitstamp']").attr('selected', 'selected')
    )

    user = $('#username').val()
    $.getJSON("/#{user}.json", (data) ->
      data.commission ?= 0
      data.unit ?= 'BTC'
      $('#email').val(data.email)
      $('#title').val(data.title)
      $('#logo').val(data.logo)
      $('#address').val(data.address)
      $("#symbol option[value='#{data.symbol}']").attr('selected', 'selected')
      $('#commission').val(data.commission)
      $('#unit').val(data.unit)
      $('#currency').change()
      $('#setup').fadeIn()
      $('#title').focus()
    )
  )

  units = ['BTC', 'mBTC', '&micro;BTC', 'bits', 'satoshis']
  $.each(units, (i, v) ->
    $('#unit').append("<option value='#{v}'>#{v}</option>")
  )

  $('#setup').submit(->
    $('#setup .form-control').blur()
    if $('#setup .has-error').length > 0
      $('#setup .has-error').effect('shake', 500)
      return false
  )
)

