db = require("redis").createClient()
bcrypt = require('bcrypt')

module.exports = (sessions) ->
  exists: (req, res) ->
    db.hgetall(req.params.user, (err, obj) ->
      if obj? then res.write('true') else res.write('false')
      res.end()
    )

  new: (req, res) ->
    res.render('users/new', 
      js: (-> global.js), 
      css: (-> global.css),
    )

  create: (req, res) ->
    db.hgetall(req.body.username, (err, obj) ->
      if obj
        res.redirect(req.body.username)
      else
        bcrypt.hash(req.body.password, 12, (err, hash) ->
          db.hmset(
            req.body.username, 
            {username: req.body.username, password: hash},
            ->
              req.headers['referer'] = "/#{req.body.username}/edit"
              sessions.create(req, res)
          )
        )
    )
