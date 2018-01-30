'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
      return queryInterface.bulkInsert('users', [{
        username: 'yy',
        email: 'asoltys@gmail.com',
        address: '178D54KpAd2mvTtuhjYNknuQ6XPU7X9R7S',
        password: '$2a$12$2i9b1C5qNmTQcM7kKYje3OtSyb3H0xuZ3RoqxPFQ9plQCygcYT4RO',
        unit: 'BTC',
        symbol: 'gdax',
        currency: 'USD',
        commission: '-5',
        title: 'Yummy Yards',
        pubkey: 'xpub6BPFSpoAC9tgHPxziyWerggE3czxp7qfj5o69p7hSksGLsC9EoLFXBiPUXx4WFzbhmQmSeuMi1NDkXqaRRSJ1Y3eQnL67d23jn62hrwTiB3',
        privkey: 'U2FsdGVkX1/UKyL5nNpiWqrsmX9jzVSJDwUT/igruT+yIs4KFvfDJghiKGxTNP3IVML9PZkPadmWYX4Gzm1mPYqNuZKPjDvS2D0EMBGgZrLtQoraO1VNcEJfH3ZgJ/AYtTcO/ASptYx8Lo25eTXfImVNVMNcXrIhEu2LlZiosv8=',
        createdAt: new Date(),
        updatedAt: new Date(),
      }], {});
  },

  down: (queryInterface, Sequelize) => {
      return queryInterface.bulkDelete('users', null, {});
  }
};
