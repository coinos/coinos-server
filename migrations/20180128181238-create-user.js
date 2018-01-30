'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      username: {
        type: Sequelize.STRING
      },
      password: {
        type: Sequelize.STRING
      },
      email: {
        type: Sequelize.STRING
      },
      address: {
        type: Sequelize.STRING
      },
      unit: {
        type: Sequelize.STRING
      },
      symbol: {
        type: Sequelize.STRING
      },
      currency: {
        type: Sequelize.STRING
      },
      commission: {
        type: Sequelize.STRING
      },
      title: {
        type: Sequelize.STRING
      },
      pubkey: {
        type: Sequelize.STRING
      },
      privkey: {
        type: Sequelize.STRING
      },
      index: {
        type: Sequelize.INTEGER
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('users');
  }
};
