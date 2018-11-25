'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      return queryInterface.createTable('users_balances', { user_id: Sequelize.INTEGER, symbol: Sequelize.STRING, balance: Sequelize.INTEGER, pending: Sequelize.INTEGER });
  },

  down: (queryInterface, Sequelize) => {
      return queryInterface.dropTable('users_balances');
  }
};
