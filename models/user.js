'use strict';
module.exports = (sequelize, DataTypes) => {
  var User = sequelize.define('User', {
    username: DataTypes.STRING,
    password: DataTypes.STRING,
    email: DataTypes.STRING,
    address: DataTypes.STRING,
    unit: DataTypes.STRING,
    symbol: DataTypes.STRING,
    currency: DataTypes.STRING,
    commission: DataTypes.STRING,
    title: DataTypes.STRING,
    pubkey: DataTypes.STRING,
    privkey: DataTypes.STRING
  }, {
    classMethods: {
      associate: function(models) {
        // associations can be defined here
      }
    }
  });
  return User;
};
