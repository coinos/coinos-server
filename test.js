import request from 'request'
import crypto from 'crypto-js'
import config from './config'

const nonce = Date.now().toString()
const conf = config.quad
const signature = crypto.HmacSHA256(
  nonce + conf.client_id + conf.key, 
  conf.secret
).toString()

request('https://api.quadrigacx.com/v2/order_book', (error, response, body) => {
  let data = JSON.parse(body)
  let quadriga_ask = data.asks[0][0]
  let amount = data.asks[0][1]
  console.log('Quadriga ask price: ' + quadriga_ask)
})
