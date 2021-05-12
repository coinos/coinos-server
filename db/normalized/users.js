const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  uuid: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: "unique UUID as more secure reference"
  },
  password: {
    type: DataTypes.STRING(255),  // Encrypted Password type ?? 
    allowNull: false,
    validate: {
      len: [8, 255]
    }
  },
  email: {
    type: DataTypes.STRING(255),
    validate: {
      isEmail: true
    }
  },
  sms: {
    type: DataTypes.STRING(255),
    validate: {
      is: /^[0-9]+$/ // replace spaces, brackets, dashes dynamically prior to create
    }
  },
  email_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  sms_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }
}

const options = {
  tableName: "users",
  comment: "",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {fields: ['uuid', 'email']}
  ]
};

db["User"] = db.define("users_model", attributes, options);


  // *** Move to user_preferences *** 
//   unit: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: 'SAT',
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "unit"
//   },
//   currency: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: "CAD",
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "currency"
//   },
//   currencies: {
//     type: DataTypes.JSON,
//     allowNull: false,
//     defaultValue: ["USD"],
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "currencies"
//   },

//   fiat: { ??? 
//     type: DataTypes.BOOLEAN,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "fiat"
//   },

// ** Remove - redundant / unnecessary **
//   account_id: {
//     type: DataTypes.INTEGER(11),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "account_id"
//   },
//   twofa: { = otp_secret NOT NULL
//     type: DataTypes.INTEGER(1),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "twofa"
//   },

// *** Move to user_keys ***

//   otpsecret: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: "CAD",
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "otpsecret"
//   },
//   pin: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "pin"
//   },
//   seed: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "seed"
//   },

// ** What are these exactly ... ? **
//   ip: { ?? 
//     type: DataTypes.INTEGER.UNSIGNED,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "ip"
//   },

//   index: {
//     type: DataTypes.INTEGER,
//     allowNull: true,
//     defaultValue: 0,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "index"
//   },

// };

// *** Add breakout table
//   subscriptions: {
//     type: DataTypes.TEXT,
//     get: function() {
//       return JSON.parse(this.getDataValue("subscriptions"));
//     },
//     set: function(value) {
//       return this.setDataValue("subscriptions", JSON.stringify(value));
//     },
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "subscriptions"
//   },

  // *** replaced with other field(s) ***
  // locked: { - embed logic with user status (?)
  //   type: DataTypes.BOOLEAN,
  //   allowNull: true,
  //   defaultValue: false,
  //   primaryKey: false,
  //   autoIncrement: false,
  //   comment: null,
  //   field: "locked"
  // },

  

