#= require jquery-1.8.2.min.js
#= require moment.min.js
#= require qr.js
#= require bootstrap.min.js

g = exports ? this

$(->
  g.websocket = null
  g.client = $('#client').val()
  g.title = get('title')
  g.address = get('address')
  g.commission = get('commission')
  g.logo = get('logo')
  g.exchange = 0

  setupPage()
  setupQR()
  setupSocket()

  if client? and client
    $.getJSON('client/' + client, (data) ->
      user = data[0]
      g.title = user.title 
      g.address = user.address 
      g.commission = user.commission 
      g.logo = user.logo 
      setupPage()
    )

  $('#amount').keyup(updateTotal)
  $('#amount').focus()
  $('#amount').focus(->
    $('#received').hide()
    $('#payment').fadeIn('slow')
    $(this).val('')
    updateTotal()
  )
)

updateTotal = ->
  amount = parseFloat($('#amount').val())
  total = amount / exchange
  total = Math.ceil(total * 10000) / 10000

  unless $.isNumeric(total)
    total = ''

  $('#total').html(total.toString())
  displayQR('bitcoin:' + address + '?amount=' + total.toString())

exchangeFail = ->
  $('#error').show().html("Error fetching exchange rate")
  $('#calculator').hide()

fetchExchangeRate = ->
  $.getJSON('ticker') 
    .success((data) -> 
      unless data?
        exchangeFail()
        return

      exchange = 1000 / data.out
      exchange = exchange - exchange * commission * 0.01
      g.exchange = Math.ceil(exchange * 100) / 100
      $('#exchange').val(exchange.toFixed(2))
      updateTotal()

      $('#error').hide()
      $('#calculator').fadeIn('slow')
  ).error(exchangeFail)
  setTimeout(fetchExchangeRate, 900000)

setupPage = ->
  unless address
    address = '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr'

  unless commission
    commission = 3

  if logo
    $('#logo').attr('src', logo).show()
  else
    $('#title').html(title)

  $('#address').html(address)
  $('#received').hide()

  fetchExchangeRate()

setupSocket = ->
  setTimeout(setupSocket, 10000)

  unless g.websocket and g.websocket.readyState is 1
    g.websocket = new WebSocket("ws://api.blockchain.info:8335/inv")

    g.websocket.onopen = -> 
      g.websocket.send('{"op":"addr_sub", "addr":"' + address + '"}')
    

    g.websocket.onerror = g.websocket.onclose = ->
      $('#calculator').hide()
      $('#error').show().html("Error connecting to payment server")
    

    g.websocket.onmessage = (e) ->
      results = eval('(' + e.data + ')')
      from_address = ''
      total = 0
      received = 0
      
      $.each(results.x.out, (i, v) ->
        if (v.addr == address) 
          received += v.value / 100000000
      )

      $.each(results.x.inputs, (i, v) ->
        from_address = v.prev_out.addr
        if (v.prev_out.addr == address) 
          input -= v.prev_out.value / 100000000
      )

      if (total <= received) 
        $('#amount').blur()
        $('#payment').hide()
        $('#received').fadeIn('slow')

      $.get('record_transaction.php',
          address: from_address,
          date: moment().format("YYYY-MM-DD HH:mm:ss"),
          received: received,
          exchange: g.exchange
      )

get = (name) ->
  name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]")
  regexS = "[\\?&]" + name + "=([^&#]*)"
  regex = new RegExp(regexS)
  results = regex.exec(window.location.search)

  if (results == null)
    return ""
  else
    return decodeURIComponent(results[1].replace(/\+/g, " "))

