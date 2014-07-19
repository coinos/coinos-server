$(->

  pk = '5HseCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'
  try
    key = Bitcoin.ECKey.fromWIF(pk)
    $('body').append(key.pub.getAddress().toString())
  catch e
    console.log(e)

)
