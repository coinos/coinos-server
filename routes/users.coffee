db = require("redis").createClient()
bcrypt = require('bcrypt')

module.exports = (sessions) ->
  exists: (req, res) ->
    db.hgetall(req.params.user, (err, obj) ->
      if obj? then res.write('true') else res.write('false')
      res.end()
    )
  
  json: (req, res) ->
    db.hgetall(req.params.user, (err, obj) ->
      delete obj['password']
      res.write(JSON.stringify(obj))
      res.end()
    )

  show: (req, res) ->
    res.render('calculator/show', 
      user: req.params.user, 
      js: (-> global.js), 
      css: (-> global.css) 
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

  edit: (req, res) ->
    res.render('calculator/setup', 
      user: req.params.user, 
      js: (-> global.js), 
      css: (-> global.css) 
    )

  update: (req, res) ->
    return unless req.params.user is req.user.username or 
      req.user.username is 'admin'
    db.hmset(req.params.user, req.body, ->
     res.redirect("/#{req.params.user}")
    )
