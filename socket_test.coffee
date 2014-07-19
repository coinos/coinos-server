  transaction = {"hash":{},"version":1,"lock_time":0,"ins":[{"s":{},"q":4294967295,"o":{}}],"outs":[{"v":{},"s":{}},{"v":{},"s":{}}],"_buffer":{},"txid":"8500a0893a2d83a17819673884ade21bbef07d8c92bfe51682e45873cc2d3720","vin":[{"n":0,"txid":"1549415465c84fb519ffb92339ef80461427502c90d5d3ac5d01f27d824feabd","vout":1}],"vout":[{"valueSat":10000,"scriptPubKey":{"addresses":["1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr"]},"n":0},{"valueSat":3966838180,"scriptPubKey":{"addresses":["1Ao8Swc6vSosrjednQkNZeXEXVu1ZcxYZE"]},"n":1}],"time":1405573125}

  $('body').append(transaction.vout[0].valueSat)

  socket = io('ws://insight.bitpay.com')
  socket.on('connect', ->
    $('body').append('connected')
    this.emit('subscribe', '1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr')
  )

  socket.on('1VAnbtCAnYccECnjaMCPnWwt81EHCVgNr', (data) ->
    $('body').append(JSON.stringify(data))
  )

