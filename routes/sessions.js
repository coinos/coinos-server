(function() {
  module.exports = function(passport) {
    return {
      "new": function(req, res) {
        return res.render('sessions/new', {
          layout: 'layout',
          js: (function() {
            return global.js;
          }),
          css: (function() {
            return global.css;
          })
        });
      },
      create: function(req, res, next) {
        return passport.authenticate('local', function(err, user, info) {
          if (err) {
            return next(err);
          }
          if (!user) {
            return res.render('sessions/new', {
              layout: 'layout',
              js: (function() {
                return global.js;
              }),
              css: (function() {
                return global.css;
              }),
              badpw: true
            });
          }
          return req.login(user, function(err) {
            var re, url;
            if (err) {
              return next(err);
            }
            re = new RegExp(user.username, 'g');
            if ((req.session.redirect != null) && re.test(req.session.redirect)) {
              url = req.session.redirect;
            }
            if (url == null) {
              url = "/" + user.username;
            }
            delete req.session.redirect;
            return res.redirect(url);
          });
        })(req, res, next);
      },
      destroy: function(req, res) {
        req.logout();
        return res.redirect('/login');
      }
    };
  };

}).call(this);
