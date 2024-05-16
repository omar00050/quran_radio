
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

  // client.logger.log(`Loading commands...`);
  let success = 0;
  let failed = 0;

  let cmd_table = new ascii(`Client All Commands`);

  cmd_table.setHeading('Command flle', 'Category', 'isPrefix', 'isSlash', 'Load Status');
  // cmd_table.setBorder('║', '=', '✥', '✥')
  cmd_table.setBorder('║', '═', '✥', '🌟')
  cmd_table.setAlign(0, ascii.CENTER)
  cmd_table.setAlign(1, ascii.LEFT)
  cmd_table.setAlign(2, ascii.LEFT)
  cmd_table.setAlign(3, ascii.CENTER)

  recursiveReadDirSync(directory).forEach(filePath => {
    const fileName = path.basename(filePath);

    /**
     * @type {import("@utils/types/baseCommand")} 
     */
    const cmd = require(filePath);
    try {
      
      if (typeof cmd !== "object") return;
      client.loadCommand(cmd);
      delete require.cache[require.resolve(filePath)];
      if (!cmd?.command) return;
      
      if (cmd.command.enabled && cmd.slashCommand.enabled)
        cmd_table.addRow(fileName, cmd.category, '✅', '✅', '✅');
      else if (cmd.command.enabled && !cmd.slashCommand.enabled)
        cmd_table.addRow(fileName, cmd.category, '✅', '❌', '✅');
      else if (!cmd.command.enabled && cmd.slashCommand.enabled)
        cmd_table.addRow(fileName, cmd.category, '❌', '✅', '✅');
      else if (!cmd.command.enabled && !cmd.slashCommand.enabled)
        cmd_table.addRow(fileName, cmd.category, '❌', '❌', '✅');

    } catch (ex) {

      if (cmd.command.enabled && cmd.slashCommand.enabled)
        cmd_table.addRow(c.red(fileName), cmd.category, '✅', '✅', '❌');
      else if (cmd.command.enabled && !cmd.slashCommand.enabled)
        cmd_table.addRow(c.red(fileName), cmd.category, '✅', '❌', '❌');
      else if (!cmd.command.enabled && cmd.slashCommand.enabled)
        cmd_table.addRow(c.red(fileName), cmd.category, '❌', '✅', '❌');
      else if (!cmd.command.enabled && !cmd.slashCommand.enabled)
        cmd_table.addRow(c.red(fileName), cmd.category, '❌', '❌', '❌');


      client.logger.error(`Failed to load ${fileName} Reason: ${ex.message}`);
    }

  })

  client.logger.success(`Loaded ${client.commands.size} commands`);
  client.logger.success(`Loaded ${client.slashCommands.size} slash commands`);
  if (client.slashCommands.size > 100) throw new Error("A maximum of 100 slash commands can be enabled");

  console.log(cmd_table.toString());


}

