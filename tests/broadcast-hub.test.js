/**
 * BroadcastHub unit checks — no network, no ffmpeg, no Discord.
 *
 *   node tests/broadcast-hub.test.js
 *
 * Drives the hub with a fake UpstreamProvider so the behaviours that are
 * awkward to force against a real radio station become deterministic:
 *
 *   - concurrent getOrCreate for one url opens the upstream exactly once
 *   - an upstream that goes quiet without closing is caught by the watchdog
 *   - on a drop, connected listeners are ENDED (so a player goes Idle) rather
 *     than left attached to a stream whose serial number has changed
 *   - the cached OGG header is REPLACED after a reconnect, so a later joiner
 *     is served the new logical stream's header and not the stale one
 *
 * That last pair is what makes remote mode safe at both layers. On the audio
 * server the hub's listeners are the client HTTP responses, so ending them
 * closes those connections; the bot's own hub then sees an ordinary upstream
 * end, reconnects, and re-captures the header through this same code path. A
 * new logical stream can therefore never appear mid-stream on a connection
 * that is already open — which matters because prism-media's OggDemuxer locks
 * onto the first serial it sees and silently discards everything else
 * (node_modules/prism-media/src/opus/OggDemuxer.js:93-99).
 */
'use strict';

const { PassThrough } = require('stream');
const BroadcastHub = require('../src/audio/BroadcastHub');
const { findOggHeaderEnd, parsePages } = require('../src/audio/OggPageParser');

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── minimal OGG page builder ─────────────────────────────────────────────
// CRC is left zero: neither our parser nor prism's demuxer verifies it.
function buildPage({ serial, headerType = 0, seq = 0, payload }) {
  const segments = [];
  let remaining = payload.length;
  while (remaining >= 255) { segments.push(255); remaining -= 255; }
  segments.push(remaining);

  const head = Buffer.alloc(27 + segments.length);
  head.write('OggS', 0, 'latin1');
  head[4] = 0;                       // version
  head[5] = headerType;              // 0x02 = BOS
  head.writeUInt32BE(serial, 14);
  head.writeUInt32BE(seq, 18);
  head[26] = segments.length;
  for (let i = 0; i < segments.length; i++) head[27 + i] = segments[i];
  return Buffer.concat([head, payload]);
}

function opusStream(serial) {
  const headPayload = Buffer.concat([Buffer.from('OpusHead', 'latin1'), Buffer.alloc(11)]);
  const tagsPayload = Buffer.concat([Buffer.from('OpusTags', 'latin1'), Buffer.alloc(16)]);
  return {
    header: Buffer.concat([
      buildPage({ serial, headerType: 0x02, seq: 0, payload: headPayload }),
      buildPage({ serial, headerType: 0x00, seq: 1, payload: tagsPayload }),
    ]),
    audio: (seq, byte) => buildPage({ serial, seq, payload: Buffer.alloc(80, byte) }),
  };
}

/** Reads the serial number out of the first OGG page in a buffer. */
function firstSerial(buf) {
  const { pages } = parsePages(buf);
  if (!pages.length) return null;
  return pages[0].buffer.readUInt32BE(14);
}

// ── fake provider ────────────────────────────────────────────────────────
function makeFakeProvider() {
  const state = { opens: 0, current: null, failNext: 0 };
  return {
    kind: 'embedded',
    state,
    async open() {
      state.opens += 1;
      if (state.failNext > 0) { state.failNext -= 1; throw new Error('fake open failure'); }
      const stream = new PassThrough();
      let destroyed = false;
      const handle = {
        stream,
        pid: 1000 + state.opens,
        destroy: () => { if (destroyed) return; destroyed = true; stream.destroy(); },
      };
      state.current = handle;
      return handle;
    },
  };
}

