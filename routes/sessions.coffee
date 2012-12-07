module.exports = (passport) ->
  new: (req, res) ->
    res.render('sessions/new', 
      js: (-> global.js), 
      css: (-> global.css) 
    )

  create: (req, res, next) ->
    passport.authenticate('local', (err, user, info) ->
      if (err)
        return next(err)
      if (!user) 
        return res.redirect('/login')
      req.login(user, (err) ->
        if (err) 
          return next(err)
        return res.redirect('/' + user.username)
      )
    )(req, res, next)

  destroy: (req, res) ->
    req.logout()
    res.redirect('/login')
