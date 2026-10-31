/**
 * Audio server verification harness.
 *
 *   node tests/audio-server.test.js
 *   node tests/audio-server.test.js "https://Qurango.net/radio/maher_al_meaqli"
 *
 * Spawns audio-server.js as a child process against ONE real station URL and
 * checks the three properties the refactor is supposed to guarantee:
 *
 *   1. a late-joining consumer still gets a valid OGG/Opus stream
 *      (header pages replayed, not just mid-stream audio pages)
 *   2. N concurrent requests for one station produce exactly ONE ffmpeg
 *   3. zero ffmpeg children survive shutdown
 *
 * This process never touches Discord and never reads the bot token. It does
 * make a real outbound connection to a radio station, which is the point —
 * the whole pipeline (axios -> ffmpeg -> OGG -> HTTP) is what's under test.
 *
 * ffmpeg accounting goes through the server's own /health rather than scraping
 * the process table, so the check is identical on Windows and Linux.
 *
 * Exit code 0 = all passed, 1 = something failed.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const RadioChannels = require('../src/utils/helpers/RadioChannels');

const PORT = Number(process.env.TEST_AUDIO_PORT) || 3941;
const TOKEN = 'test-token-not-a-secret';
const BASE = `http://127.0.0.1:${PORT}`;
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// First quran station by default; override with argv[2].
const STATION = process.argv[2] || RadioChannels.find((r) => r.group === 'quran').value;

const CONCURRENT = 6;        // simultaneous consumers for the dedup check
const LATE_JOIN_AFTER = 6000; // ms to wait before the late joiner connects
const IDLE_MS = 5000;          // short, so the idle sweep is observable in-test
const BOOT_TIMEOUT = 20_000;
const STREAM_TIMEOUT = 30_000;

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * For checks that depend on a third-party radio host cooperating. A station
 * that refuses a reconnect is an upstream fact, not a defect in this code, and
 * must not be reported as a failure — but it must still be visible.
 */
function skip(name, detail) {
  results.push({ name, passed: true, skipped: true, detail });
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Open a stream and keep draining it in the background until aborted — a
 * stand-in for a guild that stays connected. Needed so the late-join check
 * measures header replay rather than accidentally measuring the idle sweep.
 */
function holdStream(url) {
  const ac = new AbortController();
  const state = { bytes: 0, status: null, prefix: Buffer.alloc(0), error: null, done: false };
  const ready = (async () => {
    const res = await fetch(url, { headers: AUTH, signal: ac.signal });
    state.status = res.status;
    if (!res.ok) return state;
    const reader = res.body.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { state.done = true; break; }
          state.bytes += value.length;
          if (state.prefix.length < 8192) {
            state.prefix = Buffer.concat([state.prefix, Buffer.from(value)]);
          }
        }
      } catch (err) { state.error = err; }
    })().catch(() => {});
    const deadline = Date.now() + STREAM_TIMEOUT;
    while (state.prefix.length < 2048 && !state.error && Date.now() < deadline) await sleep(100);
    return state;
  })();
  return { ready, state, abort: () => ac.abort() };
}

/** Read at most `maxBytes` of a stream response, then abort. */
async function readPrefix(url, maxBytes = 8192, timeoutMs = STREAM_TIMEOUT) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: AUTH, signal: ac.signal });
    if (!res.ok) return { status: res.status, buf: Buffer.alloc(0) };

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    reader.cancel().catch(() => {});
    return { status: res.status, buf: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A valid OGG/Opus stream prefix starts with an 'OggS' page whose payload is
 * the OpusHead identification header. Checking only for the magic bytes
 * somewhere in the buffer would pass on a mid-stream splice, which is exactly
 * the bug the header replay exists to prevent.
 */
function validateOggOpus(buf) {
  if (buf.length < 28) return `too short (${buf.length} bytes)`;
  if (buf.slice(0, 4).toString('latin1') !== 'OggS') return 'does not start with an OggS page';
  if (buf[4] !== 0) return `unexpected OGG version byte ${buf[4]}`;
  if (buf.indexOf(Buffer.from('OpusHead')) === -1) return 'no OpusHead in the prefix';
  return null;
}

async function health() {
  const res = await fetch(`${BASE}/health`, { headers: AUTH });
  if (!res.ok) throw new Error(`/health ${res.status}`);
  return res.json();
}

async function waitForBoot() {
  const deadline = Date.now() + BOOT_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      await health();
      return true;
    } catch (_) {
      await sleep(300);
    }
  }
  return false;
}

