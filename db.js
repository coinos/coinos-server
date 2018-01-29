import config from './config/config.json'
import Sequelize from 'sequelize'
import SequelizeAuto from 'sequelize-auto'
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

const Op = Sequelize.Op
const l = console.log

const auto = new SequelizeAuto(
  config.development.database, 
  config.development.username, 
  config.development.password, 
  config.auto
)
const tables = { 'User': 'Users' }

const db = new Sequelize(
  config.development.database,
  config.development.username,
  config.development.password,
  {
    host: config.development.host,
    dialect: config.development.dialect,
    logging: false, 
    dialectOptions: { multipleStatements: true } 
  },
)
const gqlfields = {}
const gqltypes = {}

const p = new Promise((resolve, reject) => {
  return auto.run(() => {
    Object.keys(tables).forEach((k) => {
      let t = tables[k]
      let fields = {}

      Object.keys(auto.tables[t]).forEach(f => {
        let isKey = f === 'id'
        let rawtype = auto.tables[t][f].type.toLowerCase()
        let type = Sequelize.STRING

        if (rawtype.match(/^int/)) type = Sequelize.INTEGER
        if (rawtype.match(/^date/)) type = Sequelize.DATE

        fields[f] = {
          type: type,
          field: f,
          primaryKey: isKey,
          autoIncrement: isKey,
        }
      })

      db[k] = db.define(k, fields, { tableName: t })

      let typefields = {}
      let options = {}

      gqltypes[t] = new GraphQLObjectType({
        name: t,
        desc: t,
        fields: Object.assign(typefields, attributeFields(db[k])),
      })

      gqlfields[t] = {
        type: new GraphQLList(gqltypes[t]),
        args: Object.assign({}, defaultArgs(db[k]), defaultListArgs()),
        resolve: resolver(db[k], options),
      }
    })

    db.gqlschema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'RootQueryType',
        fields: gqlfields
      }),
    })

    resolve(db)
  })
})

module.exports = p
