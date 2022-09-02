export const up = async function(knex) {
  return knex.schema.table("users", function(t) {
    t.boolean("admin");
    t.string('email');
    t.string('phone');

  });
};

export const down = async function(knex) {
  return knex.schema.table("users", function(t) {
    t.dropColumn("admin");
    t.dropColumn('email')
    t.dropColumn('phone')
  });
};
