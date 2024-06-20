const { GoodDB, JSONDriver, MongoDBDriver, SQLiteDriver, MySQLDriver } = require("good.db");
const path = require('path');

let db_josn_path = path.join(__dirname, '../../database/database.json')
let db_Sqlite_path = path.join(__dirname, '../../database/database.sqlite')


class GDB extends GoodDB {
  /**
   * @constructor
   * @param {import("good.db/dist/Types").JSONDriverOptions} driver
   * @param {import("good.db/dist/Types").goodDBOptions} options
   * @param {import("@DevXor/DevXor").DataBase} db_option
   */
  constructor(driver, options, db_option) {
    if (db_option?.options) options = db_option.options
    super(driver, options)

    // if you wont use good.db you can use this

  };
};

module.exports = class DB {
  /**
   * @param {import("@DevXor/DevXor").DataBase} db_option
   */
  static db_default(db_option) {
    return new GDB(new JSONDriver({
      path: db_josn_path, format: true
    }), {
      nested: "..",
      nestedIsEnabled: true,
      table: "DevXorDB",
      cache: {
        capacity: 1024,
        isEnabled: true,
      }
    }
      , db_option);
  };

  /**
   * @param {import("@DevXor/DevXor").DataBase} db_option
   */
  static db_sqlite(db_option) {
    return new GDB(new SQLiteDriver({
      path: db_Sqlite_path,
    }), {
      nested: "..",
      nestedIsEnabled: true,
      table: "DevXorDB",
      cache: {
        capacity: 1024,
        isEnabled: true,
      }
    }, db_option);

  };

  /**
   * @param {import("@DevXor/DevXor").DataBase} db_option
   */
  static db_mongo(db_option) {
    return new GDB(new MongoDBDriver(db_option?.MongoDB), {
      nested: "..",
      nestedIsEnabled: true,
      table: "DevXorDB",
      cache: {
        capacity: 1024,
        isEnabled: true,
      }
    }, db_option);
  };
  /**
  * @param {import("@DevXor/DevXor").DataBase} db_option
  */
  static db_mysql(db_option) {
    return new GDB(new MySQLDriver(db_option?.MySQL), {
      nested: "..",
      nestedIsEnabled: true,
      table: "DevXorDB",
      cache: {
        capacity: 1024,
        isEnabled: true,
      }
    }, db_option);
  };
};