(function() {
  var bcrypt, db;

  db = require("./redis");

  bcrypt = require('bcrypt');

  db.get("user:admin", function(err, res) {
    if (!res) {
      return bcrypt.hash('admin', 12, function(err, hash) {
        db.sadd("users", "user:admin");
        return db.hmset("user:admin", {
          username: 'admin',
          password: hash
        }, function() {
          return console.log("Created admin user with password 'admin'");
        });
      });
    }
  });

  db.sismember("mts", "mt:rest", function(err, res) {
    if (!res) {
      db.hmset("mt:rest", {
        code: "rest",
        label: "Restaurant/Bar"
      }, function() {
        return db.sadd("mts", "mt:rest");
      });
      db.hmset("mt:coff", {
        code: "rest",
        label: "Coffee Shop"
      }, function() {
        return db.sadd("mts", "mt:coff");
      });
      return console.log("Added merchant types");
    }
  });

}).call(this);
