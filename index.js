require("dotenv").config();
require("module-alias/register");
require("colors");
// const { registerFont } = require('canvas');
// const fontFile = './src/utils/fonts/Amiri-Regular.ttf';

// registerFont(fontFile, { family: 'Amiri' });

// require("events").EventEmitter.setMaxListeners(999999999)

// const { GatewayIntentBits, Partials } = require("discord.js");
// const Quran = require("@DevXor/DevXor");

// let client = new Quran({
//   token: process.env.token,
//   database: {
//     database_type: "MONGODB",
//     MongoDB: {
//       uri: process.env.mongodb_uri
//     },
//     options: {
//       nested: '..',
//       nestedIsEnabled: true,
//       cache: {
//         isEnabled: true,
//         capacity: 2048
//       }
//     }
//   }
// });

// setTimeout(function () {
//   client.botlogin(process.env.token);
// }, 2000);

// module.exports = client;
const { ShardingManager } = require('discord.js');

const manager = new ShardingManager('./bot.js', { totalShards: 6, token: process.env.token });

manager.on('shardCreate', shard => console.log(`Launched shard ${shard.id}`));

manager.spawn();


//nodejs-events
process.on("unhandledRejection", e => {
  if (!e) retrun;
  console.log(e)
});

process.on("uncaughtException", e => {
  if (!e) return;
  console.log(e)
});

process.on("uncaughtExceptionMonitor", e => {
  if (!e) return
  console.log(e)
});
