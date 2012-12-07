db = require("redis").createClient()
bcrypt = require('bcrypt')

module.exports =
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
    bcrypt.hash(req.body.password, 12, (err, hash) ->
      req.body.password = hash
      db.hmset(req.body.username, req.body, ->
       res.redirect(req.body.username)
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
