exports.up = async function(knex) {
  return knex.schema.table("users", function(table) {
    table.boolean("admin");
  });
};

exports.down = async function(knex) {
  return knex.schema.table("users", function(table) {
    table.dropColumn("admin");
  });
};
