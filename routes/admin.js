var express = require('express');
var router = express.Router();
var debug = require('debug')('debug')

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
  ah(async (req, res) => {
    var {search, starts_with, contains} = req.query
    var users = knex
      .select('username', 'email', 'phone', 'verified', knex.raw('LEFT(createdAt,10) as created_at'))
      .from('users')
      
    if (starts_with) {
      search = search + '%'
    } else if (contains) {
      search = '%' + search + '%'
    }

    if (search) {
      users = users
        .where('username', 'like', search)
        .orWhere('email', 'like', search)
    }
    debug('search ? ' + search)
    // Alternative Sequelize query syntax
    //   await db.User.findAll({
    //   attributes: ['username', 'email', 'phone', 'verified', 'createdAt']
    // })

    const found = await users
    debug('users: ' + JSON.stringify(found))
    return res.send({users: found})
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
  "/waiting_list",
  // auth,
  ah(async (req, res) => {
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

    if (starts_with) {
      search = search + '%'
    } else if (contains) {
      search = '%' + search + '%'
    }

    if (search) {
      queue = queue
        .where('waiting_list.email', 'like', search)
        .orWhere('users.username', 'like', search)
    }
    debug('search ? ' + search)
    const found = await queue

    debug('Waiting list: ' + JSON.stringify(found))
    return res.send({queue: found})
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
    var {nonZero, search, starts_with, contains} = req.query

    var accounts = knex
      .select('username', 'accounts.id as account_id', 'ticker', 'balance', knex.raw('LEFT(accounts.createdAt, 10) as created'), knex.raw('LEFT(accounts.updatedAt, 10) as updated'))
      .from('accounts')
      .leftJoin('users', 'users.id', 'accounts.user_id')

    if (nonZero) {
      accounts = accounts
        .where('balance', '>', 0)
    }

    if (starts_with) {
      search = search + '%'
    } else if (contains) {
      search = '%' + search + '%'
    }

    if (search) {
      accounts = accounts
        .where('users.email', 'like', search)
        .orWhere('users.username', 'like', search)
    }
    debug('search ? ' + search)
    const found = await accounts

    debug('accounts: ' + JSON.stringify(found))
    return res.send({accounts: found})
  })
);

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
  ah(async (req, res) => {
    const {type, since} = req.query

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
          debug(types[i] + ' since ' + since)
        }
      }
      if (since) transactions = transactions.havingRaw('invoices + payments + deposits + orders > ?', [0])
      
      transactions = transactions
        .groupBy('users.id')

    var found = await transactions
    debug('transactions: ' + JSON.stringify(found))
    return res.send({transactions: found})
  })
);

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
  ah(async (req, res) => {
    const {type, since} = req.query

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

      if (since) {
        orders = orders
        .where('orders.updatedAt', '>=', since)
      }

      debug('orders since ' + since)

    var found = await orders
    debug('orders: ' + JSON.stringify(found))
    return res.send({orders: found})
  })
);

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
  ah(async (req, res) => {
    const {type, since} = req.query

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

      if (since) {
        invoices = invoices
        .where('invoices.updatedAt', '>=', since)
      }

      debug('invoices since ' + since)

    var found = await invoices
    debug('invoices: ' + JSON.stringify(found))
    return res.send({invoices: found})
  })
);


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
  ah(async (req, res) => {
    const {type, since} = req.query

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

      if (since) {
        deposits = deposits
        .where('deposits.updatedAt', '>=', since)
      }

      debug('deposits since ' + since)

    var found = await deposits
    debug('deposits: ' + JSON.stringify(found))
    return res.send({deposits: found})
  })
);

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
  ah(async (req, res) => {
    const {type, since} = req.query

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

      if (since) {
        withdrawals = withdrawals
        .where('withdrawals.updatedAt', '>=', since)
      }

      debug('withdrawals since ' + since)

    var found = await withdrawals
    debug('withdrawals: ' + JSON.stringify(found))
    return res.send({withdrawals: found})
  })
);

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
  ah(async (req, res) => {
    const {type, since} = req.query

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

      if (since) {
        payments = payments
        .where('payments.updatedAt', '>=', since)
      }

      debug('payments since ' + since)

    var found = await payments
    debug('payments: ' + JSON.stringify(found))
    return res.send({payments: found})
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
