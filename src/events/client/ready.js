const { chunkArray } = require('@root/src/utils/class/utils');
const sendAzkar = require('@root/src/utils/functions/sendAzkar');
const SendAdhan = require('@utils/functions/sendPrayer');
const { cleanOldPrayerCache } = require('@utils/functions/sendPrayer');
const updateControlPanel = require('@utils/functions/updateControlPanel');
const resetGuildRuntime = require('@utils/functions/resetGuildRuntime');
const joinAndPlayQuran = require('@utils/functions/joinAndPlayQuran');
const { getBroadcastStats } = joinAndPlayQuran;
const chalk = require('chalk');
const { ActivityType, Guild, } = require('discord.js');
const gr = chalk.hex('#00D100');
const un = chalk.underline;

module.exports = {
  name: 'ready',
  once: true, // must only run once — re-running on reconnect causes duplicate DB connections and stacked timers
  /**
   * @param {import("@base/baseClient")} client
   */
  async execute(client) {
    

    // Expose broadcaster stats for broadcastEval (used by liveSocket)
    client.getBroadcasterStats = getBroadcastStats;

    // Exposed on the client so the manager's reset can reach it through
    // broadcastEval: the evaluated function is serialised into the shard, where
    // `require` is not reliably available, so it can only call what already
    // hangs off the client.
    client.resetGuildRuntime = (guildId) => resetGuildRuntime(client, guildId);

    await client.DBConnect();
    await client.registerInteractions();
    cleanOldPrayerCache(client);
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
    setInterval(async () => {
            let totalGuilds, totalChannels, totalUsers, totalRadio, totalAzkar, totalAdhan;

      if (client.shard) {
        const results = await client.shard.broadcastEval((c) => ({
          guilds:   c.guilds.cache.size,
          channels: c.channels.cache.size,
          users:    c.guilds.cache.reduce((a, b) => a + b.memberCount, 0),
          radio:    c.Radio.size,
          azkar:    c.Azkar.size,
          adhan:    c.Adhan.size,
        }));
        totalGuilds   = results.reduce((a, b) => a + b.guilds,   0);
        totalChannels = results.reduce((a, b) => a + b.channels, 0);
        totalUsers    = results.reduce((a, b) => a + b.users,    0);
        totalRadio    = results.reduce((a, b) => a + b.radio,    0);
        totalAzkar    = results.reduce((a, b) => a + b.azkar,    0);
        totalAdhan    = results.reduce((a, b) => a + b.adhan,    0);
      } else {
        totalGuilds   = client.guilds.cache.size;
        totalChannels = client.channels.cache.size;
        totalUsers    = client.guilds.cache.reduce((a, b) => a + b.memberCount, 0);
        totalRadio    = client.Radio.size;
        totalAzkar    = client.Azkar.size;
        totalAdhan    = client.Adhan.size;
      }
      
      let ServersStatus = totalRadio + totalAzkar + totalAdhan;
      client.user.setActivity({ name: `in ${ServersStatus}/${totalChannels} Channels`, type: ActivityType.Listening })
    }, 1 * 1000 * 60);

    // Filter channels to only those belonging to this shard.
    // Every shard runs ready.js, so without filtering all shards would race
    // to process every guild — causing duplicate connections and false deletions.
    const shardId = client.shard?.ids[0] ?? 0;
    const totalShards = client.shard?.count ?? 1;
    const belongsToShard = (guildId) =>
      Number(BigInt(guildId) >> 22n) % totalShards === shardId;

    // Delay channel restoration by 2 minutes to allow the database connection
    // and Discord gateway to fully stabilize before doing heavy work.
    setTimeout(async () => {

    // let RadioChannels = await db.values() || [];
    let RadioChannels = Object.values(await db.endsWith("_radioChannel")).filter(d => belongsToShard(d.guildId)) || [];
    let AzkarChannels = Object.values(await db.endsWith("_azkarChannel")).filter(d => belongsToShard(d.guildId)) || [];
    let PrayerChannels = Object.values(await db.endsWith("_prayerChannel")).filter(d => belongsToShard(d.guildId)) || [];

      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      // if (process.env.testMode) return console.log("stop run radio is test mode".red);
      let noCh = []
      let chunkedRadio = chunkArray(RadioChannels, 100)
      let chunkedAzkar = chunkArray(AzkarChannels, 30)
      let chunkedPrayer = chunkArray(PrayerChannels, 30)

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

      // Restore prayer (adhan) channels
      for (let i = 0; i < chunkedPrayer.length; i++) {

        setTimeout(async () => {

          for (let data of chunkedPrayer[i]) {

            let guild = await client.guilds.fetch(data.guildId).catch(() => null);
            if (!guild?.id) {
              setTimeout(async () => await db.delete(`${data.guildId}_prayerChannel`), 1000 * i);
              console.log("no guild in server  " + guild + " and delete it");
              continue;
            }
            if (data) {
              await sleep(1000);
              if (data?.enabled) {
                console.log(`send adhan in server  ${guild.name} ${guild.id}`);
                await SendAdhan(client, guild, data);
              }

            }
          }
        }
          , 1000 * i)

      }

      for (let i = 0; i < chunkedRadio.length; i++) {

        setTimeout(async () => {

          for (let [key, data] of chunkedRadio[i].entries()) {

            client.guilds.fetch(data.guildId).then(async guild => {

              if (data) {

                if (client.Radio.has(data.guildId)) return
                await sleep(5000 * key);
                if (data?.channelId) joinAndPlayQuran(client, data.channelId, guild, data.url).then(async conn => {

                  if (conn === null) {
                    console.log("no channel in server  " + guild.name + " " + guild.id);
                    db.set(`${data.guildId}_radioChannel..enabled`, false)
                    db.set(`${data.guildId}_radioChannel..channelId`, null)
                    noCh.push(data)
                    return
                  }
                  if (conn === "cantConnect") {
                    console.log("cant connect in server  " + guild.name + " " + guild.id);
                    return
                  }

                  client.Radio.set(data.guildId, conn)
                  setTimeout(async () => {
                    await db.set(`${data.guildId}_radioChannel..enabled`, true)
                  }, 100 * i);

                  // if (guild.id !== "1171512753802969098") continue
                  let data1 = await db.get(`${data.guildId}_radioChannel`)

                  // Re-render the panel, but do NOT migrate here. Panels that
                  // are already Components v2 are edited as usual; an old
                  // embed-based panel is left exactly as it is. Converting one
                  // costs a delete plus a repost, and doing that for every
                  // guild at startup is a large burst of requests for panels
                  // nobody may even look at today. Old panels keep working —
                  // their customIds are unchanged — and each is converted the
                  // first time someone presses a button on it or runs
                  // /control.
                  await updateControlPanel(client, guild, data1, undefined, { migrate: false })
                    .catch(err => console.log(err));
                });

              }
            }).catch(err => {
              if (err.status === 404) {
                setTimeout(async () => await db.delete(`${data.guildId}_radioChannel`), 1000 * i);
                console.log("no guild in server  " + data.guildId + " and delete it".bgRed);
              }
            });
            // let guild = await client.guilds.fetch(data.guildId).catch(() => null);

            // if (data.enabled) {

            //   if (client.Radio.has(data.guildId)) continue
            //   await sleep(3000);
            //   let conn = await joinAndPlayQuran(client, data.channelId, guild, data.url);

            //   if (conn === null) {
            //     console.log("no channel in server  " + guild.name + " " + guild.id);
            //     noCh.push(data)
            //     continue
            //   }
            //   if (conn === "cantConnect") {
            //     console.log("cant connect in server  " + guild.name + " " + guild.id);
            //     continue
            //   }

            //   client.Radio.set(data.guildId, conn)
            //   setTimeout(async () => {
            //     // await db.set(`${data.guildId}_radioChannel..enabled`, true)
            //   }, 100 * i);

            //   // if (guild.id !== "1171512753802969098") continue
            //   let data1 = await db.get(`${data.guildId}_radioChannel`)

            //   let msg = await guild.channels.cache.get(data1.ch)?.messages.fetch(data1.msgId).catch(err => null)
            //   if (!msg?.id) {

            //     // await db.set(`${ data.guildId }_radioChannel..enabled`, false)
            //     console.log("cant find msg in server  " + guild.name.yellow + " " + guild.id.red);
            //   }
            //   if (msg?.id) msg?.edit(ControlData(client, data1)).catch(err => console.log(err));

            // }

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
        }, 1000 * i);

      }



    }, 2 * 60 * 1000); // 2 minutes — gives DB and gateway time to stabilize


  },
};
