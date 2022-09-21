// Update with your config settings.

export default {
  development: {
    client: "mysql2",
    connection: {
      host: "maria",
      database: "coinos",
      user: "root",
      password: "password"
    },
    migrations: {
      tableName: "migrations",
      directory: "migrations"
    }
  }
};
