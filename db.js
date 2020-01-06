const config = require("./config");
const Sequelize = require("sequelize");
const SequelizeAuto = require("sequelize-auto");

const conf = config.db[process.env.NODE_ENV || "development"];

const auto = new SequelizeAuto(
  conf.database,
  conf.username,
  conf.password,
  config.auto
);

const tables = {
  User: "users",
  Payment: "payments"
};

const db = new Sequelize(conf.database, conf.username, conf.password, {
  host: conf.host,
  dialect: conf.dialect,
  logging: false,
  dialectOptions: { multipleStatements: true }
});

const p = new Promise((resolve, reject) => {
  return auto.run(() => {
    Object.keys(tables).forEach(k => {
      let t = tables[k];
      let fields = {};

      Object.keys(auto.tables[t]).forEach(f => {
        let isKey = f === "id";
        let rawtype = auto.tables[t][f].type.toLowerCase();
        let type = Sequelize.STRING;

        if (rawtype.match(/^int/)) type = Sequelize.INTEGER;
        if (rawtype.match(/^date/)) type = Sequelize.DATE;

        fields[f] = {
          type: type,
          field: f,
          primaryKey: isKey,
          autoIncrement: isKey
        };
      });

      db[k] = db.define(k, fields, { tableName: t });

      let typefields = {};

      let options = {};

      if (t === "users") {
        options = {
          before: (findOptions, args, context) => {
            findOptions.where = { id: context.user.id };
            return findOptions;
          }
        };
      }

      if (t === "payments") {
        db["Payment"].belongsTo(db["User"], {
          as: "user",
          foreignKey: "user_id"
        });

        options = {
          before: (findOptions, args, context) => {
            findOptions.where = { user_id: context.user.id };
            return findOptions;
          }
        };
      }
    });

    db["User"].hasMany(db["Payment"], {
      as: "payments",
      foreignKey: "user_id"
    });


    resolve(db);
  });
});

module.exports = p;
