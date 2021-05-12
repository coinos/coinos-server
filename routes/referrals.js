var express = require('express');
var router = express.Router();
var debug = require('debug')('referral')

const { v4: uuidv4 } = require('uuid')
const config = require('./../config')

router.get('/', function(req, res, next) {
  res.send('list of referrals...');
});

router.get(
  "/grant",
  ah(async (req, res) => {
    const {sponsor_id, expiry} = req.query

    var token = uuidv4()
    debug('generated token: ' + token + ' sponsored by ' + sponsor_id)

    var ref = await db.Referrals.create({
      sponsor_id: sponsor_id, 
      token: token, 
      status: 'pending'
    })

    debug('generated referral: ' + JSON.stringify(ref))
    return res.send(token)
  })
);

router.get(
  "/verify/:user_id/:token",
  ah(async (req, res) => {
    const { user_id, token } = req.params;

    debug('verify token: ' + token)
      
    const found = await db.Referral.findAll({
      attributes: ['status'],
      where: {
        token: token,
        user_id: null
      }
    })

    if (found && found.length) {
      debug('found referral: ' + JSON.stringify(found))
      if (found[0].status === 'pending') {

        await db.Referral.update(
          { 
            status: 'active',
            user_id: user_id,
            updated_at: new Date().toISOString().substring(0,10)
          },
          {
            where: { token: token }
          }
        )

        return res.send({ verified: true });
      } else {
        res.status(500).send({ verified: false, message: 'Referral already ' + found[0].status })
      }
    } else {
      res.status(500).send('Invalid referral token')
    }
  })
);

router.post(
  "/joinQueue",
  ah(async (req, res) => {
    const { email, sms } = req.query;

    debug('email: ' + email)

    const added = db.WaitingList.create({
      email: email     
    })

    res.send({message: 'Added to waiting list'})
  })
);

module.exports = router;
