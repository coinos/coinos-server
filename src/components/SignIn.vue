<template lang="pug">
div
  #main-logo
  p.alert.alert-danger Invalid username or password, please try again.
  form.form-signin(action='login', method='post')
    input.form-control(name='username', type='text', placeholder='Username', value='user', required='', autofocus='')
    br
    |  
    input.form-control(name='password', type='password', placeholder='Password', required='')
    br
    |  
    button.btn.btn-lg.btn-primary.btn-block(type='submit') Sign in
  p
    button#register.btn.btn-lg.btn-secondary.btn-block Register
  p
    a(href='http://bitcoincoop.org/coinos') What is this?
</template>

<script>
export default {
  name: 'home'
}
</script>

<style lang="stylus">
  #main-logo
      margin-bottom 15px

  .form-signin
      margin-bottom 10px
      .form-control
          height auto
          -webkit-box-sizing border-box
          -moz-box-sizing border-box
          box-sizing border-box
          padding 10px
          font-size 16px

  .notice
      border 1px solid gray
      background #eee
      padding 10px
      margin-bottom 15px
</style>
