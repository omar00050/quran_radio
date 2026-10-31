'use strict';

/**
 * Resolves the effective audio mode for THIS process.
 *
 * `AUDIO_MODE=remote` alone switches every shard to the audio server at once.
 * `AUDIO_REMOTE_SHARDS` narrows that to an explicit set of shard ids so the
 * rollout can be done one shard at a time — the rest stay embedded and keep
 * running ffmpeg in process, so a problem with the audio server costs you one
 * shard instead of the whole fleet.
 *
 *   AUDIO_MODE=remote                        -> every shard remote
 *   AUDIO_MODE=remote AUDIO_REMOTE_SHARDS=0  -> shard 0 remote, others embedded
 *   AUDIO_MODE=remote AUDIO_REMOTE_SHARDS=0,3,7
 *   AUDIO_MODE=embedded                      -> list ignored, everything embedded
 *
 * Shard ids come from `SHARDS`, which is what discord.js's ShardingManager
 * injects into each child process (see Shard.js: `SHARDS: this.id`) — NOT
 * `DISCORD_SHARD_ID`. A process can in principle host several ids, so an
 * overlap of one is enough to make it remote.
 *
 * Unsharded runs (`npm start` / `node index.js` with no manager) ignore the
 * list entirely: there is nothing to partition, so `AUDIO_MODE` applies as
 * written. Setting AUDIO_REMOTE_SHARDS there is a no-op rather than a trap.
 */

/** @returns {number[]} parsed ids; empty array means "unset / all" */
function parseShardList(raw) {
  if (raw === undefined || raw === null) return [];
  return String(raw)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

/** @returns {number[]} this process's shard ids, from the manager's env */
function parseOwnShardIds(env = process.env) {
  return parseShardList(env.SHARDS);
}

function isShardedProcess(env = process.env) {
  // ShardingManager sets both; SHARDS alone is enough to identify a child.
  return env.SHARDING_MANAGER === 'true' || env.SHARDS !== undefined;
}

/**
 * @param {object} [env] defaults to process.env
 * @returns {{mode: 'embedded'|'remote', shardIds: number[], remoteShards: number[], reason: string}}
 */
function resolveAudioMode(env = process.env) {
  const requested = (env.AUDIO_MODE || 'embedded').trim().toLowerCase();
  const mode = requested === 'remote' ? 'remote' : 'embedded';
  const remoteShards = parseShardList(env.AUDIO_REMOTE_SHARDS);
  const shardIds = parseOwnShardIds(env);

  if (mode !== 'remote') {
    return { mode: 'embedded', shardIds, remoteShards, reason: `AUDIO_MODE=${requested}` };
  }
  if (remoteShards.length === 0) {
    return { mode: 'remote', shardIds, remoteShards, reason: 'AUDIO_MODE=remote (all shards)' };
  }
  if (!isShardedProcess(env)) {
    return {
      mode: 'remote',
      shardIds,
      remoteShards,
      reason: 'AUDIO_MODE=remote; AUDIO_REMOTE_SHARDS ignored (process is not sharded)',
    };
  }

  const matched = shardIds.filter((id) => remoteShards.includes(id));
  if (matched.length > 0) {
    return {
      mode: 'remote',
      shardIds,
      remoteShards,
      reason: `shard ${matched.join(',')} is in AUDIO_REMOTE_SHARDS=${remoteShards.join(',')}`,
    };
  }
  return {
    mode: 'embedded',
    shardIds,
    remoteShards,
    reason: `shard ${shardIds.join(',') || '?'} not in AUDIO_REMOTE_SHARDS=${remoteShards.join(',')}`,
  };
}

module.exports = { resolveAudioMode, parseShardList, parseOwnShardIds, isShardedProcess };
