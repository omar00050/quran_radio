# Audio distribution — risk analysis

Static analysis of the audio broadcast subsystem. Nothing was executed except two read-only probes
of the vendored ffmpeg binary (`-version`, `-encoders`); the bot was not run, and no code outside
`docs/` was modified.

Every claim cites `file:line`. Where the code cannot answer a question — production shard count,
host specs, upstream codecs, whether a symptom has actually been observed — that is said plainly
rather than assumed, and the open items are collected in §5.

---

## 1. Summary

The broadcast pooling design is genuinely good and the recent work on it shows real care: a single
HTTP pull and a single encode serve every guild on a shard, the OGG header replay
(`AudioBroadcaster.js:38`, `:126-131`) correctly solves mid-stream joining, the release-after-play
ordering (`joinAndPlayQuran.js:37-39`, `:59-60`) eliminates the audible gap on station switch, and
reading the live URL from `radioUrlCache` instead of a closure (`joinAndPlayQuran.js:32`) closes a
whole family of stale-handler bugs. The problems are not in the fan-out; they are in **lifecycle
management**. Nothing in the system ever decides that a broadcast should stop, that a retry should
give up, or that two callers should not start the same thing twice — and every such gap resolves in
the direction of "more processes, more bandwidth, forever".

The three most serious issues:

1. **A station that stalls without closing its socket produces permanent silence with no recovery
   path** (§C1). The 15-second axios timeout covers response headers only, so a source that stops
   sending bytes while holding the connection open never fires `error` or `close`, `onDrop` never
   runs, and because `_destroyEntry` never ends the listener streams
   (`AudioBroadcaster.js:187-191`) the per-guild `Idle` handler never fires either. Nothing notices.
2. **`/refresh` silently doubles the ffmpeg population and orphans the old processes** (§C2). It
   purges `src/utils` from `require.cache` (`refrishCommands.js:5`), which includes the module
   holding the broadcaster singleton (`joinAndPlayQuran.js:8`), so a second `AudioBroadcaster` is
   constructed while the first one's children keep running unreachably. The guard meant to prevent
   this cannot work: it reads `.broadcasts` off the exported **class** (`refrishCommands.js:16-17`
   vs `AudioBroadcaster.js:194`).
3. **The bot pays full CPU and bandwidth for guilds nobody is listening to** (§C5, §C6). The
   "stop when the channel is empty" feature pauses audio for exactly five seconds before the `Idle`
   handler restarts it (`joinAndPlayQuran.js:143-152` has no emptiness check), and startup restore
   ignores each guild's `enabled` flag and writes `enabled = true` back
   (`ready.js:159`, `:175`), so guilds that deliberately turned the radio off are switched back on
   at every restart. Together these make the 128 kbit/s egress (§M6) apply to essentially every
   guild that has ever run `/setup radio`.

None of this is visible from inside the process: `getStats()` only reports entries still in the Map
and still `active` (`AudioBroadcaster.js:65-74`), and `setMaxListeners(999999999)`
(`index.js:10`) suppresses Node's leak warnings globally.

---

## 2. Weaknesses by severity

### Critical

---

#### C1 — A stalled source causes permanent silence that nothing detects

**Problem.** There is no watchdog anywhere on the audio path. The only two things that can trigger
recovery are an ffmpeg exit and an HTTP stream `error`:

```js
ffmpeg.on('close', onDrop);        // AudioBroadcaster.js:156
response.data.on('error', onDrop); // AudioBroadcaster.js:157
```

Neither fires for the most common radio failure mode — a server that accepts the connection, sends
headers, then goes quiet (or trickles bytes) without closing the TCP socket. `axios.get(url,
{ responseType: 'stream', timeout: 15_000 })` (`AudioBroadcaster.js:85`) applies its timeout to
response *headers*; once the stream is handed over, axios stops supervising it. ffmpeg, reading from
`pipe:0`, simply waits for more input and does not exit.

The second half is worse. When recovery *does* give up, the guild streams are left open forever:

```js
_destroyEntry(entry) {
  entry.active = false;
  try { entry.source?.destroy(); }  catch (_) {}
  try { entry.ffmpeg?.kill('SIGKILL'); } catch (_) {}
}                                    // AudioBroadcaster.js:187-191
```

Compare `cleanup()`, which *does* tear down listeners (`AudioBroadcaster.js:59`). `_destroyEntry`
never calls `.end()` or `.destroy()` on any member of `entry.listeners`. So each guild's
`PassThrough` stays open and simply never receives another byte. Because the stream never ends, the
`AudioPlayer` has no reason to transition to `Idle`, and the one self-healing mechanism —
`player.on(AudioPlayerStatus.Idle)` at `joinAndPlayQuran.js:143-152` — never fires.

**Evidence.** `AudioBroadcaster.js:85` (timeout scope), `:146-157` (the only triggers),
`:187-191` (listeners not ended), `:59` (the contrasting teardown that does end them),
`joinAndPlayQuran.js:143-152` (the recovery path that depends on an `Idle` transition).

