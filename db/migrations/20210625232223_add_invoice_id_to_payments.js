export const up = async function (knex) {
  return knex.schema.table("payments", function(table) {
    table.integer("invoice_id");
    table.foreign("invoice_id").references("invoices.id");
  })
};

export const down = async function (knex) {
  return knex.schema.table("payments", function(table) {
    table.dropForeign("invoice_id");
    table.dropColumn("invoice_id");
  })
};
