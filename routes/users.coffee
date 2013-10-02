db = require("redis").createClient()
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
    userkey = "user:"+req.body.username
    db.hgetall(userkey, (err, obj) ->
      if obj
        res.redirect(req.body.username)
      else
        bcrypt.hash(req.body.password, 12, (err, hash) ->
          db.sadd("users",userkey)
          db.hmset(
            userkey, 
            {   
                username: req.body.username, 
                password: hash, 
                email: req.body.email,
                firstname: req.body.firstname,
                lastname: req.body.lastname,
                company: req.body.company,
                email: req.body.email,
                phone: req.body.phone,
                companytype: req.body.companytype,
                address1: req.body.address1,
                address2: req.body.address2,
                city: req.body.city,
                postcode: req.body.postcode,
                state: req.body.state,
                country: req.body.country,
                web: req.body.web
            }
            ,
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
    db.hmset("user:"+req.params.user, req.body, ->
     res.redirect("/#{req.params.user}")
    )
