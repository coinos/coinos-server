import Sequelize from "@sequelize/core";
import config from "$config";

let { database, user, password, options } = config.db;
export default new Sequelize(database, user, password, options);