**Impact.** A single misbehaving station silently kills audio for every guild on it, on that shard,
until the process restarts. Users see the bot connected and the control panel saying it is playing.
No log line is produced after the initial failure. With 23 Quran stations behind two or three hosts,
one host misbehaving affects a large share of guilds at once.

**Confidence.** High on the broadcaster side (plainly visible in the code). The exact
`AudioPlayer` behaviour for an open-but-silent stream is inferred from the absence of an end/error
event rather than verified against `@discordjs/voice` 0.19.1 at runtime — worth confirming, but the
missing watchdog is a defect either way.

---

#### C2 — `/refresh` constructs a second broadcaster and orphans the first

**Problem.** The broadcaster is a module-level singleton:

```js
const broadcaster = new AudioBroadcaster();   // joinAndPlayQuran.js:8
```

`/refresh` purges the require cache for four directories, `src/utils` among them:

```js
const HOT_DIRS = ['src/utils', 'src/Commands', 'src/ComponentsAction', 'src/events'];
// refrishCommands.js:5
for (const dir of HOT_DIRS) {
  recursiveReadDirSync(dir).forEach(fp => {
    const resolved = require.resolve(fp);
    if (!excluded.has(resolved)) delete require.cache[resolved];
  });
}                                             // refrishCommands.js:46-51
```

`src/utils/functions/joinAndPlayQuran.js` is inside `src/utils`, so its cache entry is deleted. The
next `require` of it — triggered immediately by `loadComponents` and `loadEvents`
(`refrishCommands.js:60-62`) — re-executes line 8 and constructs a **brand-new**
`AudioBroadcaster` with an empty `broadcasts` Map. The previous instance is no longer referenced by
any module, but its ffmpeg children are alive, its HTTP connections are alive, and its
`ffmpeg.stdout.on('data')` closures keep writing into the `PassThrough` objects that live guilds are
still playing.

The guard that was written to prevent exactly this cannot work:

```js
const STATEFUL_MODULES = [{
  path: '@utils/functions/AudioBroadcaster.js',
  isSafe: () => {
    try {
      const broadcaster = require('@utils/functions/AudioBroadcaster.js');
      return broadcaster.broadcasts.size === 0;     // refrishCommands.js:17
    } catch { return false; }
  },
}];
```

`AudioBroadcaster.js:194` exports `module.exports = AudioBroadcaster` — the **class**, not an
instance. `AudioBroadcaster.broadcasts` is `undefined`, so `.size` throws, the `catch` returns
`false`, and the module is reported as "skipped (active streams)" on every single invocation
regardless of actual state. More importantly, protecting `AudioBroadcaster.js` protects only the
class definition; the singleton lives in `joinAndPlayQuran.js`, which is never excluded.

**Evidence.** `joinAndPlayQuran.js:8`; `refrishCommands.js:5`, `:11-21`, `:33-42`, `:46-51`,
`:60-62`; `AudioBroadcaster.js:194`.

**Impact.** Every `/refresh` while any station is playing: ffmpeg count and upstream connection
count roughly double, and the orphaned processes are unreachable — they are in no Map, so neither
`cleanup()` nor anything else can kill them before process exit. Guilds whose streams are fed by an
orphan keep working, which makes the problem invisible; their `releaseGuildStream` calls now go to
the *new* broadcaster, which has no record of them, so the orphan's listener set never shrinks
either. Run `/refresh` a few times on a busy shard and the host's process table and bandwidth grow
with no way back short of a restart. Also, `client.getBroadcasterStats` was captured at
`ready.js:23` and keeps pointing at the first instance, so the dashboard under-reports after a
refresh.

---

#### C3 — Broadcasts are never torn down; `cleanup()` has no caller

**Problem.** `cleanup(url)` (`AudioBroadcaster.js:56-63`) is the only function that fully disposes
of a broadcast. It is wrapped and exported:

```js
function cleanupBroadcast(url) { broadcaster.cleanup(url); }  // joinAndPlayQuran.js:179
module.exports.cleanupBroadcast  = cleanupBroadcast;          // joinAndPlayQuran.js:182
```

A repo-wide grep for `cleanupBroadcast` and `.cleanup(` finds the definition, the export, and **no
call site**. `releaseGuildStream` removes a single listener (`AudioBroadcaster.js:49-54`) but never
inspects whether the set has become empty. There is no reference counting and no idle sweep — the
30-second auto-clean described in older project notes does not exist in this version of the file.

**Impact.** Once a station has been started on a shard it runs until the process exits, even with
zero listeners. Because `randomChannel`, `nextChannel`, `backChannel` and `Radio_list` let any user
in the voice channel roam the whole 35-station list, each shard drifts monotonically toward holding
**all 35** broadcasts. The theoretical worst case of §W1 is therefore not a tail risk; it is where a
long-running shard ends up.

---

#### C4 — Retry policy: gives up too early where it is centralised, unbounded where it is per-guild

