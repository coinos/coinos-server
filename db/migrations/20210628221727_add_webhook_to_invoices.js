export const up = async function(knex) {
  return knex.schema.table("invoices", function(table) {
    table.text("webhook");
  });
};

export const down = async function(knex) {
  return knex.schema.table("invoices", function(table) {
    table.dropColumn("webhook");
  });
};
