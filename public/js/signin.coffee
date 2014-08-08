#= require js/jquery-1.8.2.min.js

$(->
  $('#register').click(->
    window.location.href = '/register'
    $(this).preventDefault()
  )
)