**Problem.** Two separate retry mechanisms, neither with a cap, backoff curve or jitter.

Centralised, in the broadcaster — exactly two attempts, then silence:

```js
setTimeout(() => this._start(url).catch(err => {
  console.error(`[Broadcaster] Reconnect failed:`, err.message);
  setTimeout(() => this._start(url).catch(() => {}), 5_000);   // :152 — final, swallowed
}), 3_000);                                                     // :150
// AudioBroadcaster.js:150-153
```

After the second failure the error is discarded by an empty `catch` and the entry is left in the Map
with `active: false`. No further attempt is ever scheduled.

Per-guild, in `joinAndPlayQuran` — unlimited:

```js
player.on(AudioPlayerStatus.Idle, () => { setTimeout(..., 5_000); });   // :143-152
player.on('error', async (error) => { setTimeout(..., 7_000); });       // :154-165
```

Both re-enter `playBroadcastAudio` → `getOrCreate` → `_start`, each attempt opening a fresh
`axios.get` that can hang for up to 15 seconds against a dead host.

**Impact.** Two opposite failure shapes depending on whether the guild streams error or merely go
quiet. If they go quiet (the §C1 case), recovery stops after two attempts and never resumes. If they
*do* error, every guild on the dead station retries independently every 5–7 seconds forever: 300
guilds on one shard is on the order of 50 outbound connection attempts per second to a host that is
already failing, with one unthrottled `console.error` per attempt per guild (`:151`, `:156`,
`AudioBroadcaster.js:87`). That is both a self-inflicted request storm against a third party and a
log-volume problem.

---

#### C5 — The empty-channel optimisation is cancelled five seconds later

**Problem.** `statusManagerRadio` stops playback when the last human leaves:

```js
if (VoiceUtils.isVoiceChannelEmpty(newState, true) || VoiceUtils.isVoiceChannelEmpty(oldState, true)) {
  if (player.state.status == "idle") return
  player.stop(true);                       // statusManagerRadio.js:20-22
}
```

`player.stop(true)` transitions the player to `Idle`, which fires the handler registered at join
time — and that handler does not check whether anyone is listening:

```js
player.on(AudioPlayerStatus.Idle, () => {
  setTimeout(async () => {
    const conn = client.Radio.get(guildId);
    if (!conn) return;
    if (conn.player.state.status !== AudioPlayerStatus.Idle) return;
    await playBroadcastAudio(conn.player);     // joinAndPlayQuran.js:150
  }, 5_000);
});                                            // joinAndPlayQuran.js:143-152
```

Five seconds after the channel empties, audio restarts. No further `voiceStateUpdate` will arrive
(nobody is joining or leaving an empty channel), so playback continues indefinitely into a channel
with no humans in it.

**Evidence.** `statusManagerRadio.js:20-23`; `joinAndPlayQuran.js:143-152` — no
`isVoiceChannelEmpty` call anywhere in the `Idle` handler, in contrast with the fresh-join path at
`joinAndPlayQuran.js:101` and the `isRunning` path at `:72`, both of which do check.

**Impact.** The single largest unnecessary cost in the system. Every guild with radio enabled holds
a live `PassThrough`, a live voice UDP connection and ~128 kbit/s of egress whether or not a human is
present. `liveSocket.js:124-126` already measures the scale of the waste — it counts these guilds as
`idleRadio` — so the dashboard's `idleRadio` figure is a direct read-out of the problem.

---

#### C6 — Startup restore ignores `enabled` and overwrites it to `true`

**Problem.** The restore guard checks only for a channel id:

```js
if (data?.channelId) joinAndPlayQuran(client, data.channelId, guild, data.url).then(async conn => {
  ...
  client.Radio.set(data.guildId, conn)
  setTimeout(async () => {
    await db.set(`${data.guildId}_radioChannel..enabled`, true)    // ready.js:175
  }, 100 * i);
```

The previous implementation, still present directly below as a comment, did check it:
`// if (data.enabled) {` (`ready.js:205`).

**Evidence.** `ready.js:159` (guard), `ready.js:175` (unconditional write of `true`),
`ready.js:205` (the superseded version that honoured the flag).

**Impact.** Every guild that has ever configured a radio channel is force-started at every restart,
including guilds that explicitly pressed OFF (`onRadio_off_radio.js:56` writes `enabled = false`,
which restore then discards). The user's choice does not survive a restart, and the DB is rewritten
so the original intent is lost permanently. This inflates every capacity number in this report —
the denominator is "guilds that ever ran setup", not "guilds that want radio now" — and it is the
kind of behaviour that reads to a server admin as the bot rejoining on its own.

---

#### C7 — Concurrent `getOrCreate` for the same URL is not deduplicated

**Problem.** `getOrCreate` has no in-flight promise map:

```js
async getOrCreate(url) {
  const existing = this.broadcasts.get(url);
  if (existing?.active) return existing;
  return this._start(url);              // AudioBroadcaster.js:21-25
}
```

