
/**
 * @typedef {"NONE"|"Premium_1"|"Premium_2"|"Premium_3"|"Premium_4"|"Premium_5"} CheckerPremium
 */

const client = require("@root/src/base/baseClient");
client.User;


/**
 * @typedef {Object} Checker
 * @property {User} userOwner - The name of the command (must be lowercase)
 * @property {string} description - A short description of the command
 * @property {boolean} isPremium - The command cooldown in seconds
 * @property {CheckerPremium} premium_type - The category this command belongs to
 */


/**
 * Placeholder for command data
 * @type {Checker}
 */
module.exports = {
  userOwner: {},
  description: "",
  cooldown: 0,
  isPremium: false,
  premium_type: "NONE",
};

/**
 * @type {Checker}
 */
let data = {}

// data.userOwner.