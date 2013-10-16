module.exports = ->
  port: 6379
  host: '127.0.0.1'
  require('redis').createClient(port, host)
