require("dotenv").config();
require("module-alias/register");
require("events").EventEmitter.setMaxListeners(999999999)

const Quran = require("@DevXor/Quran");

let client = new Quran({
  token: process.env.token,
  database: {
    database_type: "JSON",
    mongo_uri: process.env.mongodb_uri
  }
});

client.botlogin(process.env.token);

module.exports = client;

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
