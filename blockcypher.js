const proxyMiddleware = require('http-proxy-middleware')
const proxyContext = '/blockcypher'

const proxyOptions = {
  target: 'https://api.blockcypher.com',
  changeOrigin: true,
  pathRewrite: {
    '^/blockcypher/': '/'
  },
  onProxyReq: function(proxyReq, req, res) {
    var symbol
    symbol = indexOf.call(proxyReq.path, '?') >= 0 ? '&' : '?'
    return proxyReq.path += symbol + "token=" + config.blockcypher_token
  }
}

module.exports = proxyMiddleware(proxyContext, proxyOptions)
