(function() {
  var Promise, settings;

  Promise = require('bluebird');

  settings = {
    port: 6379,
    host: '127.0.0.1'
  };

  module.exports = Promise.promisifyAll(require('redis')).createClient(settings.port, settings.host);

}).call(this);
