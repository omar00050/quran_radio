const baseClient = require('@root/src/base/baseClient')
const lang = require("@root/lang/en.json")


/**
 * @typedef {Object} ComponentData
 * @property {string} name
 * @property {boolean} enabled 
 * @property {function(baseClient,import('discord.js').Interaction, string[],lang)} action - The callback to be executed when the interaction is invoked
 * 
 */


/**
 * @type {ComponentData}
 */
module.exports = {
  name: "",
  enabled: true,
  async action(client, interaction, parts, lang) { }
}