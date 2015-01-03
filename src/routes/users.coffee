db = require("../redis")
config = require("../config")
bcrypt = require('bcrypt')

module.exports = (sessions) ->
  exists: (req, res) ->
    db.hgetall("user:"+req.params.user, (err, obj) ->
      if obj? then res.write('true') else res.write('false')
      res.end()
    )
  
  json: (req, res) ->
    db.llen("#{req.params.user}:transactions", (err, len) ->
      db.hgetall("user:#{req.params.user}", (err, obj) ->
        delete obj['password']
        obj['index'] = len
        res.writeHead(200, {"Content-Type": "application/json"});
        res.write(JSON.stringify(obj))
        res.end()
      )
    )

  show: (req, res) ->
    db.hgetall("user:"+req.params.user, (err, obj) ->
      if obj 
        options = 
          user: req.params.user, 
          layout: 'layout',
          navigation: true,
          js: (-> global.js), 
          css: (-> global.css)

        if req.query.verified?
          options.verified = true

        res.render('users/show', options)
        delete req.session.verified
      else 
        res.render('sessions/new', 
          notice: true,
          layout: 'layout',
          js: (-> global.js), 
          css: (-> global.css)
        )
    )

  new: (req, res) ->
    res.render('users/new', 
      layout: 'layout',
      js: (-> global.js), 
      css: (-> global.css)
    )

  create: (req, res) ->
    errormsg = ""
    userkey = "user:"+req.body.username
    db.hgetall(userkey, (err, obj) ->
      if obj
        errormsg += "Username exists"

      if req.body.confirm != req.body.password
        errormsg += "Passwords must match"

      if errormsg
        return res.render('users/new',
          layout: 'layout',
          js: (-> global.js), 
          css: (-> global.css),
          error: errormsg
        )

      bcrypt.hash(req.body.password, 12, (err, hash) ->
         db.sadd("users",userkey)
         db.hmset(userkey,
           username: req.body.username,
           password: hash,
           email: req.body.email,
           pubkey: req.body.pubkey,
           privkey: req.body.privkey
          , ->
            req.session.redirect = "/#{req.body.username}/edit"
            sessions.create(req, res)
         )
      )

      if process.env.NODE_ENV is 'production'
        require('crypto').randomBytes(48, (ex, buf) ->
          token = buf.toString('base64').replace(/\//g,'').replace(/\+/g,'')
          db.set("token:#{token}", req.body.username)
          host = req.hostname
          host += ':3000' if host is 'localhost'
          url = "#{req.protocol}://#{host}/verify/#{token}"

          res.render('users/welcome', 
            user: req.params.user, 
            layout: 'mail',
            url: url,
            privkey: req.body.privkey,
            js: (-> global.js), 
            css: (-> global.css),
            (err, html) ->
              sendgrid = require('sendgrid')(config.sendgrid_user, config.sendgrid_password)

              email = new sendgrid.Email(
                to: req.body.email
                from: 'adam@coinos.io'
                subject: 'Welcome to CoinOS'
                html: html
              )

              sendgrid.send(email)
          )
        )
    )

  edit: (req, res) ->
    res.render('users/edit', 
      user: req.params.user, 
      layout: 'layout',
      navigation: true,
      js: (-> global.js), 
      css: (-> global.css)
    )

  profile: (req, res) ->
    res.render('users/profile', 
      user: req.params.user, 
      layout: 'layout',
      navigation: true,
      js: (-> global.js), 
      css: (-> global.css)
    )

  update: (req, res) ->
    if req.body.password is ''
      delete req.body.password

    if req.body.privkey is ''
      delete req.body.privkey

    db.hmset("user:"+req.params.user, req.body, ->
      if req.body.password?
        bcrypt.hash(req.body.password, 12, (err, hash) ->
          db.hmset("user:#{req.params.user}", password: hash, ->
            res.redirect("/#{req.params.user}")
          )
        )
      else
        res.redirect("/#{req.params.user}")
    )

    if process.env.NODE_ENV is 'production' and 
    req.body.privkey? and 
    req.body.privkey != '' and 
    req.body.email != ''
      res.render('users/key', 
        user: req.params.user, 
        layout: 'mail',
        key: req.body.privkey,
        js: (-> global.js), 
        css: (-> global.css),
        (err, html) ->
          sendgrid = require('sendgrid')(config.sendgrid_user, config.sendgrid_password)

          email = new sendgrid.Email(
            to: req.body.email
            from: 'adam@coinos.io'
            subject: 'CoinOS Wallet Key'
            html: html
          )

          sendgrid.send(email)
      )

  verify: (req, res) ->
    db.get("token:#{req.params.token}", (err, reply) ->
      if err or !reply
        res.write("Invalid Verification Token")
        res.end()
      else
        db.hset("user:#{reply.toString()}", "verified", "true", ->
          res.redirect("/#{reply.toString()}?verified")
        )
    )
