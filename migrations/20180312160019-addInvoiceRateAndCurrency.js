'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      queryInterface.addColumn('invoices', 'rate', { type: Sequelize.DOUBLE })
      return queryInterface.addColumn('invoices', 'currency', { type: Sequelize.STRING })
  },

  down: (queryInterface, Sequelize) => {
      queryInterface.removeColumn('invoices', 'rate')
      return queryInterface.removeColumn('invoices', 'currency')
  }
};
