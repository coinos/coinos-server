exports.up = async knex =>
  knex.schema.table("payments", function(table) {
    table.integer("invoice_id");
    table.foreign("invoice_id").references("invoices.id");
  });

exports.down = async knex =>
  knex.schema.table("payments", function(table) {
    table.dropColumn("invoice_id");
  });
