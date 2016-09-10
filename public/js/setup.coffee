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
      currency = $(this).val()
      return unless currency

      $('#symbol option').remove()
      symbols = Object.keys(data[currency])
      $.each(symbols, (i, v) ->
        return if v == 'localbitcoins'
        $('#symbol').append("<option value='#{v}'>#{v}</option>")
      )

      switch currency
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
      $('#commission').val(data.commission)
      $('#unit').val(data.unit)
      $("#currency option[value='#{data.currency}']").attr('selected', 'selected')
      $('#currency').change()
      $("#symbol option[value='#{data.symbol}']").attr('selected', 'selected')
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

