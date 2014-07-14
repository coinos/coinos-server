db = require("../redis")
bcrypt = require('bcrypt')

module.exports = (sessions) ->
  exists: (req, res) ->
    db.hgetall("user:"+req.params.user, (err, obj) ->
      if obj? then res.write('true') else res.write('false')
      res.end()
    )
  
  json: (req, res) ->
    db.hgetall("user:"+req.params.user, (err, obj) ->
      delete obj['password']
      res.writeHead(200, {"Content-Type": "application/json"});
      res.write(JSON.stringify(obj))
      res.end()
    )

  index: (req, res) -> 
    return
    db.keys('*', (err, obj) ->
      res.write(JSON.stringify(obj))
      res.end()
    )

  list: (req, res) ->
    res.render('users/index', 
      js: (-> global.js), 
      css: (-> global.css),
      layout: 'layout'
    )

  show: (req, res) ->
    db.hgetall("user:"+req.params.user, (err, obj) ->
      if obj 
        res.render('calculator/show', 
          user: req.params.user, 
          js: (-> global.js), 
          css: (-> global.css) 
        )
      else 
        res.render('sessions/new', 
          js: (-> global.js), 
          css: (-> global.css),
          notice: true
        )
    )

  new: (req, res) ->
    res.render('users/new', 
      js: (-> global.js), 
      css: (-> global.css)
    )

  create: (req, res) ->
    errormsg = ""
    userkey = "user:"+req.body.username
    db.hgetall(userkey, (err, obj) ->
      if obj
        res.redirect(req.body.username)
      else
        if req.body.confirm != req.body.password
          errormsg += "Passwords must match"
          return res.render('users/new',
            js: (-> global.js), 
            css: (-> global.css),
            error: errormsg
          )

        bcrypt.hash(req.body.password, 12, (err, hash) ->
           db.sadd("users",userkey)
           db.hmset(userkey,
             username: req.body.username,
             password: hash,
             email: req.body.email
            , ->
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
    req.user.username is 'admin' or req.user.username is 'ben'
    if req.body.password is ''
      delete req.body.password
    db.hmset("user:"+req.params.user, req.body, ->
      if not req.body.password?
        res.redirect("/#{req.params.user}")
      else
        bcrypt.hash(req.body.password, 12, (err, hash) ->
          db.hmset("user:"+req.params.user,password: hash, ->
            res.redirect("/#{req.params.user}")
          )
        )
    )
