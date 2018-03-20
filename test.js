import fs from 'fs'
import grpc from 'grpc'

try {
  ;(async () => {
    const lna = await require('lnrpc')({ server: 'localhost:10001', tls: '/home/adam/.lnd/tls.cert' })
    const maca = fs.readFileSync('/home/adam/.lnd/test.macaroon')
    const meta = new grpc.Metadata()
    meta.add('macaroon', maca.toString('hex'))
    lna.meta = meta
    console.log('meow')
    try {
      let i = await lna.getInfo({}, meta)
      console.log('i', i)
    } catch (e) { console.log(e) }
  })()
} catch (e) { console.log(e) }

console.log('done')
