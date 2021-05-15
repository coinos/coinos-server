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
  auth,
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
  auth,
  ah(async (req, res) => {
    var referrals = await db.Referral.findAll()

    debug('referrals: ' + JSON.stringify(referrals))
    return res.send({referrals: referrals})
  })
);

// usage:  GET '/user_accounts'
//
// Returns: 
//    { referrals: <list of referral tokens> }
router.get(
  "/user_accounts",
  auth,
  ah(async (req, res) => {
    var accounts = await db.User.findAll({
      include: [
        { model: db.Account, as: 'accounts' }
      ]
    })

    debug('accounts: ' + JSON.stringify(accounts))
    return res.send({users: accounts})
  })
);

// usage:  GET '/accounts'
//
// Returns: 
//    { referrals: <list of referral tokens> }
router.get(
  "/user_accounts",
  auth,
  ah(async (req, res) => {
    var accounts = await db.Account.findAll({
      include: [
        { model: db.User, as: 'user' }
      ]
    })

    debug('accounts: ' + JSON.stringify(accounts))
    return res.send({accounts: accounts})
  })
);

// usage:  GET '/user/transactions'
//
// Returns: 
//    { users: [
//         <user attributes>, 
//         Invoices: 
//           <invoice attributes>, 
//         Payments: 
//           <invoice attributes>, 
//         Orders: 
//           <invoice attributes>, 
//       ], ...
//    }
router.get(
  "/user_transactions",
  auth,
  ah(async (req, res) => {
    var transactions = await db.User.findAll({
      include: [
        { model: db.Invoice, as: 'invoices' },
        { model: db.Payment, as: 'payments' },
        { model: db.Order, as: 'orders'}
      ]
    })

    debug('transactions: ' + JSON.stringify(transactions))
    return res.send({users: transactions})
  })
);

// usage:  GET '/user_kyc'
//
// Returns: 
//    { 
//  users: [
//    <list of user attributes>,
//    kyc: <list of kyc attributes for this user>
//  ] 
router.get(
  "/user_kyc",
  auth,
  ah(async (req, res) => {
    var kyc = await db.User.findAll({
      // include: [
      //   { model: db.Kyc, as: 'kyc' }
      // ]
    })

    debug('kyc: ' + JSON.stringify(kyc))
    return res.send({users: kyc})
  })
);

module.exports = router;
