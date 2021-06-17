// Update with your config settings.

module.exports = {

  development: {
    client: 'mysql2',
    connection: {
      host: 'mariadb',
      database: 'coinos',
      user:     'tester',
      password: 'pass'
    }
  },

  staging: {
    client: 'mysql2',
    connection: {
      database: 'coinos_stage',
      user:     'staging_user',
      password: 'pass'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'mysql2',
    connection: {
      database: 'coinos',
      user:     'webuser',
      password: 'pass'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }

};
