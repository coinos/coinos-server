(function() {
  var bcrypt, db;

  db = require("../redis");

  bcrypt = require('bcrypt');

  module.exports = function(sessions) {
    return {
      exists: function(req, res) {
        return db.hgetall("user:" + req.params.user, function(err, obj) {
          if (obj != null) {
            res.write('true');
          } else {
            res.write('false');
          }
          return res.end();
        });
      },
      json: function(req, res) {
        return db.hgetall("user:" + req.params.user, function(err, obj) {
          delete obj['password'];
          res.writeHead(200, {
            "Content-Type": "application/json"
          });
          res.write(JSON.stringify(obj));
          return res.end();
        });
      },
      show: function(req, res) {
        return db.hgetall("user:" + req.params.user, function(err, obj) {
          if (obj) {
            return res.render('users/show', {
              user: req.params.user,
              layout: 'layout',
              navigation: true,
              js: (function() {
                return global.js;
              }),
              css: (function() {
                return global.css;
              })
            });
          } else {
            return res.render('sessions/new', {
              notice: true,
              layout: 'layout',
              js: (function() {
                return global.js;
              }),
              css: (function() {
                return global.css;
              })
            });
          }
        });
      },
      "new": function(req, res) {
        return res.render('users/new', {
          layout: 'layout',
          js: (function() {
            return global.js;
          }),
          css: (function() {
            return global.css;
          })
        });
      },
      create: function(req, res) {
        var errormsg, userkey;
        errormsg = "";
        userkey = "user:" + req.body.username;
        return db.hgetall(userkey, function(err, obj) {
          if (obj) {
            return res.redirect(req.body.username);
          } else {
            if (req.body.confirm !== req.body.password) {
              errormsg += "Passwords must match";
              return res.render('users/new', {
                layout: 'layout',
                js: (function() {
                  return global.js;
                }),
                css: (function() {
                  return global.css;
                }),
                error: errormsg
              });
            }
            return bcrypt.hash(req.body.password, 12, function(err, hash) {
              db.sadd("users", userkey);
              return db.hmset(userkey, {
                username: req.body.username,
                password: hash,
                email: req.body.email
              }, function() {
                req.headers['referer'] = "/" + req.body.username + "/edit";
                return sessions.create(req, res);
              });
            });
          }
        });
      },
      edit: function(req, res) {
        return res.render('users/edit', {
          user: req.params.user,
          layout: 'layout',
          navigation: true,
          js: (function() {
            return global.js;
          }),
          css: (function() {
            return global.css;
          })
        });
      },
      update: function(req, res) {
        if (req.body.password === '') {
          delete req.body.password;
        }
        return db.hmset("user:" + req.params.user, req.body, function() {
          if (req.body.password == null) {
            return res.redirect("/" + req.params.user);
          } else {
            return bcrypt.hash(req.body.password, 12, function(err, hash) {
              return db.hmset("user:" + req.params.user, {
                password: hash
              }, function() {
                return res.redirect("/" + req.params.user);
              });
            });
          }
        });
      }
    };
  };

}).call(this);
