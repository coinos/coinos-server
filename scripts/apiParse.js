var debug = require('debug')('debug')

const addUserSearch = async function (input) {
  debug('add User Search')
  var {search, starts_with, contains} = input

  // if (since) cmd = cmd.havingRaw('invoices + payments + deposits + orders > ?', [0])

  if (search) {
    if (starts_with) {
      search = search + '%'
    } else if (contains) {
      search = '%' + search + '%'
    }

    var condition = "(Users.email like '" + search + " OR Users.username like '" + search + "'"

    debug('condition: ' + condition)
    return condition
  } else {
    return ''
  }
}

const addTimeSearch = async function (input, field) {
  debug('add time Search')
  if (!field) { field = 'updatedAt' }
  
  var {since} = input
  if (since) {
  
    condition = "WHERE " + field + " >= " + since
    debug('condition: ' + condition)

    return condition
  } else {
    return ''
  }
}

module.exports = {addUserSearch: addUserSearch, addTimeSearch: addTimeSearch}

