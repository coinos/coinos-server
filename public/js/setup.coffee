#= require jquery-1.8.2.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js

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

    $('#address').change(->
      if check_address($(this).val())
        $(this).css('color', 'black')
      else
        $(this).css('color', 'red')
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
      return false if $('.has-error').length()
    )

    if user
      $('#setup').attr('action', "/#{user}/update").attr('method', 'post')
      $.getJSON("/#{user}.json", (data) ->
        $('#title').val(data.title)
        $('#logo').val(data.logo)
        $('#address').val(data.address)
        $("#symbol option[value='#{data.symbol}']").attr('selected', 'selected')
        $('#commission').val(data.commission)
      )
  )
)
