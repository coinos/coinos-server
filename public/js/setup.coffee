#= require jquery-1.8.2.min.js
#= require 2.5.3-crypto-sha256.js
#= require jsbn.js
#= require jsbn2.js
#= require check_address.js

$(->
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
      symbols = Object.keys(data[$(this).val()])
      $.each(symbols, (i, v) ->
        $('#symbol').append("<option value='#{v}'>#{v} bid price</option>")
      )
      $("#symbol option[value='quadrigacx']").attr('selected', 'selected')
    ).change()

    $('#address').change(->
      if check_address($(this).val())
        $(this).css('color', 'black')
      else
        $(this).css('color', 'red')
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
