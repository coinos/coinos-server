(function() {
  var settings;

  settings = {
    port: 6379,
    host: '127.0.0.1'
  };

  module.exports = require('redis').createClient(settings.port, settings.host);

}).call(this);
