exports.up = async function(knex) {
  return knex.schema.table("invoices", function(table) {
    table.text("webhook");
  });
};

exports.down = async function(knex) {
  return knex.schema.table("invoices", function(table) {
    table.dropColumn("webhook");
  });
};
