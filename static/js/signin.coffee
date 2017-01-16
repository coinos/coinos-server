$(->
  $('#register').click(->
    window.location.href = '/register'
    $(this).preventDefault()
  )
)
