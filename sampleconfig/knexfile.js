// Update with your config settings.

module.exports = {
  development: {
    client: 'mysql2',
    connection: {
      host: 'mariadb',
      database: 'coinos',
      user:     'root',
      password: 'SetASecurePasswordHere'
    },
    migrations: {
      tableName: 'migrations',
      directory: 'migrations'
    }
  },
};
