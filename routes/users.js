(function() {
  var Promise, bcrypt, config, db, fs, request;

  Promise = require('bluebird');

  db = require("../redis");

  config = require("../config");

  bcrypt = require('bcryptjs');

  fs = require('fs');

  request = require('request');

  module.exports = function(sessions) {
    return {
      exists: function(req, res) {
        return db.hgetall("user:" + req.params.user.toLowerCase(), function(err, obj) {
          if (obj != null) {
            res.write('true');
          } else {
            res.write('false');
          }
          return res.end();
        });
      },
      index: function(req, res) {
        var result;
        result = {
          'users': []
        };
        return db.keysAsync("user:*").then(function(users) {
          return Promise.all(users.map(function(key) {
            return db.hgetallAsync(key).then(function(user) {
              delete user['password'];
              return result.users.push(user);
            });
          }));
        }).then(function() {
          res.writeHead(200, {
            "Content-Type": "application/json"
          });
          res.write(JSON.stringify(result));
          return res.end();
        });
      },
      json: function(req, res) {
        if (!req.params.user) {
          res.end();
        }
        return db.llen((req.params.user.toLowerCase()) + ":transactions", function(err, len) {
          return db.hgetall("user:" + (req.params.user.toLowerCase()), function(err, obj) {
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
        return db.hgetall("user:" + req.params.user.toLowerCase(), function(err, obj) {
          var ext, options, path;
          if (obj) {
            options = {
              user: req.params.user.toLowerCase(),
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
            if (obj.logo && obj.logo.length > 3) {
              ext = obj.logo.substr(obj.logo.length - 3);
              path = "public/img/logos/" + obj.username + "." + ext;
              fs.lstat(path, function(err, stats) {
                if ((ext === 'jpg' || ext === 'png' || ext === 'gif') && (err || !stats.isFile())) {
                  try {
                    return request("" + obj.logo).pipe(fs.createWriteStream(path));
                  } catch (undefined) {}
                }
              });
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
              commission: req.body.commission,
              unit: req.body.unit,
              pubkey: req.body.pubkey,
              privkey: req.body.privkey
            }, function() {
              req.session.redirect = "/" + req.body.username + "/edit";
              return sessions.create(req, res);
            });
          });
          return require('crypto').randomBytes(48, function(ex, buf) {
            var host, token, url;
            token = buf.toString('base64').replace(/\//g, '').replace(/\+/g, '');
            db.set("token:" + token, req.body.username);
            host = req.hostname;
            if (host === 'localhost') {
              host += ':3000';
            }
            url = req.protocol + "://" + host + "/verify/" + token;
            return res.render('users/welcome', {
              user: req.body.username.toLowerCase(),
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
              var content, from_email, helper, mail, sg, subject, to_email;
              helper = require('sendgrid').mail;
              from_email = new helper.Email('info@coinos.io');
              to_email = new helper.Email(req.body.email);
              subject = 'Welcome to CoinOS';
              content = new helper.Content('text/html', html);
              mail = new helper.Mail(from_email, subject, to_email, content);
              sg = require('sendgrid')(config.sendgrid_token);
              request = sg.emptyRequest({
                method: 'POST',
                path: '/v3/mail/send',
                body: mail.toJSON()
              });
              return sg.API(request, function(error, response) {
                console.log(response.statusCode);
                console.log(response.body);
                return console.log(response.headers);
              });
            });
          });
        });
      },
      edit: function(req, res) {
        return res.render('users/edit', {
          user: req.params.user.toLowerCase(),
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
          user: req.params.user.toLowerCase(),
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
        db.hmset("user:" + req.params.user.toLowerCase(), req.body, function() {
          req.session.user = req.body;
          delete req.session.user.password;
          if (req.body.password != null) {
            return bcrypt.hash(req.body.password, 12, function(err, hash) {
              return db.hmset("user:" + (req.params.user.toLowerCase()), {
                password: hash
              }, function() {
                if (req.xhr) {
                  res.send({});
                  return res.end();
                } else {
                  return res.redirect("/" + (req.params.user.toLowerCase()));
                }
              });
            });
          } else {
            if (req.xhr) {
              res.send({});
              return res.end();
            } else {
              return res.redirect("/" + (req.params.user.toLowerCase()));
            }
          }
        });
        if (process.env.NODE_ENV === 'production' && (req.body.privkey != null) && req.body.privkey !== '' && req.body.email !== '') {
          return res.render('users/key', {
            user: req.params.user.toLowerCase(),
            layout: 'mail',
            key: req.body.privkey,
            js: (function() {
              return global.js;
            }),
            css: (function() {
              return global.css;
            })
          }, function(err, html) {
            var content, from_email, helper, mail, sg, subject, to_email;
            helper = require('sendgrid').mail;
            from_email = new helper.Email('info@coinos.io');
            to_email = new helper.Email(req.body.email);
            subject = 'CoinOS Wallet Key';
            content = new helper.Content('text/html', html);
            mail = new helper.Mail(from_email, subject, to_email, content);
            sg = require('sendgrid')(config.sendgrid_token);
            request = sg.emptyRequest({
              method: 'POST',
              path: '/v3/mail/send',
              body: mail.toJSON()
            });
            return sg.API(request, function(error, response) {
              console.log(response.statusCode);
              console.log(response.body);
              return console.log(response.headers);
            });
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
      },
      wallet: function(req, res) {
        return res.render('users/wallet', {
          user: req.params.user.toLowerCase(),
          layout: 'layout',
          navigation: true,
          js: (function() {
            return global.js;
          }),
          css: (function() {
            return global.css;
          })
        });
      }
    };
  };

}).call(this);
