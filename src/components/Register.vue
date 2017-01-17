<template lang="pug">
#main-logo
form#register(action='/users', method='post')
  | {{#error}}
  .alert.alert-danger {{error}}
  |  {{/error}}
  .form-group
    label(for='username') Username:
    |  
    input#username.form-control(type='text', name='username')
  .form-group
    label(for='email') Email:
    |  
    input#email.form-control(type='text', name='email')
  .form-group
    label(for='password') Passphrase:
    |  
    input#password.form-control(type='password', name='password')
    #messages
  .form-group
    label(for='confirm') Confirm Passphrase:
    |  
    input#confirm.form-control(type='password', name='confirm')
  |  
  input#commission(name='commission', type='hidden', value='0')
  |  
  input#unit(name='unit', type='hidden', value='BTC')
  |  
  input#pubkey(name='pubkey', type='hidden')
  |  
  input#privkey(name='privkey', type='hidden')
  |  
  input.btn.btn-primary(type='submit', value='Register')
#qr
</template>
