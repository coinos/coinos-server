'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      return queryInterface.addColumn('users', 'channelbalance', { type: Sequelize.INTEGER })
  },

  down: (queryInterface, Sequelize) => {
      return queryInterface.removeColumn('users', 'channelbalance')
  }
};
