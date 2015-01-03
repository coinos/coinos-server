(function() {
  var bcrypt, config, db;

  db = require("../redis");

  config = require("../config");

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
        return db.llen("" + req.params.user + ":transactions", function(err, len) {
          return db.hgetall("user:" + req.params.user, function(err, obj) {
            delete obj['password'];
            obj['index'] = len;
            res.writeHead(200, {
              "Content-Type": "application/json"
            });
            res.write(JSON.stringify(obj));
            return res.end();
          });
        });
      },
      show: function(req, res) {
        return db.hgetall("user:" + req.params.user, function(err, obj) {
          var options;
          if (obj) {
            options = {
              user: req.params.user,
              layout: 'layout',
              navigation: true,
              js: (function() {
                return global.js;
              }),
              css: (function() {
                return global.css;
              })
            };
            if (req.query.verified != null) {
              options.verified = true;
            }
            res.render('users/show', options);
            return delete req.session.verified;
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
            errormsg += "Username exists";
          }
          if (req.body.confirm !== req.body.password) {
            errormsg += "Passwords must match";
          }
          if (errormsg) {
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
          bcrypt.hash(req.body.password, 12, function(err, hash) {
            db.sadd("users", userkey);
            return db.hmset(userkey, {
              username: req.body.username,
              password: hash,
              email: req.body.email,
              pubkey: req.body.pubkey,
              privkey: req.body.privkey
            }, function() {
              req.session.redirect = "/" + req.body.username + "/edit";
              return sessions.create(req, res);
            });
          });
          if (process.env.NODE_ENV === 'production') {
            return require('crypto').randomBytes(48, function(ex, buf) {
              var host, token, url;
              token = buf.toString('base64').replace(/\//g, '').replace(/\+/g, '');
              db.set("token:" + token, req.body.username);
              host = req.hostname;
              if (host === 'localhost') {
                host += ':3000';
              }
              url = "" + req.protocol + "://" + host + "/verify/" + token;
              return res.render('users/welcome', {
                user: req.params.user,
                layout: 'mail',
                url: url,
                privkey: req.body.privkey,
                js: (function() {
                  return global.js;
                }),
                css: (function() {
                  return global.css;
                })
              }, function(err, html) {
                var email, sendgrid;
                sendgrid = require('sendgrid')(config.sendgrid_user, config.sendgrid_password);
                email = new sendgrid.Email({
                  to: req.body.email,
                  from: 'adam@coinos.io',
                  subject: 'Welcome to CoinOS',
                  html: html
                });
                return sendgrid.send(email);
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
      profile: function(req, res) {
        return res.render('users/profile', {
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
        if (req.body.privkey === '') {
          delete req.body.privkey;
        }
        db.hmset("user:" + req.params.user, req.body, function() {
          if (req.body.password != null) {
            return bcrypt.hash(req.body.password, 12, function(err, hash) {
              return db.hmset("user:" + req.params.user, {
                password: hash
              }, function() {
                return res.redirect("/" + req.params.user);
              });
            });
          } else {
            return res.redirect("/" + req.params.user);
          }
        });
        if (process.env.NODE_ENV === 'production' && (req.body.privkey != null) && req.body.privkey !== '' && req.body.email !== '') {
          return res.render('users/key', {
            user: req.params.user,
            layout: 'mail',
            key: req.body.privkey,
            js: (function() {
              return global.js;
            }),
            css: (function() {
              return global.css;
            })
          }, function(err, html) {
            var email, sendgrid;
            sendgrid = require('sendgrid')(config.sendgrid_user, config.sendgrid_password);
            email = new sendgrid.Email({
              to: req.body.email,
              from: 'adam@coinos.io',
              subject: 'CoinOS Wallet Key',
              html: html
            });
            return sendgrid.send(email);
          });
        }
      },
      verify: function(req, res) {
        return db.get("token:" + req.params.token, function(err, reply) {
          if (err || !reply) {
            res.write("Invalid Verification Token");
            return res.end();
          } else {
            return db.hset("user:" + (reply.toString()), "verified", "true", function() {
              return res.redirect("/" + (reply.toString()) + "?verified");
            });
          }
        });
      }
    };
  };

}).call(this);
