import Vue from 'vue'
import VueRouter from 'vue-router'
import App from './App'
import SignIn from './components/SignIn'
import SignUp from './components/SignUp'
import Sales from './components/Sales'

const routes = [
  { path: '/signin', component: SignIn },
  { path: '/signup', component: SignUp },
  { path: '/sales', component: Sales }
]

const router = new VueRouter({
  routes
})

Vue.use(VueRouter)

/* eslint-disable no-new */
new Vue({
  el: '#app',
  template: '<app/>',
  components: { App },
  router: router
})
