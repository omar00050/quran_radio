/**
 * Recovery-waiter registry checks — no network, no ffmpeg, no Discord.
 *
 *   node tests/waiters.test.js
 *
 * A "waiter" is a guild holding its voice connection open with no audio while
 * it waits for a station to come back. It owns a `wanted` mark on the hub,
 * which keeps that station exempt from the idle sweep so its retries keep
 * running. If a waiter is ever orphaned, the station becomes permanently
 * exempt and retries forever for nobody — so the invariant under test is:
 *
 *   every teardown path releases the mark, and a station with no real
 *   waiters is still swept.
 *
 * The waiters used to be stored on the VoiceConnection object, which is not a
 * stable identity: joinVoiceChannel hands back the SAME connection for a
 * guild, the OFF button destroys it and deletes the client.Radio entry, and
 * guildDelete never saw it at all. Each of those orphaned the wait.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const AudioSource = require('../src/audio/AudioSource');
const { startWaiting, stopWaiting, waitingUrl, waiterCount } = require('../src/audio/waiters');

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Upstream that is always down, so nothing can accidentally succeed. */
const deadProvider = { kind: 'remote', async open() { throw new Error('ECONNREFUSED'); } };

/** Upstream that works, for the "swept when unwanted" case. */
const liveProvider = {
  kind: 'embedded',
  async open() {
    const stream = new PassThrough();
    return { stream, pid: 4242, destroy: () => stream.destroy() };
  },
};

function makeClient(provider) {
  const audio = new AudioSource('embedded', provider, {
    idleMs: 500, retryFloorMs: 80, retryCapMs: 120,
    failedRetryMs: 150, maxAttempts: 2,
    logger: { error() {}, warn() {}, log() {}, info() {} },
  });
  return { audio, Radio: new Map(), radioUrlCache: new Map() };
}

const URL_A = 'fake://station-a';
const URL_B = 'fake://station-b';

async function main() {
  // ── 1. a waiter keeps its station alive through a long outage ──────────
  {
    const client = makeClient(deadProvider);
    const detachCalls = [];
    client.audio.markWanted(URL_A);
    startWaiting(client, 'g1', URL_A, () => {
      detachCalls.push(URL_A);
      client.audio.unmarkWanted(URL_A);
    });

    await sleep(1200); // well past idleMs
    record('a waited-on station survives the idle sweep',
      client.audio.hub.broadcasts.has(URL_A), `state=${client.audio.getState(URL_A)}`);
    record('registry reports the guild as waiting',
      waitingUrl(client, 'g1') === URL_A && waiterCount(client) === 1);

    // ── 2. releasing it lets the sweep reclaim the station ───────────────
    const released = stopWaiting(client, 'g1');
    record('stopWaiting releases the waiter', released && waiterCount(client) === 0);
    record('detach ran exactly once', detachCalls.length === 1, `calls=${detachCalls.length}`);
    record('the wanted mark is gone', !client.audio.hub._isWanted(URL_A));

    await sleep(1200);
    record('an unwaited station IS swept after idleMs',
      !client.audio.hub.broadcasts.has(URL_A),
      `broadcasts=${client.audio.hub.broadcasts.size}`);

    // ── 3. idempotency: teardown paths must be safe to double-call ───────
    const again = stopWaiting(client, 'g1');
    record('stopWaiting is idempotent (second call is a no-op)',
      again === false && detachCalls.length === 1);
    record('stopWaiting on a guild that never waited is a no-op',
      stopWaiting(client, 'never-waited') === false);
    record('the wanted count cannot go negative',
      (client.audio.hub.wanted.get(URL_A) ?? 0) === 0,
      `count=${client.audio.hub.wanted.get(URL_A) ?? 0}`);

    await client.audio.destroy();
  }

  // ── 4. switching station while waiting swaps the mark ──────────────────
  {
    const client = makeClient(deadProvider);
    client.audio.markWanted(URL_A);
    startWaiting(client, 'g1', URL_A, () => client.audio.unmarkWanted(URL_A));

    client.audio.markWanted(URL_B);
    startWaiting(client, 'g1', URL_B, () => client.audio.unmarkWanted(URL_B));

    record('switching station releases the old mark',
      !client.audio.hub._isWanted(URL_A), `A wanted=${client.audio.hub.wanted.get(URL_A) ?? 0}`);
    record('switching station holds the new mark',
      client.audio.hub._isWanted(URL_B));
    record('still exactly one waiter for the guild', waiterCount(client) === 1);

    stopWaiting(client, 'g1');
    record('after teardown neither station is wanted',
      !client.audio.hub._isWanted(URL_A) && !client.audio.hub._isWanted(URL_B));
    await client.audio.destroy();
  }

  // ── 5. many guilds on one station: the mark survives until the last ────
  {
    const client = makeClient(deadProvider);
    for (const g of ['g1', 'g2', 'g3']) {
      client.audio.markWanted(URL_A);
      startWaiting(client, g, URL_A, () => client.audio.unmarkWanted(URL_A));
    }
    record('three guilds waiting on one station', waiterCount(client) === 3
      && client.audio.hub.wanted.get(URL_A) === 3);

    stopWaiting(client, 'g1');
    stopWaiting(client, 'g2');
    record('station still wanted while one guild waits',
      client.audio.hub._isWanted(URL_A), `count=${client.audio.hub.wanted.get(URL_A)}`);

    stopWaiting(client, 'g3');
    record('station released when the last guild stops waiting',
      !client.audio.hub._isWanted(URL_A) && waiterCount(client) === 0);
    await client.audio.destroy();
  }

  // ── 6. a live station nobody waits on is still swept ──────────────────
  {
    const client = makeClient(liveProvider);
    await client.audio.getOrCreate(URL_A);
    const stream = client.audio.createGuildStream(URL_A);
    record('live station has a listener', client.audio.hub.broadcasts.get(URL_A).refCount === 1);

    client.audio.releaseGuildStream(URL_A, stream);
    await sleep(900); // past idleMs
    record('a live station with no listeners and no waiters is swept',
      !client.audio.hub.broadcasts.has(URL_A));
    await client.audio.destroy();
  }

  // ── 7. source guard: every teardown path must still call stopWaiting ──
  // Cheap regression guard — the registry can only work if the call sites
  // exist, and three of them were missing when this bug was found.
  const mustCall = [
    ['src/utils/functions/joinAndPlayQuran.js', 'playBroadcastAudio / fresh join / disconnect'],
    ['src/ComponentsAction/settings/onRadio_off_radio.js', 'OFF button'],
    ['src/events/client/guildDelete.js', 'bot kicked or removed from the guild'],
  ];
  for (const [file, why] of mustCall) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    record(`${file} calls stopWaiting (${why})`, /stopWaiting\s*\(/.test(src));
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
