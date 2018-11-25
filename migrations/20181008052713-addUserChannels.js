'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      return queryInterface.createTable('users_channels', { user_id: Sequelize.INTEGER, channel_id: Sequelize.INTEGER });
  },

  down: (queryInterface, Sequelize) => {
      return queryInterface.dropTable('users_channels');
  }
};
