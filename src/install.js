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
          console.log("Created admin user with password 'admin'");
          return process.exit();
        });
      });
    }
  });

}).call(this);
