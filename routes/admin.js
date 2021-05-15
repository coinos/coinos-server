var express = require('express');
var router = express.Router();
var debug = require('debug')('admin')

const { v4: uuidv4 } = require('uuid')

// usage:  GET '/users'
//
// Returns: 
//    { users: <list of users }
// TO FIX - change sponsor_id so that it is retrieved from current payload (NOT FROM URL)
router.get(
  "/users",
  ah(async (req, res) => {
    var users = await db.User.findAll()

    debug('users: ' + JSON.stringify(users))
    return res.send({users: users})
  })
);

router.get(
  "/referrals",
  ah(async (req, res) => {
    var referrals = await db.Referral.findAll()

    debug('referrals: ' + JSON.stringify(referrals))
    return res.send({referrals: referrals})
  })
);

module.exports = router;
