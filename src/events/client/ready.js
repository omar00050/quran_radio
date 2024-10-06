const { chunkArray } = require('@root/src/utils/class/utils');
const sendAzkar = require('@root/src/utils/functions/sendAzkar');
const ControlData = require('@utils/functions/ControlData');
const joinAndPlayQuran = require('@utils/functions/joinAndPlayQuran');
const chalk = require('chalk');
const { ActivityType, Guild, } = require('discord.js');
const gr = chalk.hex('#00D100');
const un = chalk.underline;

module.exports = {
  name: 'ready',
  /**
   * @param {import("@base/baseClient")} client 
   */
  async execute(client) {

    await client.DBConnect();
    await client.registerInteractions();
    const db = await client.db.table("channels");

    const commands = client.slashCommands.map(({ execute, ...data }) => data);
    setTimeout(() => {
      console.log(gr(`Logged In As ` + un(`${client.user.username}`)));
      console.log(chalk.cyan(`Servers:` + un(`${client.guilds.cache.size}`)), chalk.red(`Users:` + un(`${client.guilds.cache
        .reduce((a, b) => a + b.memberCount, 0)
        .toLocaleString()}`)), chalk.blue(`Commands:` + un(` ${client.commands.size}` + ` TOTAL Commands ${client.commands.size + commands.length}`)));
    }, 3000);
    client.user.setStatus("idle")
    client.user.setActivity({ name: `Loading....`, type: ActivityType.Playing })
    setTimeout(() => client.user.setStatus("online"), 40000);
    setInterval(() => {
      let ServersStatus = client.Radio.size + client.Azkar.size;
      client.user.setActivity({ name: `in ${ServersStatus}/${client.channels.cache.size} Channels`, type: ActivityType.Listening })
    }, 1 * 1000 * 60);

    // let RadioChannels = await db.values() || [];
    let RadioChannels = Object.values(await db.endsWith("_radioChannel")) || [];
    let AzkarChannels = Object.values(await db.endsWith("_azkarChannel")) || [];

    if (RadioChannels.length === 0) return
    setTimeout(async () => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      // if (process.env.testMode) return console.log("stop run radio is test mode".red);
      let noCh = []
      let chunkedRadio = chunkArray(RadioChannels, 50)
      let chunkedAzkar = chunkArray(AzkarChannels, 30)


        for (let i = 0; i < chunkedAzkar.length; i++) {

          setTimeout(async () => {

            for (let data of chunkedAzkar[i]) {

              let guild = await client.guilds.fetch(data.guildId).catch(() => null);
              if (!guild?.id) {
                setTimeout(async () => await db.delete(`${data.guildId}_azkarChannel`), 1000 * i);
                console.log("no guild in server  " + guild + " and delete it");
                continue;
              }
              if (data) {
                await sleep(1000);
                if (data?.msgTimeSend) {
                  console.log(`send azkar in server  ${guild.name} ${guild.id}`);
                  await sendAzkar(client, guild, data);
                }

              }
            }
          }, 1000 * i)

        }

        for (let i = 0; i < chunkedRadio.length; i++) {

          setTimeout(async () => {

            for (let data of chunkedRadio[i]) {

              let guild = await client.guilds.fetch(data.guildId).catch(() => null);

              if (!guild?.id) {
                setTimeout(async () => await db.delete(`${data.guildId}_radioChannel`), 1000 * i);
                console.log("no guild in server  " + guild + " and delete it");
                continue;
              }

              if (data.enabled) {

                if (client.Radio.has(data.guildId)) continue
                await sleep(3000);
                let conn = await joinAndPlayQuran(client, data.channelId, guild, data.url);

                if (conn === null) {
                  console.log("no channel in server  " + guild.name + " " + guild.id);
                  noCh.push(data)
                  continue
                }
                if (conn === "cantConnect") {
                  console.log("cant connect in server  " + guild.name + " " + guild.id);
                  continue
                }

                client.Radio.set(data.guildId, conn)
                setTimeout(async () => {
                  // await db.set(`${data.guildId}_radioChannel..enabled`, true)
                }, 100 * i);

                // if (guild.id !== "1171512753802969098") continue
                let data1 = await db.get(`${data.guildId}_radioChannel`)

                let msg = await guild.channels.cache.get(data1.ch)?.messages.fetch(data1.msgId).catch(err => null)
                if (!msg?.id) {

                  // await db.set(`${ data.guildId }_radioChannel..enabled`, false)
                  console.log("cant find msg in server  " + guild.name.yellow + " " + guild.id.red);
                }
                if (msg?.id) msg?.edit(ControlData(client, data1)).catch(err => console.log(err));

              }

              // let table = console.table([
              //   {
              //     "AllRadio": RadioChannels.length,
              //     "client.Radio.size": client.Radio.size,
              //     "client.Azkar.size": client.Azkar.size,
              //     "noCh": noCh.length
              //   },
              //   {
              //     "azkarChannels": Object.entries(AzkarChannels).length,
              //     "radioChannels": Object.entries(RadioChannels).length
              //   }
              // ]);
              // setTimeout(() => table.update(), 1000);
            }
          }, 100 * i);

        }

       

    }, 3000);


  },
};
