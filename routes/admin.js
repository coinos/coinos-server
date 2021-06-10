var express = require('express');
var router = express.Router();
var debug = require('debug')('admin')

const Sequelize = require('sequelize')
const Op = Sequelize.Op;

const { v4: uuidv4 } = require('uuid');

/**
 * @api {get} /users Retrieve user list
 * @apiName getUsers
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess {token: referral_code, expiry: expiry} Token and expiry if applicable.
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "users" : [
 *         { "username": 'John Doe', "email": 'johndoe@gmail.com', ...},
 *         { "username": 'Jane Doe', "email": 'janedoe@gmail.com', ...}
 *        ]
 *     }
 */
router.get(
  "/users",
  auth,
  ah(async (req, res) => {
    var users = await knex
      .select('username', 'email', 'sms', 'verified', knex.raw('LEFT(createdAt,10) as created_at'))
      .from('users')
      
    // Alternative Sequelize query syntax
    //   await db.User.findAll({
    //   attributes: ['username', 'email', 'sms', 'verified', 'createdAt']
    // })

    debug('users: ' + JSON.stringify(users))
    return res.send({users: users})
  })
);

/**
 * @api {get} /referrals Retrieve list of referral tokens
 * @apiName referrals
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of referral tokens
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "referrals" : [
 *         { "token": '***', "status": 'pending', sponsor: 'Adam', user: 'newUsername1', expiry: null },
 *         { "token": '***', "status": 'pending', sponsor: 'Adam', user: 'newUsername2', expiry: null },
 *        ]
 *     }
 */
router.get(
  "/referrals",
  auth,
  ah(async (req, res) => {
    var referrals = await knex
      .select(
        'token', 
        'users.username as user', 
        'sponsor.username as sponsor', 
        knex.raw('LEFT(created_at, 10) as created_at'), 
        'referrals.status'
      )
      .from('referrals')
      .leftJoin('users', 'users.id', 'referrals.user_id')
      .leftJoin('users as sponsor', 'sponsor.id', 'referrals.sponsor_id')

    // Alternative Sequelize query syntax (returns sub-tables as hash)
    // var referrals = await db.Referral.findAll({
    //   include: [ 
    //     {model: db.User, as: 'user', attributes: [['username', 'user']]},
    //     {model: db.User, as: 'sponsor', attributes: [['username', 'sponsor']]}
    //   ]
    // })


    debug('Referrals: ' + JSON.stringify(referrals))
    return res.send({referrals: referrals})
  })
);

/**
 * @api {get} /accounts Retrieve list of accounts
 * @apiName accounts
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of accounts
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "accounts" : [
 *         { "user": 'Adam', "account_id": '123', balance: 500 ... },
 *          ...
 *        ]
 *     }
 */
router.get(
  "/accounts",
  auth,
  ah(async (req, res) => {
    const {nonZero} = req.query

    var accounts = knex
      .select('username', 'accounts.id as account_id', 'ticker', 'balance', knex.raw('LEFT(accounts.createdAt, 10) as created_at'))
      .from('accounts')
      .leftJoin('users', 'users.id', 'accounts.user_id')

    if (nonZero) {
      accounts = accounts
        .where('balance', '>', 0)
    }
    var found = await accounts

    debug('accounts: ' + JSON.stringify(found))
    return res.send({accounts: found})
  })
);

/**
 * @api {get} /user_transactions Retrieve summary of user transactions
 * 
 * @apiName user_transactions
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of invoices, payments, orders for users
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "transactions" : [
 *         { "username": 'Adam', "email": 'adam@gmail.com', invoices: 1, orders: 0, payments: 2 },
         ...
 *        ]
 *     }
 */
router.get(
  "/user_transactions",
  auth,
  ah(async (req, res) => {
    var transactions = knex
      .select(
        'username',
        'email',
        knex.raw('COUNT(invoices.id) as invoices'),
        knex.raw('COUNT(payments.id) as payments'),
        knex.raw('COUNT(orders.id) as orders')
      )
      .from('users')
      .leftJoin('accounts', 'users.id', 'accounts.user_id')
      .leftJoin('invoices', 'invoices.account_id', 'accounts.id')
      .leftJoin('payments', 'payments.account_id', 'accounts.id')
      .leftJoin('orders', 'orders.user_id', 'users.id')
      .groupBy('users.id')

    // Alternative Sequelize query syntax (returns sub-tables as hash)
    // var referrals = await db.Referral.findAll({
    //   include: [ 
    //     {model: db.User, as: 'user', attributes: [['username', 'user']]},
    //     {model: db.User, as: 'sponsor', attributes: [['username', 'sponsor']]}
    //   ]
    // })

    // var transactions = await db.User.findAll({
    //   include: [
    //     { model: db.Invoice, as: 'invoices' },
    //     { model: db.Payment, as: 'payments' },
    //     { model: db.Order, as: 'orders'}
    //   ]
    // })

    var found = await transactions
    debug('transactions: ' + JSON.stringify(found))
    return res.send({transactions: found})
  })
);

/**
 * @api {get} /user_kyc Retrieve user kyc details
 * 
 * @apiName user_kyc
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of kyc details for each user
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "users" : [
 *         { "username": 'Adam', "email": 'adam@gmail.com', ... kyc_data... },
         ...
 *        ]
 *     }
 */
router.get(
  "/user_kyc",
  auth,
  ah(async (req, res) => {
    
    var kyc = { details: 'Not yet defined' }
    debug('kyc: ' + JSON.stringify(kyc))
    return res.send({users: kyc})
  })
);

module.exports = router;
