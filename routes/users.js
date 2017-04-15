const Promise = require('bluebird')
const db = require("../redis")
const config = require("../config")
const bcrypt = require('bcryptjs')
const fs = require('fs')
const request = require('request')

module.exports = {
  login (req, res) {
    if(req.body.name && req.body.password){
      var name = req.body.name
      var password = req.body.password
    }
    var user = db[_.findIndex(db, {name: name})]

    if( ! user ){
      res.status(401).json({message:"no such user found"})
      return 
    }

    if(user.password === req.body.password) {
      var payload = {id: user.id}
      var token = jwt.sign(payload, process.env.SECRET)
      res.json({message: "ok", token: token})
    } else {
      res.status(401).json({message:"passwords did not match"})
    }
  },
  secret (req, res) {
    res.json({message: "Success! You can not see this without a token"})
  },
  exists: function(req, res) {
    return db.hgetall("user:" + req.params.user.toLowerCase(), function(err, obj) {
      if (obj != null) {
        res.write('true')
      } else {
        res.write('false')
      }
      return res.end()
    })
  },
  index: function(req, res) {
    var result
    result = {
      'users': []
    }
    return db.keysAsync("user:*").then(function(users) {
      return Promise.all(users.map(function(key) {
        return db.hgetallAsync(key).then(function(user) {
          delete user['password']
          return result.users.push(user)
        })
      }))
    }).then(function() {
      res.status(200).json(JSON.stringify(result))
    })
  },
  json: function(req, res) {
    if (!req.params.user) {
      res.end()
    }
    return db.llen((req.params.user.toLowerCase()) + ":transactions", function(err, len) {
      return db.hgetall("user:" + (req.params.user.toLowerCase()), function(err, obj) {
        delete obj['password']
        obj['index'] = len
        res.status(200).json(JSON.stringify(obj))
        return res.end()
      })
    })
  },
  create: function(req, res) {
    const userkey = "user:" + req.body.username

    db.hgetallAsync(userkey).then((obj) => {
      if (obj) {
        error = { message: 'User exists' }
        res.status(400).json(error) 
        throw error
      }
    }).then(() => {
      if (req.body.passconfirm !== req.body.password) {
        error = { message: 'Passwords must match' }
        res.status(400).json(error) 
        throw error
      }

      bcrypt.hash(req.body.password, 12, function(err, hash) {
        db.sadd("users", userkey)
        db.hmset(userkey, {
          username: req.body.username,
          password: hash,
          email: req.body.email,
          commission: req.body.commission || '',
          unit: req.body.unit || 'CAD',
          pubkey: req.body.pubkey || '',
          privkey: req.body.privkey || ''
        }, function() {
          res.status(200)
          require('crypto').randomBytes(48, function(ex, buf) {
            const token = buf.toString('base64').replace(/\//g, '').replace(/\+/g, '')
            db.set("token:" + token, req.body.username)
            host = req.get('Host')
            url = req.protocol + "://" + host + "/verify/" + token
            const helper = require('sendgrid').mail
            const from_email = new helper.Email('info@coinos.io')
            const to_email = new helper.Email(req.body.email)
            const subject = 'Welcome to CoinOS'
            const content = new helper.Content('text/html', req.body.privkey)
            const mail = new helper.Mail(from_email, subject, to_email, content)
            const sg = require('sendgrid')(config.sendgrid_token)
            const ereq = sg.emptyRequest({
              method: 'POST',
              path: '/v3/mail/send',
              body: mail.toJSON()
            })
            sg.API(ereq, function(error, response) {
              console.log(response.statusCode)
              console.log(response.body)
              console.log(response.headers)
            })
          })
        })
      })
    }).catch((e) => {})
  },
  update: function(req, res) {
    if (req.body.password === '') {
      delete req.body.password
    }
    db.hmset("user:" + req.params.user.toLowerCase(), req.body, function() {
      req.session.user = req.body
      delete req.session.user.password
      if (req.body.password != null) {
        bcrypt.hash(req.body.password, 12, function(err, password) {
          db.hmset("user:" + (req.params.user.toLowerCase()), {
            email: email,
            password: password,
            phone: phone
          }, function() {
            res.status(200).json({ message: 'User updated' })
          })
        })
      } else {
        res.status(200).json({ message: 'User updated' })
      }
    })
    if (process.env.NODE_ENV === 'production' &&
       (req.body.privkey != null) && 
       req.body.privkey !== '' && 
       req.body.email !== '') 
    {
      const helper = require('sendgrid').mail
      const from_email = new helper.Email('info@coinos.io')
      const to_email = new helper.Email(req.body.email)
      const subject = 'CoinOS Wallet Key'
      const content = new helper.Content('text/html', req.body.privkey)
      const mail = new helper.Mail(from_email, subject, to_email, content)
      const sg = require('sendgrid')(config.sendgrid_token)
      const ereq = sg.emptyRequest({
        method: 'POST',
        path: '/v3/mail/send',
        body: mail.toJSON()
      })
      sg.API(ereq, function(err, res) {
        if (err) {
          console.log(error)
        }
      })
    }
  },
  verify: function(req, res) {
    return db.get("token:" + req.params.token, function(err, reply) {
      if (err || !reply) {
        res.write("Invalid Verification Token")
        return res.end()
      } else {
        db.hset("user:" + (reply.toString()), "verified", "true", function() {
          res.status(200)
        })
      }
    })
  }
}
