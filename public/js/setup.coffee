#= require ../js/jquery-1.8.2.min.js
#= require ../js/jquery-ui.min.js
#= require ../js/bootstrap.min.js
#= require ../js/2.5.3-crypto-sha256.js
#= require ../js/jsbn.js
#= require ../js/jsbn2.js
#= require ../js/check_address.js

g = exports ? this
g.proceed = false

$(->
  $('#title').focus()
  $.getJSON("/js/rates.json", (data) ->
    currencies = Object.keys(data)
    currencies = currencies.sort()
    currencies.pop()

    $.each(currencies, (i, v) ->
      $('#currency').append("<option value='#{v}'>#{v}</option>")
    )
    $("#currency option[value='CAD']").attr('selected', 'selected')

    user = $('#username').val()

    $('#currency').change(->
      $('#symbol option').remove()
      symbol = $(this).val()
      return unless symbol
      symbols = Object.keys(data[symbol])
      $.each(symbols, (i, v) ->
        $('#symbol').append("<option value='#{v}'>#{v} bid price</option>")
      )

      switch $(this).val()
        when 'CAD'
          $("#symbol option[value='quadrigacx']").attr('selected', 'selected')
        when 'USD'
          $("#symbol option[value='bitstamp']").attr('selected', 'selected')

    ).change()

    units = ['BTC', 'mBTC', '&micro;BTC', 'satoshis']
    $.each(units, (i, v) ->
      $('#unit').append("<option value='#{v}'>#{v}</option>")
    )

    $('#title').blur(->
      if $(this).val() == ''
        $(this).parent().addClass('has-error')
      else
          $(this).parent().removeClass('has-error')
    )

    $('#address').blur(->
      if check_address($(this).val())
        $(this).parent().removeClass('has-error')
      else
        $(this).parent().addClass('has-error')
    )

    $('#confirm').blur(->
      $('#confirm_error').remove() 
      if $('#password').val() != $('#confirm').val()
        $('#password, #confirm').parent().addClass('has-error')
        $('#confirm').parent().after('<div id="confirm_error" class="alert alert-danger">Passwords don\'t match</div>')
      else
        $('#password, #confirm').parent().removeClass('has-error')
    )

    $('#setup').submit(->
      $('.form-control').blur()
      if $('.has-error').length > 0
        $('.has-error').effect('shake', 500)
        return false
    )

    if user
      $('#setup').attr('action', "/#{user}").attr('method', 'post')
      $.getJSON("/#{user}.json", (data) ->
        $('#title').val(data.title)
        $('#address').val(data.address)
        $("#symbol option[value='#{data.symbol}']").attr('selected', 'selected')
        $('#commission').val(data.commission)
        $('#unit').val(data.unit)
        $('#setup').fadeIn()
      )
  )
)
