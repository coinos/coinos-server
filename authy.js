import { Client } from 'authy-client'
import config from './config'

const authy = new Client({ key: config.authy.key })

export default async user => {
  let { authyId } = user

  const res = await authy.createApprovalRequest({
    authyId: user.authyId,
    details: {
      visible: {
        User: user.name,
      }
    },
    logos: [{
      res: 'default',
      url: 'https://coinos.io/static/img/coinos.png'
    }],
    message: 'Login to CoinOS',
  }, {
    ttl: 120
  });

  let counter = 0

  return new Promise((resolve, reject) => {
    let poll = setInterval(async () => {
      counter++
      const r = await authy.getApprovalRequest({ id: res.approval_request.uuid });
      if (r.approval_request.status === 'approved') {
        clearInterval(poll)
        resolve(true)
      } 

      if (r.approval_request.status === 'denied')  {
        clearInterval(poll)
        resolve(false)
      } 

      if (counter > 60) { clearInterval(poll); reject(false) }
    }, 1000)
  })
} 
