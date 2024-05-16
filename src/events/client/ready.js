const joinAndPlayQuran = require('@root/src/utils/functions/joinAndPlayQuran');
const chalk = require('chalk');
const gr = chalk.hex('#00D100');
const un = chalk.underline;

module.exports = {
  name: 'ready',
  /**
   * @param {import("@base/baseClient")} client 
   */
  async execute(client) {
    await client.registerInteractions()
    const commands = client.slashCommands.map(({ execute, ...data }) => data);
    setTimeout(() => {
      console.log(gr(`Logged In As ` + un(`${client.user.username}`)));
      console.log(chalk.cyan(`Servers:` + un(`${client.guilds.cache.size}`)), chalk.red(`Users:` + un(`${client.users.cache.size}`)), chalk.blue(`Commands:` + un(` ${client.commands.size}` + ` TOTAL Commands ${client.commands.size + commands.length}`)));
    }, 500);


    let RadioChannels = await client.db.table("channels").values() || [];
    if (RadioChannels.length === 0) return
      setTimeout(async () => {

        for (let data of RadioChannels) {
          if (data.enabled) {

            let guild = await client.guilds.fetch(data.guildId)
            if (!guild) continue
            let conn = await joinAndPlayQuran(client, data.channelId, guild, data.url)
            if (conn === null) continue
            if (conn === "cantConnect") continue
            client.Radio.set(data.guildId, conn)
          }

        }
      }, 1000);

  },
};