import express from 'express';
var router = express.Router();

import  * as  parseInput from '../scripts/apiParse.js';
import Sequelize from '@sequelize/core';
const Op = Sequelize.Op;

/**
 * @api {get} /users Retrieve user list
 * @apiName getUsers
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess {Object} users List of users 
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
  // auth,
  async (req, res) => {
    var {search, starts_with, contains} = req.query
    var users = knex
      .select('username', 'email', 'phone', 'verified', knex.raw('LEFT(createdAt,10) as created_at'))
      .from('users')
      
    var timeCondition = parseInput.addTimeSearch(req.query, 'users.createdAt')
    var userCondition = parseInput.addUserSearch(req.query)

    if (timeCondition) users = users.whereRaw(timeCondition)
    if (userCondition) users = users.whereRaw(userCondition)
  
    // Alternative Sequelize query syntax
    //   await db.User.findAll({
    //   attributes: ['username', 'email', 'phone', 'verified', 'createdAt']
    // })

    const found = await users
    return res.send({users: found})
  })

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
  async (req, res) => {
    var referrals = knex
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

    var timeCondition = parseInput.addTimeSearch(req.query, 'referrals.updated_at')
    var userCondition = parseInput.addUserSearch(req.query, 'sponsor')

    if (userCondition) {
      referrals = referrals.whereRaw(userCondition)
    }
    if (timeCondition) {
      referrals = referrals.whereRaw(timeCondition)
    }

    var found = await referrals
    return res.send({referrals: found})
  })

/**
 * @api {get} /waiting_list Retrieve waiting_list
 * @apiName waiting_list
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of referral tokens
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "waiting_list" : [
 *         { email: "johndoe@hotmail.ca", phone: '604 123-4567 },
 *         { email: "janedoe@hotmail.ca", phone: '604 246-8910 },
 *        ]
 *     }
 */
router.get(
 "/waiting_list",
 // auth,
 async (req, res) => {
   var {search, starts_with, contains} = req.query

   var queue = knex
     .select(
       'waiting_list.email', 
       'waiting_list.phone', 
       'waiting_list.created_at as requested',
       'users.id as current_user_id'
     )
     .from('waiting_list')
     .leftJoin('users', 'users.email', 'waiting_list.email')
     .where('waiting_list.id', '>', 0)

   var timeCondition = parseInput.addTimeSearch(req.query, 'waiting_list.updated_at')
   var userCondition = parseInput.addUserSearch(req.query)

   if (timeCondition) queue = queue.whereRaw(timeCondition)
   if (userCondition) queue = queue.whereRaw(userCondition)

   const found = await queue

   return res.send({queue: found})
 })

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
  async (req, res) => {
    var {nonZero, search, starts_with, contains} = req.query

    var accounts = knex
      .select('username', 'accounts.id as account_id', 'ticker', 'balance', knex.raw('LEFT(accounts.createdAt, 10) as created'), knex.raw('LEFT(accounts.updatedAt, 10) as updated'))
      .from('accounts')
      .leftJoin('users', 'users.id', 'accounts.user_id')

    if (nonZero) {
      accounts = accounts
        .where('balance', '>', 0)
    }

    var timeCondition = parseInput.addTimeSearch(req.query, 'accounts.updatedAt')
    var userCondition = parseInput.addUserSearch(req.query)

    if (timeCondition) accounts = accounts.whereRaw(timeCondition)
    if (userCondition) accounts = accounts.whereRaw(userCondition)

    const found = await accounts

    return res.send({accounts: found})
  })

