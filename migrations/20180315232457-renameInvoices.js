'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    queryInterface.renameTable('invoices', 'payments');
    queryInterface.addColumn('payments', 'address', {
      type: Sequelize.INTEGER,
    });
    queryInterface.addColumn('payments', 'received', {
      type: Sequelize.BOOLEAN,
    });
  },

  down: (queryInterface, Sequelize) => {
    queryInterface.removeColumn('payments', 'received');
    queryInterface.removeColumn('payments', 'address');
    queryInterface.renameTable('payments', 'invoices');
  },
};
