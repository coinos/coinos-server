'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      return queryInterface.addColumn('payments', 'amount', { type: Sequelize.DOUBLE });
  },

  down: (queryInterface, Sequelize) => {
      return queryInterface.removeColumn('payments', 'amount');
  }
};
