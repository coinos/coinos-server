<template lang="pug">
nav.navbar(role='navigation')
  button.btn.btn-primary.navbar-toggle(type='button', data-toggle='collapse', data-target='#nav')
    span.pull-right.glyphicon.glyphicon-list
    span#connection.pull-right.glyphicon.glyphicon-exclamation-sign
  #nav.collapse.navbar-collapse.no-transition
    .navbar
      ul.nav.navbar-nav
        li
          a(href='/{{user}}')
            span.glyphicon.glyphicon-home
            |  Home
        li
          a(href='/{{user}}/report')
            span.glyphicon.glyphicon-list-alt
            |  Sales
        li
          a(href='/{{user}}/wallet')
            span.fa.fa-bank
            |  Wallet
        li
          a(href='/{{user}}/profile')
            span.glyphicon.glyphicon-user
            |  Account
        li
          a(href='/{{user}}/edit')
            span.glyphicon.glyphicon-cog
            |  Settings
        li
          a(href='/logout')
            span.glyphicon.glyphicon-off
            |  Logout
</template>
