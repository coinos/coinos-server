# General guidelines for Database schema:

- Some 1-1 tables are split up simply to separate scope or to control access permission (ie only user_preferences table may be edited by users themselves)

- String fields which have a finite number of options should be changed to either:
  - an FK to a separate lookup table (when the options is large or can grow)
  - an enum (when there are a short list of essentailly static options)

- Field names should follow SQL standards:
  - lower case
  - underscore_separated_words

- options should be standardized with: 
  {
    tableName: "table_name",
    comment: "description of table if not self-evident",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {}
    ]
  };
    - note createdAt, updatedAt are renamed to abide by SQL standard.

  - by default allowNull is false, so this attribute need only be specified when fields are NOT NULL.

  - comment attribute should added to any field that is not self-evident

  - may need to add indexes to more fields for rapid access  

  ## Questions:
  - Are indexes automatically generated for primary keys and/or foreign keys ?
  - Do we add non-unique indexes for data mining: eg { fields: ['username'] }
  - Do timestamp fields require default value spec (eg Sequelize.NOW) ?

  - payments table needs to be investigated
  - is invoices required or just summary information ?
  - need to add orders table 
  - need to add subscriptions table if applicable (?)

