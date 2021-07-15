exports.up = function(knex) {
  return knex.schema.createTable('liquid_assets', function(t) {
    t.increments('id').unsigned().primary();

    t.string('asset_id').notNull();
    t.string('name').notNull();

    t.string('domain')
    t.string('ticker').notNull();
    t.int('precision').defaultTo(8);
    t.string('issuer_pubkey')

    t.boolean('registered').defaultTo(false);

    t.timestamps();
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('liquid_assets');
};