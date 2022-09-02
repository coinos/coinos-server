import Sequelize from '@sequelize/core';
import dbOptions from '../config/knexfile.js';

let { database, user, password, host } = dbOptions[process.env.NODE_ENV].connection;
 
export default new Sequelize(
  database,
  user,
  password,
  {
    host,
    dialect: "mariadb",
    logging: false,
    dialectOptions: { multipleStatements: true, timezone: "Etc/GMT+7" },
  }
);

