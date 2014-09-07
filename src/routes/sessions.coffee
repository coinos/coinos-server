module.exports = (passport) ->
  new: (req, res) ->
    res.render('sessions/new', 
      layout: 'layout',
      js: (-> global.js), 
      css: (-> global.css)
    )

  create: (req, res, next) ->
    passport.authenticate('local', (err, user, info) ->
      if (err)
        return next(err)
      if (!user) 
        return res.render('sessions/new', 
          layout: 'layout',  
          js: (-> global.js), 
          css: (-> global.css),
          badpw: true
        )
      req.login(user, (err) ->
        if (err) 
          return next(err)

        re = new RegExp(user.username, 'g')
        if req.session.redirect? and re.test(req.session.redirect)
          url = req.session.redirect 

        url ?= "/#{user.username}"
        delete req.session.redirect
        return res.redirect(url)
      )
    )(req, res, next)

  destroy: (req, res) ->
    req.logout()
    res.redirect('/login')