/**
 * Real radio hosts sometimes take several seconds to accept a connection, or
 * refuse the first one outright (a 15s axios timeout then a backoff retry).
 * Assertions about fan-out and header replay must not turn into false failures
 * because of that, so gate them behind the station actually reaching 'active'.
 * @returns {Promise<object|null>} the station's /health entry, or null
 */
async function waitForActive(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let nudged = 0;
  while (Date.now() < deadline) {
    const st = (await health()).stations.find((s) => s.url === STATION);
    if (st && st.state === 'active') return st;
    // Stations only start on demand; poke it, then let the hub's own retry
    // policy do the work.
    if (!st && nudged < 25) { nudged++; readPrefix(url, 512, 5000).catch(() => {}); }
    await sleep(1000);
  }
  return null;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function main() {
  console.log(`station : ${STATION}`);
  console.log(`server  : ${BASE}\n`);

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'audio-server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      AUDIO_SERVER_PORT: String(PORT),
      AUDIO_SERVER_TOKEN: TOKEN,
      AUDIO_STATION_IDLE_MS: String(IDLE_MS),
      testMode: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog = [];
  const keep = (d) => { serverLog.push(d.toString()); if (serverLog.length > 60) serverLog.shift(); };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);

  let recordedPids = [];

  try {
    if (!await waitForBoot()) {
      record('audio server boots and answers /health', false, `no response in ${BOOT_TIMEOUT}ms`);
      return;
    }
    record('audio server boots and answers /health', true);

    // ── auth is mandatory, including on /health ──────────────────────────
    const noAuth = await fetch(`${BASE}/health`);
    record('unauthenticated request is rejected', noAuth.status === 401, `got ${noAuth.status}`);

    const badUrl = await fetch(`${BASE}/stream?url=${encodeURIComponent('http://example.com/evil')}`, { headers: AUTH });
    record('non-allowlisted url is refused', badUrl.status === 403, `got ${badUrl.status}`);

    // ── 2. concurrency: N consumers, one ffmpeg ──────────────────────────
    const streamUrl = `${BASE}/stream?url=${encodeURIComponent(STATION)}`;

    const warm = await waitForActive(streamUrl);
    if (!warm) {
      record('station reaches active state', false, `upstream never became active — ${STATION} may be down; later checks skipped`);
      return;
    }
    record('station reaches active state', true, `pid=${warm.ffmpegPid}`);

    // A consumer that stays connected for the rest of the run, so the station
    // stays warm and the late-join check below isn't silently measuring the
    // idle sweep instead of the header replay.
    const held = holdStream(streamUrl);
    await held.ready;
    const heldErr = held.state.status === 200 ? validateOggOpus(held.state.prefix) : `status ${held.state.status}`;
    record('long-lived consumer gets valid OGG/Opus', !heldErr, heldErr || `${held.state.prefix.length} byte prefix`);

    const firstWave = await Promise.all(
      Array.from({ length: CONCURRENT }, () => readPrefix(streamUrl)),
    );

    const okCount = firstWave.filter((r) => r.status === 200 && !validateOggOpus(r.buf)).length;
    record(
      `${CONCURRENT} concurrent consumers all get valid OGG/Opus`,
      okCount === CONCURRENT,
      `${okCount}/${CONCURRENT} valid` +
        (okCount < CONCURRENT ? ` (first failure: ${validateOggOpus(firstWave.find((r) => validateOggOpus(r.buf))?.buf || Buffer.alloc(0)) || `status ${firstWave[0].status}`})` : ''),
    );

    const h1 = await health();
    const station = h1.stations.find((s) => s.url === STATION);
    const pids = h1.stations.map((s) => s.ffmpegPid).filter((p) => p != null);
    recordedPids = [...new Set(pids)];

    record(
      'exactly one ffmpeg for one station under concurrency',
      recordedPids.length === 1 && h1.totals.ffmpeg === 1,
      `distinct pids=${recordedPids.length} health.totals.ffmpeg=${h1.totals.ffmpeg} stations=${h1.stations.length}`,
    );
    record(
      'station reports a live upstream',
      !!station && station.state === 'active' && station.lastDataAgeMs != null && station.lastDataAgeMs < 15000,
      station ? `state=${station.state} lastDataAgeMs=${station.lastDataAgeMs}` : 'station missing from /health',
    );

    // ── 1. late joiner gets a valid stream, not a mid-stream splice ──────
    // Re-read the pid here rather than reusing the one from the concurrency
    // step: if the upstream hiccuped in between, the hub will have reconnected
    // on purpose and a changed pid would say nothing about the late joiner.
    const pidBeforeLateJoin = (await health()).stations.find((s) => s.url === STATION)?.ffmpegPid ?? null;
    await sleep(LATE_JOIN_AFTER);
    const late = await readPrefix(streamUrl);
    const lateErr = late.status === 200 ? validateOggOpus(late.buf) : `status ${late.status}`;
    record(
      `late joiner (+${LATE_JOIN_AFTER}ms) gets a valid OGG/Opus stream`,
      !lateErr,
      lateErr || `${late.buf.length} bytes, header replayed`,
    );

    const h2 = await health();
    const pids2 = [...new Set(h2.stations.map((s) => s.ffmpegPid).filter((p) => p != null))];
    record(
      'late joiner reuses the same ffmpeg (no second spawn)',
      pids2.length === 1 && pids2[0] === pidBeforeLateJoin,
      `before=${pidBeforeLateJoin} after=${pids2.join(',')}`,
    );

    // ── upstream restart mid-stream: chained OGG must not strand anyone ──
    // Killing ffmpeg forces a new logical OGG stream with a NEW serial number.
    // prism-media's OggDemuxer locks onto the first serial and silently drops
    // everything else, so a consumer kept across the restart would go
    // permanently quiet with no error. The hub must end connected consumers
    // instead, so they see a clean end-of-stream and reconnect.
    const restartVictim = holdStream(streamUrl);
    await restartVictim.ready;
    const pidBefore = (await health()).stations.find((s) => s.url === STATION)?.ffmpegPid;

    let endedCleanly = false;
    const watchEnd = (async () => {
      const startBytes = restartVictim.state.bytes;
      for (let i = 0; i < 60; i++) {           // up to ~15s
        await sleep(250);
        // 'ended' == the body completed or aborted; either way the consumer is
        // not left silently connected to a stream it can never decode.
        if (restartVictim.state.done || restartVictim.state.error) { endedCleanly = true; return; }
        if (i > 8 && restartVictim.state.bytes === startBytes) {
          // Stopped receiving but the body never ended — the stuck case.
          return;
        }
      }
    })();

    try { process.kill(pidBefore, 'SIGKILL'); } catch (_) {}
    await watchEnd;

    record(
      'consumer is ended (not left silently stuck) when ffmpeg restarts',
      endedCleanly,
      endedCleanly ? 'body ended after the restart' : 'still connected but receiving nothing — STUCK',
    );

    // The hub must own the recovery: a station that just lost its upstream has
    // to be retrying, not abandoned. This part is about OUR code and is
    // asserted unconditionally.
    const postKill = (await health()).stations.find((s) => s.url === STATION);
    record(
      'hub owns recovery after the restart (retrying or already back)',
      postKill === undefined || postKill.attempts >= 1 || postKill.state === 'active',
      postKill ? `state=${postKill.state} attempts=${postKill.attempts}` : 'station swept (0 listeners) — restarts on demand',
    );

    // Then the realistic rejoin: a guild whose player went Idle asks again, and
    // keeps waiting through the hub's backoff if the host is slow. Whether the
    // third-party host accepts a fresh connection within the window is NOT
    // something this code controls, so that part can only skip, never fail.
    const back = await waitForActive(streamUrl, 90_000);
    if (!back) {
      skip('post-restart joiner gets the NEW header', `${STATION} did not accept a new connection within 90s`);
      skip('station is serving again on a different ffmpeg', 'upstream unavailable');
    } else {
      const rejoin = holdStream(streamUrl);
      await rejoin.ready;
      const rejoinErr = rejoin.state.status === 200 ? validateOggOpus(rejoin.state.prefix) : `status ${rejoin.state.status}`;
      record(
        'post-restart joiner gets the NEW header, not the stale one',
        !rejoinErr,
        rejoinErr || `${rejoin.state.prefix.length} bytes, valid OpusHead`,
      );
      record(
        'station is serving again on a different ffmpeg',
        back.ffmpegPid != null && back.ffmpegPid !== pidBefore,
        `before=${pidBefore} after=${back.ffmpegPid}`,
      );
      rejoin.abort();
    }
    restartVictim.abort();

    // ── idle sweep: last listener leaves => upstream is torn down (I2) ───
    held.abort();
    const sweptPid = (await health()).stations.find((s) => s.url === STATION)?.ffmpegPid ?? null;
    await sleep(Number(IDLE_MS) + 3000);
    const h3 = await health();
    record(
      `idle sweep stops the station ${IDLE_MS}ms after the last listener`,
      h3.stations.length === 0 && h3.totals.ffmpeg === 0 && (sweptPid == null || !pidAlive(sweptPid)),
      `stations=${h3.stations.length} ffmpeg=${h3.totals.ffmpeg} pid=${sweptPid} stillAlive=${sweptPid != null && pidAlive(sweptPid)}`,
    );

    // ── 3. shutdown leaves nothing behind ────────────────────────────────
    // Spawn a fresh station first, otherwise the idle sweep above has already
    // emptied the process table and this assertion would be vacuous.
    await readPrefix(streamUrl, 4096);
    const h4 = await health();
    recordedPids = [...new Set(h4.stations.map((s) => s.ffmpegPid).filter((p) => p != null))];

    const exited = new Promise((resolve) => server.once('exit', (code, sig) => resolve({ code, sig })));
    server.kill('SIGTERM');
    const outcome = await Promise.race([exited, sleep(12_000).then(() => null)]);
    record('server exits on SIGTERM', outcome !== null, outcome ? `code=${outcome.code} sig=${outcome.sig}` : 'still running after 12s');

    // Give the OS a moment to reap the children.
    await sleep(1500);
    const survivors = recordedPids.filter(pidAlive);
    record(
      'zero ffmpeg children survive shutdown',
      survivors.length === 0,
      survivors.length ? `orphaned pids: ${survivors.join(',')}` : `checked ${recordedPids.length} pid(s)`,
    );
    if (survivors.length) {
      console.log('\n  NOTE: on Windows, child.kill("SIGTERM") terminates the process without');
      console.log('  running its signal handlers, so this can fail here while passing on Linux.');
      console.log('  Orphans still indicate ffmpeg is not dying from stdin EOF — worth fixing.');
    }
  } catch (err) {
    record('harness completed without throwing', false, err.message);
  } finally {
    if (!server.killed) { try { server.kill('SIGKILL'); } catch (_) {} }
    for (const pid of recordedPids) { if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} } }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nlast server output:');
    console.log(serverLog.join('').split('\n').slice(-12).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
