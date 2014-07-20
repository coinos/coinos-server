(function() {
  $(function() {
    return $('#register').click(function() {
      window.location.href = '/register';
      return $(this).preventDefault();
    });
  });

}).call(this);
