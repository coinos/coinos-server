import { resolver, defaultArgs, defaultListArgs, attributeFields } from 'graphql-sequelize'
import {
    graphql,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLInputObjectType,
    GraphQLString,
    GraphQLInt,
    GraphQLNonNull,
    GraphQLList
} from 'graphql'

module.exports = (db, fields, types, options) => {
  options.after = (results, args) => {
    return results.sort((a, b) => {
      if (a.name === b.name) return 0
      return a.name > b.name ? 1 : -1
    })
  }

  db['User'].Membership = db['User'].hasOne(db['Membership'])

  db['RoleMap'].Users = db['RoleMap'].belongsToMany(db['User'], {
    as: 'users',
    through: db['UserRoles'],
    foreignKey: 'roleId',
    otherKey: 'userId'
  })

  db['User'].Roles = db['User'].belongsToMany(db['RoleMap'], {
    as: 'roles',
    through: db['UserRoles'],
    foreignKey: 'userId',
    otherKey: 'roleId'
  })

  fields.programs = {
    type: new GraphQLList(types['rolemap']),
    resolve: resolver(db['User'].Roles)
  }

  fields.membership = {
    type: types['my_aspnet_membership'],
    resolve: resolver(db['User'].Membership)
  }
}
