(function() {
  $(function() {
    var e, key, pk;
    pk = '5HseCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';
    try {
      key = Bitcoin.ECKey.fromWIF(pk);
      return $('body').append(key.pub.getAddress().toString());
    } catch (_error) {
      e = _error;
      return console.log(e);
    }
  });

}).call(this);
