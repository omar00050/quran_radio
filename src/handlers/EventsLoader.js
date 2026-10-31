
const ascii = require('ascii-table');
const c = require('chalk');
const path = require('path');
const { recursiveReadDirSync } = require('@utils/class/utils');

/**
 * @param {import("@root/src/base/baseClient")} client
 * @param {string} directory
 */
module.exports = (client, directory) => {
  let success = 0;
  let failed  = 0;

  const Evtable = new ascii('Client Events');
  Evtable.setHeading('event file', 'Load Status');
  Evtable.setBorder('║', '═', '✥', '🌟');
  Evtable.setAlign(0, ascii.CENTER);
  Evtable.setAlign(1, ascii.LEFT);

  recursiveReadDirSync(directory).forEach((filePath) => {
    const file = path.basename(filePath);
    try {
      // ── Remove old handler for this file before re-registering ──────
      const old = client.events.get(filePath);
      if (old) {
        client.off(old.name, old.handler);
        client.events.delete(filePath);
      }

      // ── Clear require cache so we always get fresh code ─────────────
      delete require.cache[require.resolve(filePath)];
      const event     = require(filePath);
      const eventName = event.name;

      const handler = (...args) => event.execute(client, ...args);

      if (event.once) {
        client.once(eventName, handler);
      } else {
        client.on(eventName, handler);
      }

      // Store ref so we can remove it cleanly on next reload
      client.events.set(filePath, { name: eventName, handler, once: !!event.once });

      Evtable.addRow(file, '✅');
      success += 1;
    } catch (ex) {
      failed += 1;
      Evtable.addRow(c.red(file), '❌');
      console.log(`loadEvent - ${file}`, ex);
    }
  });

  client.logger.log(`Loaded ${success + failed} events. Success (${success}) Failed (${failed})`);
};
