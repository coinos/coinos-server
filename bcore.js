import bitcoin from 'bitcoinjs-lib'
import Bitcoin from 'bitcoin-core'
import zmq from 'zeromq'

const sock = zmq.socket('sub')

;(async () => {
  let b = new Bitcoin({
    username: 'adam',
    password: 'MPJzfq97',
    port: 18332,
  })
  let res = await b.getBlockCount()
  console.log(res)

  sock.connect('tcp://127.0.0.1:18502')
  sock.subscribe('rawtx')
  sock.on('message', (t, m) => {
    let tx = bitcoin.Transaction.fromBuffer(m)
    console.log(tx)
  })
})()
