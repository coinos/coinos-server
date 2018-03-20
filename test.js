import core from 'bitcoin-core'
import fs from 'fs'
import grpc from 'grpc'

const bc = new core({ 
  username: 'adam',
  password: 'hk79c7dI8ysAHY42eglqrJLo9A8CoyvWINMAcwuPzhQ=',
  network: 'mainnet',
})

;(async () => {
  const lna = await require('lnrpc')({ server: 'localhost:10001', tls: '/home/adam/.lnd/tls.cert' })
  const maca = fs.readFileSync('/home/adam/.lnd/test.macaroon')
  const meta = new grpc.Metadata()
  meta.add('macaroon', maca.toString('hex'))
  lna.meta = meta
  let i = await lna.getInfo({}, meta)
  console.log(i)
  console.log(await bc.getBalance())
})()
