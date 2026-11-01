/**
 * Radio guard checks — no Discord, no bot, no real audio server.
 *
 *   node tests/radio-guards.test.js
 *
 * Reproduces the remote-mode ON/OFF bug and pins the fix:
 *
 *   `AudioSource` initialised `audioServer.reachable` to `false` in remote
 *   mode, and nothing inside a shard ever refreshed it — the `/health` poll
 *   runs in the manager process. `checkStationHealth` blocked ON whenever
 *   reachable === false, so in remote mode the ON button was blocked
 *   permanently while startup restore (which bypasses the guards) kept working.
 *
 * The regression guards here are:
 *   - a reachable remote server must ALLOW ON;
 *   - an unmeasured/unknown reachability must never block;
 *   - a genuinely refused connection must block, with the unreachable message;
 *   - a rejected token must block with its OWN message, not "unreachable";
 *   - embedded mode must never probe at all;
 *   - OFF must never consult the audio server under any condition.
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.AUDIO_SERVER_TOKEN = 'test-token-not-a-secret';

const guards = require('../src/utils/functions/radioGuards');
const AudioSource = require('../src/audio/AudioSource');
const lang = require('../lang/en.json');
const { say } = require('../src/utils/functions/messages');

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const logs = [];
function makeClient(mode, { shardId = null, stationState = 'active' } = {}) {
  const provider = { kind: mode, async open() { throw new Error('not used'); } };
  const audio = new AudioSource(mode, provider, { serverUrl: process.env.AUDIO_SERVER_URL });
  audio.getState = () => stationState;
  return {
    audio,
    user: { id: 'bot' },
    shard: shardId === null ? null : { ids: [shardId], count: 16 },
    Radio: new Map(),
    logger: { debug: (m) => logs.push(m), warn() {}, error() {}, log() {} },
  };
}

/** A stand-in audio server. `mode` decides how it answers. */
function startServer(mode) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      if (mode === 'unauthorized' || auth !== `Bearer ${process.env.AUDIO_SERVER_TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      if (mode === 'slow') return; // never answers: forces the probe timeout
      if (mode === 'error') {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'failed' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stations: [], totals: { ffmpeg: 1 } }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const sawAuthHeader = [];

async function main() {
  // ── 1. reachable remote server: ON must be allowed (the bug) ────────────
  {
    const server = await startServer('ok');
    server.on('request', (req) => sawAuthHeader.push(req.headers.authorization));
    process.env.AUDIO_SERVER_URL = `http://127.0.0.1:${server.address().port}`;

    const client = makeClient('remote', { shardId: 3 });
    record(
      'remote: a fresh AudioSource reports reachability as unknown, not false',
      client.audio.getStats().audioServer.reachable === null,
      `reachable=${client.audio.getStats().audioServer.reachable}`,
    );

    guards._resetProbeCache();
    const r = await guards.checkStationHealth(client, 'http://station', lang);
    record('remote + server up: ON is allowed', r.ok === true, r.message || 'ok');
    record('the probe sent the Authorization header',
      sawAuthHeader.some((h) => h === `Bearer ${process.env.AUDIO_SERVER_TOKEN}`),
      sawAuthHeader[0] ? 'bearer sent' : 'MISSING');
    record('the probe used AUDIO_SERVER_URL',
      client.audio.getStats().audioServer.url === process.env.AUDIO_SERVER_URL,
      client.audio.getStats().audioServer.url);
    record('a successful probe updates the cached status to true',
      client.audio.getStats().audioServer.reachable === true);

    const line = logs.find((l) => l.includes('[radioGuards]'));
    record('a debug line reports mode, shard and reachability',
      Boolean(line) && line.includes('mode=remote') && line.includes('shard=3') && line.includes('value=true'),
      line);

    server.close();
  }

  // ── 2. unknown must never block ─────────────────────────────────────────
  {
    const client = makeClient('remote', { shardId: 0 });
    // A probe that cannot conclude: simulate by pointing at a slow server.
    const server = await startServer('slow');
    process.env.AUDIO_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
    guards._resetProbeCache();

    const started = Date.now();
    const r = await guards.checkStationHealth(client, 'http://station', lang);
    const took = Date.now() - started;

    record('remote + probe times out: ON is still allowed (never block on unknown)',
      r.ok === true, r.message || `ok after ${took}ms`);
    record('the probe gives up quickly', took < 3000, `${took}ms`);
    server.close();
  }

  // ── 3. a real connection failure must block, with the right message ─────
  {
    const client = makeClient('remote', { shardId: 1 });
    // Nothing is listening on this port.
    process.env.AUDIO_SERVER_URL = 'http://127.0.0.1:1';
    guards._resetProbeCache();

    const r = await guards.checkStationHealth(client, 'http://station', lang);
    record('remote + connection refused: ON is blocked', r.ok === false);
    // Compared against the lang file rather than hardcoded wording, so a
    // reworded message does not fail the behavioural assertion.
    record('the message is the unreachable one, with its warning emoji',
      r.message === say(lang, 'radio.errors.audio_server_unreachable'), r.message);
    record('the status is recorded as a measured false',
      client.audio.getStats().audioServer.reachable === false);
  }

  // ── 4. a rejected token must say so, not "unreachable" ──────────────────
  {
    const server = await startServer('unauthorized');
    process.env.AUDIO_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
    const client = makeClient('remote', { shardId: 2 });
    guards._resetProbeCache();

    const r = await guards.checkStationHealth(client, 'http://station', lang);
    record('remote + 401: ON is blocked', r.ok === false);
    record('the message is the credentials one, not the unreachable one',
      r.message === say(lang, 'radio.errors.audio_server_auth')
      && r.message !== say(lang, 'radio.errors.audio_server_unreachable'),
      r.message);
    server.close();
  }

  // ── 5. embedded mode must not probe ─────────────────────────────────────
  {
    process.env.AUDIO_SERVER_URL = 'http://127.0.0.1:1'; // would refuse if probed
    const client = makeClient('embedded', { shardId: 7 });
    logs.length = 0;
    guards._resetProbeCache();

    const r = await guards.checkStationHealth(client, 'http://station', lang);
    record('embedded: ON is allowed even with no audio server at all', r.ok === true, r.message || 'ok');
    const line = logs.find((l) => l.includes('[radioGuards]'));
    record('embedded is logged as skipped', Boolean(line) && line.includes('value=skipped'), line);
    record('embedded leaves reachability unknown',
      client.audio.getStats().audioServer.reachable === null);
  }

  // ── 6. a failed station still blocks, in either mode ────────────────────
  {
    process.env.AUDIO_SERVER_URL = 'http://127.0.0.1:1';
    const client = makeClient('embedded', { stationState: 'failed' });
    guards._resetProbeCache();
    const r = await guards.checkStationHealth(client, 'http://station', lang);
    record('a station in failed state blocks with its own message',
      r.ok === false && r.message === say(lang, 'radio.errors.station_failed'), r.message);
  }

  // ── 7. OFF must never depend on the audio server ────────────────────────
  {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/ComponentsAction/settings/onRadio_off_radio.js'), 'utf8',
    );
    // Everything between the OFF branch and the ON branch.
    const offStart = src.indexOf('if (data.enabled) {');
    const onStart = src.indexOf('// ── Turning ON');
    record('the OFF branch is located', offStart > -1 && onStart > offStart);
    const offBranch = src.slice(offStart, onStart);

    record('OFF never calls checkStationHealth', !offBranch.includes('checkStationHealth'));
    record('OFF never calls checkRadioReady', !offBranch.includes('checkRadioReady'));
    record('OFF never probes the audio server', !offBranch.includes('probeAudioServer'));
    record('OFF is reached purely from the stored enabled flag',
      /if \(data\.enabled\) \{/.test(src));

    // And the ON branch must do its checks before mutating anything.
    const onBranch = src.slice(onStart);
    const healthAt = onBranch.indexOf('checkStationHealth');
    const deferAt = onBranch.indexOf('deferUpdate');
    const firstWrite = onBranch.indexOf('db.set(');
    record('ON runs its checks before acknowledging or writing anything',
      healthAt > -1 && healthAt < deferAt && healthAt < firstWrite,
      `health@${healthAt} defer@${deferAt} write@${firstWrite}`);
    record('a failed ON repairs a stale connection instead of stacking one',
      onBranch.includes('stale') && onBranch.includes('client.Radio.delete'));
  }

  // ── 8. the panel never pings ────────────────────────────────────────────
  {
    const build = require('../src/utils/functions/ControlData');
    const stations = require('../src/utils/helpers/RadioChannels');
    const client = makeClient('embedded');
    const payload = build(client, {
      guildId: 'g1', channelId: 'c1', url: stations[0].value,
      enabled: false, offBy: '768414261231747093', offAt: 1730000000,
    }, lang);

    record('the panel payload suppresses all mentions',
      JSON.stringify(payload.allowedMentions) === '{"parse":[]}',
      JSON.stringify(payload.allowedMentions));
    const json = JSON.stringify(payload.components[0].toJSON());
    record('the mention is still a real clickable <@id>', json.includes('<@768414261231747093>'));
    record('the not-configured payload also suppresses mentions',
      JSON.stringify(build(client, null, lang).allowedMentions) === '{"parse":[]}');
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
