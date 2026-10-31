require("dotenv").config();
require("module-alias/register");
require("colors");

// Patch child_process.fork BEFORE Discord.js loads so every shard process
// is spawned with windowsHide:true — suppresses console windows on Windows.
const childProcess = require("child_process");
const _originalFork = childProcess.fork.bind(childProcess);
childProcess.fork = (mod, args, opts) =>
  _originalFork(mod, args, { ...opts, windowsHide: true });

const { ShardingManager } = require("discord.js");
const path = require("path");

const manager = new ShardingManager(path.join(__dirname, "index.js"), {
  token: process.env.token,
  totalShards: "auto",
  respawn: true,
});

manager.on("shardCreate", (shard) => {
  console.log(`[ShardingManager] Launched Shard ${shard.id}`.green);

  shard.on("ready", () => {
    console.log(`[Shard ${shard.id}] Ready`.cyan);
  });

  shard.on("disconnect", () => {
    console.log(`[Shard ${shard.id}] Disconnected`.yellow);
  });

  shard.on("reconnecting", () => {
    console.log(`[Shard ${shard.id}] Reconnecting...`.bgYellow);
  });

  shard.on("death", (process) => {
    console.log(
      `[Shard ${shard.id}] Died — exit code: ${process.exitCode ?? "unknown"}`.red
    );
  });

  shard.on("error", (err) => {
    console.error(`[Shard ${shard.id}] Error:`.red, err);
  });
});

const { startLiveSocket } = require('./src/server/liveSocket');

// Spawn all shards:
// - delay: 5500ms between each shard login (Discord rate-limits IDENTIFY to 1 per 5s)
// - timeout: 30s max wait for each shard to become ready before moving to the next
manager.spawn({ amount: "auto", delay: 5500, timeout: 90_000 })
  .then(() => {
    // Start the live-status Socket.io server once all shards are up
    startLiveSocket(manager);
  })
  .catch((err) => {
    console.error("[ShardingManager] Failed to spawn shards:".red, err);
    process.exit(1);
  });

function shutdown(signal) {
  console.log(`[ShardingManager] Received ${signal} — killing all shards...`.yellow);
  manager.respawn = false; // prevent auto-respawn during shutdown
  manager.shards.forEach((shard) => {
    try { shard.kill(); } catch (_) {}
  });
  setTimeout(() => {
    console.log("[ShardingManager] All shards killed. Exiting.".red);
    process.exit(0);
  }, 3000);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (err) => {
  if (!err) return;
  console.error("[ShardingManager] unhandledRejection:".red, err);
});

process.on("uncaughtException", (err) => {
  if (!err) return;
  console.error("[ShardingManager] uncaughtException:".red, err);
});
