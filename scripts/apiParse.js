var debug = require('debug')('debug')

const addUserSearch = function (input, table) {
  debug('add User Search')
  var {search, starts_with, contains} = input

  if (!table) { table = 'Users' }
  // if (since) cmd = cmd.havingRaw('invoices + payments + deposits + orders > ?', [0])

  if (search) {
    if (starts_with) {
      search = search + '%'
    } else if (contains) {
      search = '%' + search + '%'
    }

    var condition = "(" + table + ".email like '" + search + "' OR " + table + ".username like '" + search + "')"

    debug('condition: ' + condition)
    return condition
  } else {
    return ''
  }
}

const addTimeSearch = function (input, field) {
  debug('add time Search')
  if (!field) { field = 'updatedAt' }
  
  var {since} = input
  if (since) {
  
    condition = field + " >= '" + since + "'"
    debug('condition: ' + condition)

    return condition
  } else {
    return ''
  }
}

module.exports = {
  addUserSearch: addUserSearch, 
  addTimeSearch: addTimeSearch,
}

