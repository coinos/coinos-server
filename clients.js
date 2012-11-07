var http = require('http');
var mysql = require('mysql');
var url = require('url');

http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  var client = url.parse(req.url, true).query.client;

  var connection = mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : 'MPJzfq97',
    database:  'vanbtc'
  });

  connection.connect();
  connection.query("SELECT * FROM users WHERE login = ?", [client], function(err, rows) {
    res.write(JSON.stringify(rows));
    connection.end();
    res.end();
  });
}).listen(8000);
