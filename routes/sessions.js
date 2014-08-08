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
            var url;
            if (err) {
              return next(err);
            }
            url = "/" + user.username;
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
