const { GoodDB, JSONDriver, MongoDBDriver, SQLiteDriver, MySQLDriver } = require('good.db');
let db_config_get = require('@root/config.json');
const path = require('path');
let db_josn_path = path.join(__dirname, '../../database/database.json');

class GDB extends GoodDB {
  /**
   * @constructor
   * @param {import("@root/src/Quran").DataBase} db_option
   * @param {import("good.db/dist/Types").JSONDriverOptions} driver
   * @param {import("good.db/dist/Types").goodDBOptions} options
   */
  constructor (driver, options, db_option) {
    super(driver, options);
    this.config_get = db_config_get;
  }
}
module.exports =
  class DB {
    static db_default (db_option) {
      return new GDB(new JSONDriver({
        path: db_josn_path, format: true
      }), { nested: '..', nestedIsEnabled: true }, db_option);
    }
    static db_mongo (db_option) {
      return new GDB(new MongoDBDriver({
        uri: db_option.mongo_uri
      }), {
        nested: '..',
        nestedIsEnabled: true
      });
    }
};
