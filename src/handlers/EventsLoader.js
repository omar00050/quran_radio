
const ascii = require('ascii-table');
const c = require('chalk')
const path = require('path');
const { recursiveReadDirSync } = require('@utils/class/utils');

/**
 * 
 * @param {import("@root/src/base/baseClient")} client 
 * @param {string} directory directory containing the event files
 */
module.exports = (client, directory) => {

  // client.logger.log(`Loading events...`);
  let success = 0;
  let failed = 0;

  let Evtable = new ascii(`Client Events`);

  Evtable.setHeading('event flle', 'Load Status');
  // Evtable.setBorder('║', '=', '✥', '✥')
  Evtable.setBorder('║', '═', '✥', '🌟')
  Evtable.setAlign(0, ascii.CENTER)
  Evtable.setAlign(1, ascii.LEFT)
  Evtable.setAlign(2, ascii.LEFT)
  Evtable.setAlign(3, ascii.CENTER)
  recursiveReadDirSync(directory).forEach((filePath) => {
    const file = path.basename(filePath);
    try {

      const event = require(filePath);
      const eventName = event.name
      // const eventName = path.basename(file, ".js");

      // return console.log(event);
      // client.on(eventName, event.bind(null, client));
      if (event.once) {
        client.once(eventName, (...args) => event.execute(client, ...args));
      } else {
        client.on(eventName, (...args) => event.execute(client, ...args));
      }
      Evtable.addRow(file, '✅');

      delete require.cache[require.resolve(filePath)];
      success += 1;
    } catch (ex) {
      failed += 1;
      Evtable.addRow(c.red(file), '❌');

      console.log(`loadEvent - ${file}`, ex);
    }
  });

  //  console.log(Evtable.toString());

  client.logger.log(`Loaded ${success + failed} events. Success (${success}) Failed (${failed})`);

}