`_start` awaits `axios.get` (`:85`) before it registers the new entry at `:117`. Any second caller
arriving inside that window also sees no active entry and also calls `_start`. The last one to reach
`this.broadcasts.set(url, entry)` wins; the others' entries are dropped from the Map while remaining
`active: true` with a live ffmpeg, a live HTTP stream, and a `stdout` handler still writing to
whatever listeners they collected.

This is not hypothetical during startup restore. As computed in
[`startup-restore.md`](./startup-restore.md) §3, joins arrive in bursts of one-per-chunk every five
seconds — 10 to 19 simultaneous joins on a typical shard — and many guilds share the same default
station (`joinAndPlayQuran.js:14` defaults to `process.env.RadioAudioUrl`). Those joins land in the
same `axios.get` window.

**Evidence.** `AudioBroadcaster.js:21-25`, `:85`, `:117`, `:80` (survivor copy),
`:120-144` (the orphan's live `stdout` handler); `ready.js:151-159` (burst concurrency).

**Impact.** Orphaned, unkillable ffmpeg processes and upstream connections — the same end state as
§C2 but reachable without any operator action. Worse, if two live entries for one URL both hold the
same `PassThrough` (possible via the survivor copy at `:80`), two independent OGG streams interleave
into one listener, which is unrecoverable corruption rather than a glitch: the demuxer sees
interleaved pages from two different encoder states.

---

### Medium

---

#### M1 — The 64 KB skip splices the byte stream mid-page

```js
if (stream.writableLength > 65_536) continue;   // AudioBroadcaster.js:141
```

Dropping a whole ffmpeg stdout chunk removes bytes from the middle of a framed container. ffmpeg's
stdout chunks are pipe-sized reads with no relationship to OGG page boundaries, so the listener's
byte stream is rejoined at an arbitrary offset: a partial page followed by what is almost certainly
not a page header. The demuxer must resynchronise on the next `OggS` capture pattern and discard
everything in between; page sequence numbers also jump, which Opus decoders treat as packet loss.

Expected symptom is a glitch or short dropout, possibly an `AudioPlayer` `'error'` that triggers the
7-second rebuild at `joinAndPlayQuran.js:154-165`. Note the threshold is reached only after the
listener is already ~4 seconds behind at 128 kbit/s, so by then a glitch is unavoidable; the
question is only whether it is a clean resync or a corrupted one.

A page-aware drop, or destroying and recreating the guild stream (which would get a clean header
replay via `:38`), would both degrade more gracefully. Related: `highWaterMark: 0` (`:35`) is an
unusual setting whose precise interaction with `writableLength` I did not verify at runtime.

---

#### M2 — OGG header detection is a naive byte scan with a hard assumption

```js
const idx = buf.indexOf(magic, pos);
count++;
if (count === 3) return idx;      // AudioBroadcaster.js:178-181
```

Two weaknesses. First, `indexOf('OggS')` does not validate page structure — the four bytes can occur
inside an Opus payload, which would end header capture early and cache a truncated or misaligned
`oggHeader` that is then replayed to every future joiner on that broadcast. The window is small
(header capture only covers the first few chunks) so the probability is low, but the blast radius is
every guild that joins that broadcast afterwards. Second, the comment at `:170` asserts "OGG Opus
always has exactly 2 header pages"; that is true for typical ffmpeg output but not guaranteed —
`OpusTags` metadata large enough to span pages would make the third `OggS` land mid-header.

Validating the page header (capture pattern + version byte + segment table) rather than scanning for
four raw bytes would remove the whole class.

---

#### M3 — Restore chunking multiplies concurrency instead of spreading it

Chunk timers are 1 second apart while the within-chunk stagger is 5 seconds per index
(`ready.js:149` vs `:158`), so every chunk contributes one join per 5-second window. The join
**rate** is therefore `chunks / 5` per second and grows with guild count, while total duration stays
pinned near 10.5 minutes by the fixed `5000 × 99 = 495 s` tail.

| Radio guilds/shard | Chunks | Last join | Joins per 5 s |
|---|---|---|---|
| 1,000 | 10 | ≈ 10 min 24 s | 10 |
| 1,875 | 19 | ≈ 10 min 33 s | 19 |
| 15,000 (single process) | 150 | ≈ 12 min 44 s | 150 (30/s) |

Full derivation in [`startup-restore.md`](./startup-restore.md) §3. The effect is backwards: adding
guilds raises peak concurrency rather than extending the runway. It also means small deployments
wait the full ~10.5 minutes for no reason, and that the restore window is where §C7's races are most
likely to fire.

---

#### M4 — Double-join and double-subscribe races

Three places where two paths can act on one guild at once:

1. **Restore's guard runs up to 495 seconds before its action.** `client.Radio.has()` is checked at
   `ready.js:157`, then `await sleep(5000 * key)` at `:158`, then the join at `:159`. A user pressing
   ON during that window creates a connection that restore does not see.
2. **The ON button checks the DB flag, not live state.** `onRadio_off_radio.js:32` branches on
   `if (!data.enabled)` and never consults `client.Radio.has()`. Since the disconnect handler writes
   `enabled = false` (`joinAndPlayQuran.js:123`) and restore writes `enabled = true`
   (`ready.js:175`), the flag and the live Map can disagree.
3. **A second fresh join attaches a second player.** `joinAndPlayQuran.js:80-99` unconditionally
   calls `joinVoiceChannel`, then `connection.subscribe(player)` with a newly created player
   (`:94-95`) and attaches another `stateChange` listener (`:114`). `@discordjs/voice` returns the
   *existing* connection for a guild rather than creating a second one, so the result would be two
   players on one connection — two resources, doubled audio, and a leaked `PassThrough` whose
   `conn.guildStream` pointer has been overwritten and can therefore never be released.

Point 3 depends on `joinVoiceChannel`'s dedup semantics in 0.19.1, which I did not verify at
runtime; points 1 and 2 are plainly visible in the code. Component handlers have no per-guild lock
and no cooldown, and `client.UserHold` (`interactionCreate.js:38`) is keyed by user, not guild.

---

#### M5 — Listener-set split-brain when an entry is replaced

```js
const old = this.broadcasts.get(url);
const survivors = old ? new Set(old.listeners) : new Set();   // AudioBroadcaster.js:80
```

`survivors` is a *copy*. `releaseGuildStream` deletes from whatever entry is in the Map **now**
(`:51-52`). If a guild's stream was registered on an entry that has since been replaced, the release
removes it from the new set and the old set keeps the reference. Combined with §C2/§C7, where old
entries can stay alive, this gives streams that no code path can unregister.

---

#### M6 — 128 kbit/s output makes egress the dominant cost

```js
'-b:a', '128k',    // AudioBroadcaster.js:98
'-ac', '2',
```

Encoding bitrate is a per-shard cost, but **egress is per guild** — every voice connection sends its
own UDP stream to Discord. At 15,000 playing guilds, 128 kbit/s each is roughly **1.9 Gbit/s**
sustained outbound, independent of how clever the broadcast pooling is. §C5 and §C6 ensure the
"playing guilds" figure is close to "guilds that ever ran setup" rather than "guilds with listeners".

For recitation, 128 kbit/s stereo is well above the point of diminishing returns. Dropping to 64k —
or to mono, given most upstreams are unlikely to be true stereo — would roughly halve the single
largest resource line in the system. The upstream bitrates are not visible from the code, so the
actual quality ceiling is unknown (§5).

---

#### M7 — `ffmpeg-static` is a convenience wrapper, not a production provisioning strategy

Verified by read-only probe of the vendored binary:

| Property | Value |
|---|---|
| npm package | `ffmpeg-static` 5.2.0 |
| pinned release tag | `b6.0` (`node_modules/ffmpeg-static/package.json`) |
| binary | `ffmpeg version 6.0-essentials_build-www.gyan.dev`, built 2023, gcc 12.2.0 (MSYS2) |
| licence flags | `--enable-gpl --enable-version3` |
| platform in this checkout | `ffmpeg.exe`, 81 MB → Windows |
| `libopus` | present (`A....D libopus`) |

It works, and the pipeline's requirements are satisfied. The production concerns are:

- **Install-time download.** `ffmpeg-static`'s `install.js` fetches the binary from GitHub during
  `npm install`, so it is outside `package-lock.json`'s integrity guarantees and a deploy can fail
  or silently skip on a network blip or in an air-gapped environment.
- **Pinned to a 2023 build.** ffmpeg 6.0 receives no security updates through this channel; a newer
  `ffmpeg-static` release is required to move. The attack surface here is real if narrow: ffmpeg's
  demuxers and decoders parse bytes from third-party radio servers.
- **Licence.** `--enable-gpl --enable-version3`. Fine for running a service; worth a lawyer's glance
  if the bot is ever redistributed as a bundle.
- **Platform.** The vendored binary is Windows, matching `start.vbs`/`stop.vbs`. Spawning several
  hundred processes is materially heavier on Windows than on Linux, which bears directly on §W1.

Alternatives, in rough order of preference for this workload: a distro or official static ffmpeg
pinned in a Dockerfile (patchable, no install-time fetch, reproducible); `@ffmpeg-installer/ffmpeg`
(same model, different maintenance); a single shared transcoder process per host instead of per
shard (§3-I1, which removes most of the problem rather than re-provisioning it); or no ffmpeg at all
for any upstream already serving OGG/Opus, which cannot be determined from the code.

---

#### M8 — Synchronous disk write every 10 seconds in the manager process

```js
fs.writeFileSync(STATUS_FILE, JSON.stringify(stats, null, 2));   // liveSocket.js:197
```

`_collect` runs on a 10-second interval (`liveSocket.js:89`) inside the `ShardingManager` process —
the same event loop that brokers IPC for every shard. A pretty-printed JSON write that grows with
shard count and station count blocks that loop. Small in absolute terms, but it is the one process
whose responsiveness every shard depends on, and `broadcastEval` against 15 shards every 10 seconds
is already the heaviest thing it does.

---

#### M9 — The connection `error` handler releases a stream under a live player

```js
connection.on('error', err => {
  _releaseStream(connection);
  resolve("cantConnect");          // joinAndPlayQuran.js:88-92
});
```

Two problems. `resolve` on an already-settled promise is a no-op, so a caller that received a real
connection can never learn about a later error — the `"cantConnect"` branches in `ready.js:168` and
`onRadio_off_radio.js:35` only ever see failures from the initial call. And `_releaseStream`
destroys the guild's `PassThrough` (`:174`) while the player is still playing that resource, which
induces exactly the error condition that then triggers the 7-second rebuild at `:158-164`. A
connection-level error does not necessarily mean the stream should be discarded.

---

### Minor

- **m1 — leak signals are globally suppressed.** `EventEmitter.setMaxListeners(999999999)`
  (`index.js:10`) means none of the listener accumulation in §C2/§M4 would ever produce a warning.
- **m2 — `getStats()` cannot see the problem.** It iterates only the Map and only `active` entries
  (`AudioBroadcaster.js:65-74`), so orphans (§C2, §C7) and gave-up entries (§C4) are invisible to
  both `/status` (`status_bot.js:46`) and the dashboard.
- **m3 — no memory ceiling.** `ecosystem.config.js` sets `autorestart`, `max_restarts: 10` and
  `min_uptime` but no `max_memory_restart`, so a leaking manager is never recycled; and after ten
  fast crashes pm2 stops trying entirely.
- **m4 — ffmpeg children are not tracked at shutdown.** `shard.js:62-71` kills shard processes only;
  ffmpeg survival depends on stdin EOF or SIGKILL propagation, which I did not verify. Worth
  checking for stray `ffmpeg` processes after a `pm2 stop`.
- **m5 — unthrottled logging on failure paths.** `AudioBroadcaster.js:87`, `:148`, `:161` and
  `joinAndPlayQuran.js:144`, `:156` all log per occurrence, so a station outage produces one line
  per guild per retry cycle. These use `console.*` rather than the pino logger
  (`src/utils/helpers/logger.js`), so they bypass log files and webhook alerting.
- **m6 — no low-latency ffmpeg flags.** No `-flush_packets 1` / `-fflags nobuffer`, so ffmpeg may add
  output buffering; no `-nostdin`, no `-vn`. Minor latency and robustness polish.
- **m7 — `onRadio_off_radio` bypasses the broadcaster API.** `:51` destroys `conn.guildStream`
  directly instead of calling `releaseGuildStream`. It happens to work because `createGuildStream`
  registers a `'close'` handler (`AudioBroadcaster.js:43`), but it couples the component to that
  implementation detail.
- **m8 — dead code in the restore path.** `noCh` is populated at `ready.js:165` and never read; a
  ~30-line commented-out previous implementation sits at `ready.js:203-232`. The latter matters
  because it is the only remaining record that `enabled` used to be honoured (§C6).

---

### W1 — Worst-case resource cost (the ffmpeg multiplication)

Each shard holds its own `AudioBroadcaster` (`joinAndPlayQuran.js:8`), so the same station is
fetched and encoded **once per shard**. Worst case is `shards × distinct stations in use`, and
because of §C3 that worst case is where a long-running shard converges.

Inputs: **35 distinct station URLs** (`RadioChannels.js`, all 35 `value` fields unique). Shard count
is `"auto"` (`shard.js:17`); Discord's recommendation is ~1 shard per 1,000 guilds, and the comment
at `index.js:24` says "8 shards × 5 = 40", suggesting 8 in a recent configuration. Both are shown.

| | 8 shards | 15 shards (≈15k guilds) |
|---|---|---|
| ffmpeg processes | **280** | **525** |
| Outbound HTTP stream connections | **280** | **525** |
| CPU — *estimate*, 2–4 % of a core each | **~6–11 cores** | **~10–21 cores** |
| RSS — *estimate*, 25–60 MB each | **~7–17 GB** | **~13–31 GB** |
| Inbound bandwidth at ~128 kbit/s/source | ~36 Mbit/s | ~67 Mbit/s |
| Outbound to Discord (per *guild*, see §M6) | ~1.9 Gbit/s at 15k playing guilds | ~1.9 Gbit/s |

**The CPU and RAM columns are estimates, not measurements.** They come from typical figures for a
real-time audio-only transcode (demux + decode + resample + libopus encode) and will shift by a
factor of two or more with host CPU, source codec, and Windows-versus-Linux process overhead.
Measuring one real ffmpeg child on the production host would replace this whole table with facts; it
is the single highest-value measurement available (§5).

Two structural points are robust regardless of the constants:

- **The per-shard duplication is pure waste.** 15 shards pulling the same Qurango URL is 15
  identical HTTP streams and 15 identical encodes producing 15 identical byte streams. A single
  per-host transcoder would cut the table above by the shard factor — a 15× reduction in ffmpeg
  processes, upstream connections and inbound bandwidth.
- **Upstream connection concentration is a third-party risk.** 23 of the 35 stations are `quran`
  group and several share hosts (`Qurango.net`, `radiojar.com`). 15 shards × 23 stations is ~345
  simultaneous connections to a small number of hosts from one IP address, which is the kind of
  pattern that attracts rate limiting or an IP block. Whether those operators tolerate it is
  unknown (§5).

---

## 3. Proposed improvements

Effort is rough developer-days. Risk is specifically *risk to the currently live bot*.

**I1 — One transcoder per host instead of per shard.** Move broadcasting out of the shard processes
into a single sidecar that pulls each station once, encodes once, and serves guild streams to shards
over a local socket or named pipe. Cuts ffmpeg processes, upstream connections and inbound bandwidth
by the shard factor, and makes §C2 structurally impossible because the broadcaster no longer lives
in hot-reloadable shard code. *Effort: 5–8 days.* *Risk: high* — a new IPC hop on the audio path,
new failure modes, and a migration that touches every guild. Worth doing only after the cheaper
items below, and behind a per-shard feature flag.

**I2 — Give broadcasts a real lifecycle: reference counting plus an idle sweep.** Have
`releaseGuildStream` check `listeners.size === 0` and schedule `cleanup(url)` after a grace period
(30–60 s, cancelled if a new listener arrives). Fixes §C3 and makes §W1's worst case unreachable.
*Effort: 0.5 day.* *Risk: low-medium* — the grace period must be long enough that a station switch
or restore burst does not tear down a broadcast that is about to be reused.

**I3 — Add a stall watchdog and end the listener streams when a broadcast dies.** Track
`lastDataAt` on each entry, updated in the `stdout` handler; a timer that sees no data for N seconds
(10–15 s is generous for radio) calls `onDrop`. And in `_destroyEntry`, after the retry chain has
finally given up, `end()` every listener so the players transition to `Idle` and their recovery
handlers fire. Fixes §C1 — the most serious defect here. *Effort: 1 day.* *Risk: low*, provided the
threshold is above the longest legitimate gap; too low a threshold would cause needless reconnects.

**I4 — Deduplicate in-flight `_start` calls.** Keep a `Map<url, Promise<entry>>` of pending starts
and have `getOrCreate` return the existing promise. Three or four lines; removes §C7 entirely.
*Effort: 0.25 day.* *Risk: very low.*

**I5 — Make the retry policy explicit.** One policy per URL: exponential backoff with jitter
(3 s → 60 s cap), a bounded attempt count before the broadcast is marked failed, and suppression of
per-guild retries while a URL is in failed state. Then have the per-guild `Idle` handler consult
that state instead of hammering independently. Fixes §C4 and most of §m5. *Effort: 1–1.5 days.*
*Risk: low-medium* — the "failed" state needs a way back, or a station that recovers stays dark.

**I6 — Honour `enabled` on restore, and check emptiness before restarting.** Two independent
one-line-ish fixes: add `data.enabled &&` to the restore guard (`ready.js:159`) and stop writing
`enabled = true` unconditionally (`:175`); add an `isVoiceChannelEmpty` check inside the `Idle`
handler (`joinAndPlayQuran.js:143-152`). Fixes §C5 and §C6. *Effort: 0.5 day.* *Risk: low on the
code, but **behaviourally visible** — guilds currently being force-started will go quiet after the
next restart, which is correct but will look like a regression to anyone who got used to it. Worth
announcing. Note also that §C6 has already overwritten the historical `enabled` values, so the
pre-bug intent is not recoverable from the DB.*

**I7 — Fix or remove the `/refresh` broadcaster guard.** Minimum: exclude
`src/utils/functions/joinAndPlayQuran.js` from `HOT_DIRS` purging so the singleton survives. Better:
move the broadcaster into its own module that is never hot-reloaded, hang the instance off `client`
instead of module scope, and delete the `STATEFUL_MODULES` check that cannot work
(`refrishCommands.js:11-21`). Fixes §C2. *Effort: 0.5 day.* *Risk: low* — but until it is fixed,
`/refresh` should be treated as unsafe whenever audio is playing.

**I8 — Page-aware lag handling.** Replace the mid-stream byte drop with either a page-boundary-aware
drop or "destroy the guild stream and rebuild it", which gets a clean header replay for free. Fixes
§M1. *Effort: 1–2 days* (needs light OGG page parsing, or reuse of a demuxer). *Risk: medium* —
touches the hot path for every chunk and every listener.

**I9 — Validate OGG page headers instead of scanning for four bytes.** Parse capture pattern,
version and segment table in `_findOggHeaderEnd`, and stop assuming exactly two header pages. Fixes
§M2. *Effort: 0.5 day.* *Risk: low.*

**I10 — Reduce the encode bitrate.** Try `-b:a 64k` (and consider `-ac 1`) on one shard and compare
by ear. Potentially halves the largest resource line in §W1/§M6. *Effort: 0.25 day plus listening
time.* *Risk: low technically, but it is a user-perceptible quality change — it needs a deliberate
decision, not a quiet commit.*

**I11 — Observability for the things that are currently invisible.** Extend `getStats()` to report
inactive and failed entries, listener counts per entry, `lastDataAt` age, and a process count; add
the ffmpeg child PIDs. Surface it on the existing dashboard next to `idleRadio`. This is what turns
every "unverified" note in this report into a measurement. *Effort: 1 day.* *Risk: very low.*

---

## 4. Quick wins

Ordered by value per unit of risk. All are small, local, and safe to ship independently.

1. **Dedup in-flight `_start`** (I4) — a `Map<url, Promise>` in `getOrCreate`. Removes §C7's
   orphaned processes. ~10 lines, no behaviour change when there is no race.
2. **Exclude `joinAndPlayQuran.js` from `/refresh`'s purge** (I7, minimum version) — one array
   entry. Stops §C2's ffmpeg doubling immediately. Alternatively, just stop using `/refresh` while
   audio is live until I7 lands.
3. **`end()` the listeners when a broadcast is finally abandoned** (second half of I3) — a few lines
   in `_destroyEntry` or a new `_abandon` path. This is what lets the existing per-guild recovery
   handlers do their job, so it buys most of §C1's fix without the watchdog.
4. **Add the emptiness check to the `Idle` handler** (half of I6) — one `if`. Directly cuts CPU and
   ~128 kbit/s per listener-less guild; the saving is already quantified by the dashboard's
   `idleRadio` counter.
5. **Reference-count down to `cleanup()`** (I2) — the single highest-leverage change against §W1.
   Slightly more care than the others because of the grace-period tuning.
6. **Route the audio failure paths through the pino logger and rate-limit them** (part of m5) —
   makes the next incident diagnosable from `logs/` and the webhook instead of lost console output.
7. **Add `max_memory_restart` to `ecosystem.config.js`** (m3) — a safety net under every leak in this
   report, and it costs one line.
8. **Expose the real counters** (I11, trimmed to inactive-entry count + `lastDataAt` age) — do this
   early, because it is how you verify items 1–5 actually worked.

A reasonable first PR is items 1–4 plus 7: all small, each independently revertible, and together
they address the worst of §C1, §C2, §C5 and §C7.

---

## 5. Open questions

Things the code cannot answer, roughly in order of how much they would change the analysis.

**Capacity and hosting**

1. **How many shards actually run in production?** `shard.js:17` says `"auto"`. The `index.js:24`
   comment says 8. Everything in §W1 scales linearly with this number.
2. **Host specs and OS** — cores, RAM, and Linux vs Windows. The vendored `ffmpeg.exe` plus
   `start.vbs`/`stop.vbs` suggest Windows; if production is Linux, the per-process overhead in §W1
   is meaningfully lower.
3. **Measured cost of one ffmpeg child** — `%CPU` and RSS for a single station on the production
   host. This replaces the two estimated columns in §W1 with facts and is the cheapest high-value
   measurement available.
4. **Current guild counts** — total guilds, guilds with a `_radioChannel` row, and how many of those
   have `enabled: true`. Given §C6 the third number may no longer be meaningful, but the first two
   bound everything.
5. **Observed outbound bandwidth**, to check the ~1.9 Gbit/s estimate in §M6 against reality.

**Upstream stations**

6. **What codec and bitrate do the sources actually serve?** If any already serve OGG/Opus at 48 kHz,
   those could bypass ffmpeg entirely. If they are all 128 kbit/s mp3, §I10's quality headroom is
   different than if some are 64 kbit/s.
7. **Do the station operators tolerate many parallel connections from one IP?** §W1 projects ~345
   simultaneous connections to a handful of hosts. Has any station ever blocked or throttled the
   bot?
8. **Is there a known-bad station?** A URL that stalls or dies regularly would confirm §C1 as an
   active incident rather than a latent risk.

**Operations and observed symptoms**

9. **Is `/refresh` used in production while audio is playing?** This decides whether §C2 is an
   active bug or a trap waiting to be stepped in.
10. **Have users reported stuck silence** — bot shown as connected and "playing" but no audio, fixed
    only by a restart? That is §C1's exact signature.
11. **Have users reported doubled or garbled audio?** That would corroborate §C7 or §M4's
    double-subscribe path.
12. **Do stray `ffmpeg` processes survive a `pm2 stop`?** (§m4) — a one-command check on the host.
13. **What does the dashboard's `idleRadio` figure currently read?** It is a direct measurement of
    §C5's waste and would quantify I6's payoff before any code is written.
14. **Is restoring every guild within ~10.5 minutes acceptable**, or is there an SLA that makes §M3
    worth restructuring?

---

## Related documents

- [`architecture.md`](./architecture.md) — processes and communication
- [`audio-pipeline.md`](./audio-pipeline.md) — how the pipeline is meant to work
- [`startup-restore.md`](./startup-restore.md) — restore timings, with the derivation behind §M3
