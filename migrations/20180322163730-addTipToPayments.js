'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('payments', 'tip', {
      type: Sequelize.DOUBLE,
    });
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('payments', 'tip');
  },
};
