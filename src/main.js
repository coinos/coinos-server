// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from 'vue'
import VueRouter from 'vue-router'
import App from './App'
import SignIn from './components/SignIn'
import Sales from './components/Sales'

const routes = [
  { path: '/', component: SignIn },
  { path: '/sales', component: Sales }
]

const router = new VueRouter({
  routes // short for routes: routes
})

Vue.use(VueRouter)

/* eslint-disable no-new */
new Vue({
  el: '#app',
  template: '<app/>',
  components: { App },
  router: router
})

