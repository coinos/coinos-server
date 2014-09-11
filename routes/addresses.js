(function() {
  module.exports = function(sessions) {
    return {
      "new": function(req, res) {
        return res.render('addresses/new', {
          layout: 'layout',
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
