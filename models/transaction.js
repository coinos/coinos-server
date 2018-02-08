'use strict';
module.exports = (sequelize, DataTypes) => {
  var Transaction = sequelize.define('Transaction', {
    hash: DataTypes.STRING,
    address: DataTypes.STRING,
    date: DataTypes.DATE,
    amount: DataTypes.FLOAT,
    rate: DataTypes.FLOAT
  }, {
    classMethods: {
      associate: function(models) {
        // associations can be defined here
      }
    }
  });
  return Transaction;
};