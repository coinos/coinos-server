var express = require('express');
var router = express.Router();
var debug = require('debug')('admin')

const { v4: uuidv4 } = require('uuid')

// usage:  GET '/users'
//
// Returns: 
//    { users: <list of users }
router.get(
  "/users",
  ah(async (req, res) => {
    var users = await db.User.findAll()

    debug('users: ' + JSON.stringify(users))
    return res.send({users: users})
  })
);

// usage:  GET '/referrals'
//
// Returns: 
//    { referrals: <list of referral tokens> }
router.get(
  "/referrals",
  ah(async (req, res) => {
    var referrals = await db.Referral.findAll()

    debug('referrals: ' + JSON.stringify(referrals))
    return res.send({referrals: referrals})
  })
);

// usage:  GET '/accounts'
//
// Returns: 
//    { referrals: <list of referral tokens> }
router.get(
  "/accounts",
  ah(async (req, res) => {
    // var referrals = await db.User
    //   .findAll({
    //     attributes: ['users.id', 'accounts.balance'],
    //     where: {
    //       '$accounts.user_id$' : '$users.id$'
    //       // user_id: users.id
    //       // $or: [
    //       //     {'$accounts.user_id$' : $users.id$},
    //       // ]
    //     },
    //     include: [
    //       {
    //         model: Account,
    //         required: false
    //       }
    //     ]
    //   });

    var accounts = await db.Account.findAll()

    debug('accounts: ' + JSON.stringify(accounts))
    return res.send({accounts: accounts})
  })
);

module.exports = router;