async function main() {
  // ── header parsing sanity, incl. the OggS-in-payload collision ─────────
  const s1 = opusStream(111);
  record('findOggHeaderEnd locates the end of a real two-page header',
    findOggHeaderEnd(Buffer.concat([s1.header, s1.audio(2, 0xaa)])) === s1.header.length,
    `${findOggHeaderEnd(Buffer.concat([s1.header, s1.audio(2, 0xaa)]))} == ${s1.header.length}`);

  const collide = buildPage({ serial: 111, seq: 2, payload: Buffer.concat([
    Buffer.from('OggS', 'latin1'), Buffer.alloc(40, 0x5a),
  ]) });
  record('header detection survives an OggS sequence inside a payload',
    findOggHeaderEnd(Buffer.concat([s1.header, collide])) === s1.header.length);

  // ── in-flight dedup ────────────────────────────────────────────────────
  const provider = makeFakeProvider();
  const hub = new BroadcastHub(provider, {
    stallMs: 1200, retryFloorMs: 150, retryCapMs: 300,
    failedRetryMs: 400, maxAttempts: 3, idleMs: 60_000,
  });
  const URL = 'fake://station';

  await Promise.all(Array.from({ length: 6 }, () => hub.getOrCreate(URL)));
  record('6 concurrent getOrCreate open the upstream once', provider.state.opens === 1,
    `opens=${provider.state.opens}`);

  // ── first listener gets the serial-111 header ──────────────────────────
  provider.state.current.stream.write(s1.header);
  provider.state.current.stream.write(s1.audio(2, 0x01));
  await sleep(60);

  const a = hub.createGuildStream(URL);
  let aChunks = [];
  let aEnded = false;
  a.on('data', (c) => aChunks.push(c));
  a.on('end', () => { aEnded = true; });
  provider.state.current.stream.write(s1.audio(3, 0x02));
  await sleep(60);

  record('listener receives a header-prefixed stream', firstSerial(Buffer.concat(aChunks)) === 111,
    `serial=${firstSerial(Buffer.concat(aChunks))}`);

  // ── stall watchdog: upstream goes quiet without closing ────────────────
  const stalled = new Promise((resolve) => hub.once('broadcast:stall', resolve));
  await Promise.race([stalled, sleep(4000)]);
  record('watchdog fires when the upstream goes quiet without closing',
    hub.getState(URL) !== 'active', `state=${hub.getState(URL)}`);

  // the drop must END the listener, not leave it attached and silent
  await sleep(100);
  record('drop ends connected listeners so the player can go Idle', aEnded);

  // ── reconnect replaces the cached header (new serial) ──────────────────
  // The hub reconnects on its own; feed the new logical stream once it has.
  for (let i = 0; i < 40 && provider.state.opens < 2; i++) await sleep(50);
  record('hub reconnected on its own', provider.state.opens >= 2, `opens=${provider.state.opens}`);

  const s2 = opusStream(222);
  provider.state.current.stream.write(s2.header);
  provider.state.current.stream.write(s2.audio(2, 0x03));
  await sleep(80);

  const b = hub.createGuildStream(URL);
  const bChunks = [];
  b.on('data', (c) => bChunks.push(c));
  provider.state.current.stream.write(s2.audio(3, 0x04));
  await sleep(80);

  const bSerial = firstSerial(Buffer.concat(bChunks));
  record('post-reconnect joiner gets the NEW header, never the stale one',
    bSerial === 222, `serial=${bSerial} (222 expected, 111 would be the stale cache)`);

  // ── refcount/idle bookkeeping ──────────────────────────────────────────
  const statsBefore = hub.getStats();
  hub.releaseGuildStream(URL, b);
  await sleep(30);
  const statsAfter = hub.getStats();
  record('releasing a listener decrements the live listener count',
    statsAfter.broadcasts[0].listeners < statsBefore.broadcasts[0].listeners
      || statsAfter.broadcasts.length === 0,
    `${statsBefore.broadcasts[0]?.listeners} -> ${statsAfter.broadcasts[0]?.listeners}`);

  // a directly destroyed stream must also decrement, or the idle sweep strands
  const c = hub.createGuildStream(URL);
  const withC = hub.getStats().broadcasts[0].listeners;
  c.destroy();
  await sleep(50);
  const afterC = hub.getStats().broadcasts[0]?.listeners ?? 0;
  record('a directly destroyed listener also decrements', afterC < withC, `${withC} -> ${afterC}`);

  // ── failed state + recovery event ──────────────────────────────────────
  const d = hub.createGuildStream(URL);
  d.resume();
  provider.state.failNext = 99;              // every reopen fails from here
  const failed = new Promise((resolve) => hub.once('broadcast:failed', resolve));
  provider.state.current.destroy();           // force a drop
  const gotFailed = await Promise.race([failed.then(() => true), sleep(5000).then(() => false)]);
  record('attempts are bounded and end in a failed state', gotFailed,
    `state=${hub.getState(URL)}`);

  const recovered = new Promise((resolve) => hub.once('broadcast:recovered', resolve));
  provider.state.failNext = 0;                // station comes back
  const gotRecovered = await Promise.race([recovered.then(() => true), sleep(5000).then(() => false)]);
  record('a failed station recovers on its own and emits broadcast:recovered', gotRecovered);

  await hub.destroy();
  record('destroy() leaves no broadcasts behind', hub.getStats().broadcasts.length === 0);

  // ── a long outage must not strand a waiting consumer ───────────────────
  // A drop ends every listener, so refCount is 0 and the idle sweep is free to
  // delete the entry and cancel its retries — leaving a guild subscribed to
  // broadcast:recovered that can never fire. markWanted is what prevents that.
  const deadProvider = { kind: 'remote', async open() { throw new Error('ECONNREFUSED'); } };
  const mkDeadHub = () => new BroadcastHub(deadProvider, {
    idleMs: 600, retryFloorMs: 80, retryCapMs: 150, failedRetryMs: 200, maxAttempts: 2,
    logger: { error() {}, warn() {}, log() {} },
  });
  const DEAD = 'fake://down';

  const unwantedHub = mkDeadHub();
  await unwantedHub.getOrCreate(DEAD).catch(() => {});
  await sleep(1400);                                     // well past idleMs
  record('an unwanted dead station IS swept (no pointless retrying)',
    !unwantedHub.broadcasts.has(DEAD));
  await unwantedHub.destroy();

  const wantedHub = mkDeadHub();
  wantedHub.markWanted(DEAD);
  await sleep(1400);                                     // same wait
  record('a WANTED dead station survives the idle sweep and keeps retrying',
    wantedHub.broadcasts.has(DEAD), `state=${wantedHub.getState(DEAD)}`);

  // and it must recover once the station returns
  let deadOpens = 0;
  deadProvider.open = async () => {
    deadOpens++;
    const stream = new PassThrough();
    return { stream, pid: 7777, destroy: () => stream.destroy() };
  };
  const cameBack = await Promise.race([
    new Promise((r) => wantedHub.once('broadcast:recovered', () => r(true))),
    sleep(4000).then(() => false),
  ]);
  record('a wanted station recovers by itself when the server returns', cameBack,
    `opens=${deadOpens}`);

  wantedHub.unmarkWanted(DEAD);
  await wantedHub.destroy();

  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failedCount}/${results.length} passed`);
  if (failedCount) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