/**
 * @api {get} /transactions Retrieve summary of user transactions
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
  "/transactions",
  // auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var transactions = knex
      .select(
        'users.username',
        'users.email',
        // knex.raw('LEFT(created_at, 10) as created')
        // knex.raw('LEFT(updatedAt, 10) as updated')
        // knex.raw('COUNT(invoices.id) as invoices'),
        // knex.raw('COUNT(payments.id) as payments'),
        // knex.raw('COUNT(orders.id) as orders')
      )
      .from('users')

      const types = ['deposits', 'withdrawals', 'orders', 'payments', 'invoices']
      for (var i=0; i<types.length; i++) {
        var stamp = types[i].replace(/s$/,'') + '_date'

        transactions = transactions
        .select(
          knex.raw('COUNT(DISTINCT ' + types[i] + '.id) as ' + types[i]),
          knex.raw('LEFT(MAX(' + types[i] + '.updatedAt), 10) as ' + stamp)
        )
        .leftJoin(types[i], 'users.id', types[i] + '.user_id')
        // .havingRaw(types[i] + ' > ?', [0])
        
        if (since) {
          transactions = transactions
            .havingRaw('(' + stamp + ' >= ? OR ' + stamp + ' IS NULL)', [since])
        }
      }

      if (since) transactions = transactions.havingRaw('invoices + payments + deposits + orders > ?', [0])

      var userCondition = parseInput.addUserSearch(req.query)
      if (userCondition) transactions = transactions.whereRaw(userCondition)

      transactions = transactions
        .groupBy('users.id')

      const found = await transactions

    return res.send({transactions: found})
  })

/**
 * @api {get} /orders Retrieve summary of orders
 * 
 * @apiName orders
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of orders
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "orders" : [
 *         { "seller": 'Adam', "buyer": 'bob' ... },
         ...
 *        ]
 *     }
 */
router.get(
  "/orders",
  auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var orders = knex
      .select(
        'u1.username as seller',
        'u2.username as buyer',
        'v1 as sell_amount',
        'v2 as buy_amount',
        'rate',
        'a1.name as from',
        'a2.name as to',
        knex.raw('Left(completedAt,16) as completed')
      )
      .from('orders')
      .leftJoin('accounts as a1', 'a1.id', 'orders.a1_id')
      .leftJoin('accounts as a2', 'a2.id', 'orders.a2_id')
      .leftJoin('users as u1', 'a1.user_id', 'u1.id')
      .leftJoin('users as u2', 'a2.user_id', 'u2.id')

      var timeCondition = parseInput.addTimeSearch(req.query, 'orders.updatedAt')
      if (timeCondition) orders = orders.whereRaw(timeCondition)

      var userCondition1 = parseInput.addUserSearch(req.query, 'u1')
      var userCondition2 = parseInput.addUserSearch(req.query, 'u2')

      if (userCondition1) orders = orders.where( function () {
        this.whereRaw(userCondition1)
        this.orWhere(knex.raw(userCondition2))
      })

    var found = await orders
    return res.send({orders: found})
  })

/**
 * @api {get} /invoices Retrieve summary of invoices
 * 
 * @apiName invoices
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of invoices
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "invoices" : [
 *         { "seller": 'Adam', "buyer": 'bob' ... },
         ...
 *        ]
 *     }
 */
router.get(
  "/invoices",
  auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var invoices = knex
      .select(
        'username',
        'users.email',
        'invoices.currency',
        'invoices.amount',
        'accounts.network',
        knex.raw('Left(invoices.updatedAt,16) as updated')
      )
      .from('invoices')
      .leftJoin('accounts', 'invoices.account_id', 'accounts.id')
      .leftJoin('users', 'accounts.user_id', 'users.id')

      var timeCondition = parseInput.addTimeSearch(req.query, 'invoices.updatedAt')
      var userCondition = parseInput.addUserSearch(req.query)
  
      if (timeCondition) invoices = invoices.whereRaw(timeCondition)
      if (userCondition) invoices = invoices.whereRaw(userCondition)

    var found = await invoices
    return res.send({invoices: found})
  })


/**
 * @api {get} /deposits Retrieve summary of deposits
 * 
 * @apiName deposits
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of deposits
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "deposits" : [
 *         { "seller": 'Adam', "buyer": 'bob' ... },
         ...
 *        ]
 *     }
 */
