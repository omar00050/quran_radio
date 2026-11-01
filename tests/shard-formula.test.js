/**
 * Shard-ownership formula checks — no network, no Discord, no bot.
 *
 *   node tests/shard-formula.test.js
 *
 * Several places have to agree on which shard owns a guild:
 *
 *   src/events/client/ready.js        belongsToShard() — decides which guilds a
 *                                     shard restores at startup
 *   src/utils/functions/resetGuildData.js  shardIdFor() — targets the
 *                                     broadcastEval that stops a guild's runtime
 *   src/ComponentsAction/info/shard_status.js  inline copy for display
 *
 * If they disagree, a reset stops the runtime on the wrong shard and silently
 * leaves the real one playing.
 *
 * The expression is also easy to get subtly wrong:
 *
 *   Number(BigInt(id) >> 22n) % total     correct
 *   Number(BigInt(id) >> 22n % total)     TypeError — `%` binds tighter than
 *                                         `>>`, so this is BigInt % Number
 *   (BigInt(id) >> 22n) % total           TypeError — same mixing problem
 *
 * Both wrong forms throw rather than returning a wrong number, which is lucky,
 * but this test pins the correct form in place and checks every copy of it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { shardIdFor } = require('../src/utils/functions/resetGuildData');

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/**
 * The reference implementation, copied verbatim from ready.js:84. The source
 * guard below fails if ready.js ever stops matching this, so the copy cannot
 * drift silently.
 */
const belongsToShard = (guildId, totalShards, shardId) =>
  Number(BigInt(guildId) >> 22n) % totalShards === shardId;

/** Real snowflakes: guild and channel ids taken from this repository. */
const SNOWFLAKES = [
  '1171512753802969098',
  '1260050012927168563',
  '1110669204295790703',
  '768414261231747093',
  '1000073755634192506',
  '651095740390834176',
  '1259470700801036401',
  '1025001307557343252',
  '1031533069238292520',
  '1024996154410291230',
];

const TOTAL = 16;

function main() {
  // ── 1. The exact expression is present in every copy ────────────────────
  const EXPECTED = 'Number(BigInt(guildId) >> 22n) % totalShards';

  const readySrc = read('src/events/client/ready.js');
  record(
    'ready.js uses the exact parenthesised expression',
    readySrc.includes(EXPECTED),
    EXPECTED,
  );

  const resetSrc = read('src/utils/functions/resetGuildData.js');
  record(
    'resetGuildData.js uses the exact parenthesised expression',
    resetSrc.includes(EXPECTED),
    EXPECTED,
  );

  const statusSrc = read('src/ComponentsAction/info/shard_status.js');
  record(
    'shard_status.js uses the same shape',
    /Number\(BigInt\([^)]+\) >> 22n\) % totalShards/.test(statusSrc),
    'Number(BigInt(...) >> 22n) % totalShards',
  );

  // Nobody should have the `%` inside the Number(), or the shift outside it.
  const allSrc = [readySrc, resetSrc, statusSrc].join('\n');
  record(
    'no copy puts % inside Number() (BigInt % Number)',
    !/Number\(BigInt\([^)]*\) >> 22n\s*%/.test(allSrc),
  );
  record(
    'no copy applies % to a BigInt shift result',
    !/\)\s*>>\s*22n\)\s*%\s*(?!.*Number)/.test(allSrc.replace(/Number\(BigInt\([^)]+\) >> 22n\)/g, 'OK')),
  );

  // ── 2. shardIdFor agrees with ready.js's belongsToShard ─────────────────
  let agree = 0;
  const disagreements = [];
  for (const id of SNOWFLAKES) {
    const computed = shardIdFor(id, TOTAL);

    // Exactly one shard may claim the guild, and it must be the computed one.
    const owners = [];
    for (let shardId = 0; shardId < TOTAL; shardId++) {
      if (belongsToShard(id, TOTAL, shardId)) owners.push(shardId);
    }

    if (owners.length === 1 && owners[0] === computed) agree++;
    else disagreements.push(`${id}: shardIdFor=${computed} belongsToShard=[${owners.join(',')}]`);
  }
  record(
    `shardIdFor matches belongsToShard for all ${SNOWFLAKES.length} snowflakes at totalShards=${TOTAL}`,
    agree === SNOWFLAKES.length,
    disagreements.join(' | ') || `all ${agree} agree`,
  );

  console.log('      ' + SNOWFLAKES.map((id) => `${id.slice(-6)}→${shardIdFor(id, TOTAL)}`).join('  '));

  // ── 3. Properties that must hold ────────────────────────────────────────
  record(
    'every result is an integer inside [0, totalShards)',
    SNOWFLAKES.every((id) => {
      const v = shardIdFor(id, TOTAL);
      return Number.isInteger(v) && v >= 0 && v < TOTAL;
    }),
  );

  record(
    'result is a Number, never a BigInt',
    SNOWFLAKES.every((id) => typeof shardIdFor(id, TOTAL) === 'number'),
  );

  record(
    'deterministic across repeated calls',
    SNOWFLAKES.every((id) => shardIdFor(id, TOTAL) === shardIdFor(id, TOTAL)),
  );

  record(
    'a single shard owns everything',
    SNOWFLAKES.every((id) => shardIdFor(id, 1) === 0),
  );

  record(
    'guards against a missing or zero shard count',
    shardIdFor(SNOWFLAKES[0], 0) === 0
    && shardIdFor(SNOWFLAKES[0], undefined) === 0
    && shardIdFor(SNOWFLAKES[0], -3) === 0,
  );

  // Spread check: with 16 shards these ten ids should not all land on one.
  const distinct = new Set(SNOWFLAKES.map((id) => shardIdFor(id, TOTAL)));
  record(
    'ids distribute across more than one shard',
    distinct.size > 1,
    `${distinct.size} distinct shards: ${[...distinct].sort((a, b) => a - b).join(',')}`,
  );

  // ── 4. The broken variants really do throw ──────────────────────────────
  const id = SNOWFLAKES[0];
  let threwPrecedence = false;
  try { Number(BigInt(id) >> 22n % TOTAL); } catch (_) { threwPrecedence = true; }
  record('omitting the parentheses throws (BigInt % Number)', threwPrecedence);

  let threwMixing = false;
  try { void ((BigInt(id) >> 22n) % TOTAL); } catch (_) { threwMixing = true; }
  record('applying % to the BigInt result throws', threwMixing);

  // And the BigInt-only form returns a BigInt, which would break `=== shardId`
  // comparisons against a Number even though it does not throw.
  const bigintForm = (BigInt(id) >> 22n) % BigInt(TOTAL);
  record(
    'all-BigInt form yields a BigInt that fails strict comparison',
    typeof bigintForm === 'bigint' && !(bigintForm === shardIdFor(id, TOTAL)),
    `${bigintForm} (bigint) !== ${shardIdFor(id, TOTAL)} (number)`,
  );

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main();