router.get(
  "/deposits",
  auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var deposits = knex
      .select(
        'username',
        'users.email',
        'amount',
        'credited',
        knex.raw('Left(deposits.updatedAt,16) as deposited')
      )
      .from('deposits')
      .leftJoin('users', 'deposits.user_id', 'users.id')

    var timeCondition = parseInput.addTimeSearch(req.query, 'deposits.updatedAt')
    var userCondition = parseInput.addUserSearch(req.query)

    if (timeCondition) deposits = deposits.whereRaw(timeCondition)
    if (userCondition) deposits = deposits.whereRaw(userCondition)

    var found = await deposits
    return res.send({deposits: found})
  })

/**
 * @api {get} /withdrawals Retrieve summary of withdrawals
 * 
 * @apiName withdrawals
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of withdrawals
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "withdrawals" : [
 *         { "seller": 'Adam', "buyer": 'bob' ... },
         ...
 *        ]
 *     }
 */
router.get(
  "/withdrawals",
  auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var withdrawals = knex
      .select(
        'username',
        'users.email',
        'amount',
        'notes',
        knex.raw('Left(withdrawals.updatedAt,16) as withdrawn')
      )
      .from('withdrawals')
      .leftJoin('users', 'withdrawals.user_id', 'users.id')

      var timeCondition = parseInput.addTimeSearch(req.query, 'withdrawals.updatedAt')
      var userCondition = parseInput.addUserSearch(req.query)
  
      if (timeCondition) withdrawals = withdrawals.whereRaw(timeCondition)
      if (userCondition) withdrawals = withdrawals.whereRaw(userCondition)

    var found = await withdrawals
    return res.send({withdrawals: found})
  })

/**
 * @api {get} /payments Retrieve summary of payments
 * 
 * @apiName payments
 * @apiGroup Admin
 *
 * @apiPermission admin
 * 
 * @apiSuccess returns list of payments
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "payments" : [
 *         { "seller": 'Adam', "buyer": 'bob' ... },
         ...
 *        ]
 *     }
**/
router.get(
  "/payments",
  auth,
  async (req, res) => {
    var {type, since, search, starts_with, contains} = req.query

    var payments = knex
      .select(
        'username',
        'users.email',
        'amount',
        'payments.network',
        knex.raw('LEFT(hash,20) as hash'),
        knex.raw('Left(payments.updatedAt,16) as deposited')
      )
      .from('payments')
      .leftJoin('accounts', 'payments.account_id', 'accounts.id')
      .leftJoin('users', 'accounts.user_id', 'users.id')

    var timeCondition = parseInput.addTimeSearch(req.query, 'payments.updatedAt')
    var userCondition = parseInput.addUserSearch(req.query)

    if (timeCondition) payments = payments.whereRaw(timeCondition)
    if (userCondition) payments = payments.whereRaw(userCondition)

    var found = await payments
    return res.send({payments: found})
  })

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
  "/kyc_required",
  auth,
  async (req, res) => {
    var {since, search, starts_with, contains} = req.query
    
    var threshold = '0.2'
    
    var kyc = knex
    .select(
      knex.raw("CONCAT( FORMAT(Max(amount)/1000000, 1), ' M') as max"),
      'username',
      'users.email',
      'users.verified as kyc_verified',
      // 'payments.currency',
      // 'payments.network',
      // knex.raw('LEFT(hash,20) as hash'),
      // knex.raw('Left(payments.updatedAt,16) as transferred')
      // knex.raw( parseInput.readableDate('Max(payments.updatedAt)', 'last_changed') )
      knex.raw( 'DATE_FORMAT(Max(payments.updatedAt), ?) AS last_changed', "%M %d, %Y" )
      )
    .from('payments')
    .leftJoin('accounts', 'payments.account_id', 'accounts.id')
    .leftJoin('users', 'payments.user_id', 'users.id')   // should really point to accounts
    .groupBy('users.id')
    // .groupBy('payments.currency')
    // .groupBy('payments.network')

    var timeCondition = parseInput.addTimeSearch(req.query, 'payments.updatedAt')
    var userCondition = parseInput.addUserSearch(req.query)

    if (timeCondition) kyc = kyc.whereRaw(timeCondition)
    if (userCondition) kyc = kyc.whereRaw(userCondition)

    var found = await kyc.having('max', '>=', threshold)

    return res.send({found: found})
  })

export default router;
