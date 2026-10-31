# Audio server — progress log

Resumable state for `feat/audio-server`. Updated by the lead after every completed task.
If a session stops mid-way (usage limits), this file plus
[`audio-source-contract.md`](./audio-source-contract.md) is enough to pick up.

**Branch:** `feat/audio-server` (from `main`, `80df1e8`)
**Last updated:** follow-ups 1-6 complete

---

## Status

| Phase | State |
|---|---|
| 1 — contract | ✅ done — commit `ab2acba` (docs only) |
| 2 — build (A: audio engine + server, B: bot integration, Haiku: config) | ✅ done |
| 3 — verification + tests | ✅ done — 17/17 server harness + 13/13 hub unit |
| follow-ups 1-5 | ✅ done (see below) |
| follow-up 6 — test-bot checklist | ✅ done — `docs/test-bot-checklist.md` |

---

## Done

- **Branch check.** `fix/audio-lifecycle-batch1` does **not** exist (locally or on `origin`).
  → Teammate A must therefore carry the batch-1 fixes itself: I4 in-flight dedup, I2 refcount +
  idle sweep, ending listeners on abandon.
- **Branch created:** `feat/audio-server` off `main`.
- **`docs/audio-source-contract.md`** written and committed — `AudioSource` surface, the
  `UpstreamProvider` A/B seam, audio-server HTTP API, `getStats()` shape, env table, file ownership.

## Phase 3 — lead review findings (all fixed)

Four real bugs, three of which broke the common path:

1. **First guild on every station got no audio.** `createGuildStream` returned `null` unless
   `oggHeader` was already captured, but `getOrCreate` resolves as soon as the upstream opens —
   before any OGG pages arrive. Fixed: join the listener set pre-header and let `_onData`'s
   capture branch replay the buffered prefix (which is what the old code did).
2. **refCount leaked, so the idle sweep never fired.** A stream destroyed directly rather than via
   `releaseGuildStream` (e.g. `onRadio_off_radio.js:51`) left `listeners` smaller but `refCount`
   unchanged. Fixed with a single `_detachStream` used by both the release call and the stream's
   own `close`/`error`, idempotent via a flag on the stream.
3. **A station down at join time could never recover.** `_start`'s catch deleted the entry when
   `refCount === 0` — always true on a first open — leaving no retry timer and no event to resume
   from, while the guild held its voice connection. Fixed: keep the entry, start the retry policy,
   and let the idle timer be the bounded give-up. `broadcast:recovered` now also fires when coming
   back from `stalled` (not just `failed`), and `joinAndPlayQuran` additionally listens for
   `broadcast:start` for the never-came-up-yet case.
4. **`audio-server.js` never set `FFMPEG_PATH`**, so `EmbeddedProvider` fell back to bare `ffmpeg`
   on PATH — exactly what depending on `ffmpeg-static` is supposed to avoid. Fixed, with an
   explicit env override still winning.

Also: `_watchForRecovery` bailed on `!client.Radio.get(guildId)`, which is the state during a fresh
join (both callers `set` only after the promise resolves) — so restore-against-a-dead-station
attached no watcher. Fixed with a `localConn` fallback.

Removed the dead `STATEFUL_MODULES` guard from `/refresh` (it could never work — it read
`.broadcasts` off the exported class; §C2) and documented why no exclusion list is needed now that
the source lives on `client.audio`.

## Follow-ups

### 1. `AUDIO_REMOTE_SHARDS` — per-shard rollout

`src/audio/resolveMode.js` resolves the effective mode as a pure function of env, so remote mode can
be enabled one shard at a time. Shard ids come from **`SHARDS`** — what discord.js's ShardingManager
actually injects (`Shard.js`: `SHARDS: this.id`), not `DISCORD_SHARD_ID` as the comment in
`baseClient.js:37` claims. An unsharded run ignores the list rather than silently matching shard 0.
The resolved mode and the reason are logged at startup. See the rollout plan below.

### 2. Contract re-synced

`docs/audio-source-contract.md` had drifted from the Phase 3 fixes: `createGuildStream` no longer
returns `null` before the header is captured, and `broadcast:recovered` fires after `stalled` as
well as `failed`. Also documented the failed-first-open retry rule, the single idempotent detach,
`getState`/`setAudioServerStatus`, and `AUDIO_REMOTE_SHARDS`.

### 3. Chained OGG after a reconnect — was a silent-death bug

**prism-media's `OggDemuxer` cannot decode a chained OGG stream.** It records the first serial
number it sees and never updates it (`node_modules/prism-media/src/opus/OggDemuxer.js:93-99`), then
silently discards every packet whose serial differs. ffmpeg assigns a new serial per output, so
**every upstream reconnect** fed connected listeners a stream they could never decode — no error, no
`end`, player stuck in `Playing` with permanent silence. AUDIO_REPORT.md §C1, reintroduced by any
reconnect.

Answers to the three questions asked:

- *Does the hub detect new BOS pages and replace the cached header?* It replaces it, but by
  re-capturing at the start of each new upstream, not by detecting BOS mid-stream. `_onOpened` now
  also **clears** the stale `oggHeader`, which it previously kept deliberately.
- *What do existing listeners receive, and can the demuxer cope?* They received chained OGG, and
  **no** — see above. So they are now **ended** on drop (`_endListeners`), giving the player a clean
  end-of-stream so it goes Idle, rejoins, and gets the new header. Costs a ~1s gap.
- *Both layers in remote mode?* Covered by propagation rather than extra machinery: on the audio
  server the hub's listeners **are** the client HTTP responses, so ending them closes those
  connections; the bot's hub then sees an ordinary upstream end and reconnects through the same
  path. A new logical stream therefore cannot appear mid-stream on an already-open connection. Both
  layers are asserted — layer 1 in the server harness, layer 2 in the hub unit test.

### 4. `.env` loading — was a real misconfiguration

`audio-server.js` called `dotenv.config()` with no path (resolves against `process.cwd()`) and
`ecosystem.config.js` set no `cwd`. Verified from a foreign cwd: **`injecting env (0) from .env`** —
the server came up with `AUDIO_SERVER_TOKEN` unset and `AUDIO_BITRATE` at its default while the bot
used the real values, so every bot request would have 401'd. Fixed with an explicit `__dirname`-based
path plus `cwd: __dirname` on both pm2 apps. Re-verified: 15 variables, no token warning.

### 5. Secret hygiene — confirmed

- `.env` is ignored (`.gitignore:4`), untracked, and appears in **0 commits on any branch**.
- Only `.env.example` is tracked, carrying the `change_me` placeholder.
- `AUDIO_SERVER_TOKEN` is only read from env, passed as an option, compared in `auth.js`, and
  interpolated into an `Authorization` header. **No code path logs or prints it**; the boot warning
  names the variable only. Tests use their own literal token.

### 6. Test-bot checklist

`docs/test-bot-checklist.md` — manual acceptance tests in both modes: embedded regression (A),
remote single-shard (B), **killing `quran-audio` while guilds are playing** (C, including the
>10-minute outage case), partial rollout with `AUDIO_REMOTE_SHARDS` (D), and `/refresh` plus
shutdown hygiene (E). Expectations are derived from the actual timer values, and the known-open
§C5/§C6 behaviours are called out so they aren't mistaken for regressions.

Writing part C surfaced a real bug, now fixed: **an outage longer than `idleMs` stranded waiting
guilds permanently.** A drop ends every listener, so refCount is 0, so the idle sweep deleted the
station entry and cancelled its retry timers — while the guilds sat subscribed to
`broadcast:recovered`, which could then never fire. Fixed with a `wanted` registry on the hub
(`markWanted`/`unmarkWanted`): a station someone is waiting for is exempt from the idle sweep and
keeps retrying at the bounded `failedRetryMs` cadence, once per station rather than per guild. A
station nobody wants is still swept, so §C4 is not reintroduced. Both behaviours are asserted in
`tests/broadcast-hub.test.js`.

## Known-dead code left in place

`src/utils/functions/AudioBroadcaster.js` has no live `require` anywhere and is superseded by
`src/audio/`. It was NOT deleted: it carries uncommitted staged changes that exist nowhere else, so
removing it would destroy work. Delete it once those changes are committed or discarded.

## Completed teammate work

- **Teammate A (Sonnet)** — `src/audio/**` (engine, hub, OGG parser, EmbeddedProvider),
  `audio-server.js`, `src/audio-server/**`. Carries batch-1 (I4, I2, abandon-ends-listeners) plus
  I3 watchdog, I5 retry policy, I9 page validation, M5 and m2/m4.
- **Teammate B (Sonnet)** — `src/audio/remote/RemoteProvider.js`,
  `src/utils/functions/joinAndPlayQuran.js`, `src/base/baseClient.js` (AUDIO_MODE switch),
  `src/server/liveSocket.js`, `src/ComponentsAction/info/status_bot.js`.
- **Haiku subagent** — `.env.example`, `ecosystem.config.js` (two pm2 apps),
  `scripts/count-ffmpeg.{sh,ps1}`.

Both teammates were told to leave `src/utils/functions/AudioBroadcaster.js` untouched so the tree
never broke mid-build. See "Known-dead code left in place" above for why it still exists.

## Next

- Delete `AudioBroadcaster.js` after the staged changes to it are resolved.
- Optional follow-ups deliberately NOT done (still open in `AUDIO_REPORT.md`): §C5 Idle-handler
  emptiness check, §C6 `enabled` ignored on restore, §M1 64 KB mid-page splice, §I10 bitrate.

## Rollout plan: embedded -> remote

Partial rollout is driven by `AUDIO_REMOTE_SHARDS` (comma-separated shard ids; empty = all shards).
Shard ids come from `SHARDS`, which is what discord.js's ShardingManager injects per child process.

1. **Deploy with `AUDIO_MODE` unset.** Everything stays embedded and behaviourally identical, so the
   engine rewrite gets exercised in production before the topology changes. Record the baseline
   ffmpeg count (`scripts/count-ffmpeg.sh` / `.ps1`) on a shard host.
2. **Bring up the audio server alone**: `pm2 start ecosystem.config.js --only quran-audio`. Check
   `GET /health` — stations appear only once something requests them, so an empty `stations` array
   here is correct. Nothing consumes it yet.
3. **One shard.** Set `AUDIO_MODE=remote` and `AUDIO_REMOTE_SHARDS=0`, restart the bot. Only shard 0
   goes remote; every other shard logs `Audio mode: embedded — shard N not in AUDIO_REMOTE_SHARDS=0`
   and keeps its own ffmpeg. Verify: shard 0's guilds still have audio, `/health` shows listeners,
   and the station count on the audio server matches what shard 0 was playing.
4. **Widen gradually**: `AUDIO_REMOTE_SHARDS=0,1,2`, restart, re-check. The embedded shards are the
   control group — if remote shards misbehave, narrow the list and restart.
5. **All shards**: clear `AUDIO_REMOTE_SHARDS` (keep `AUDIO_MODE=remote`). Now expect ~35 ffmpeg on
   the audio-server host and **0** in every shard process.
6. **Keep `AUDIO_STATION_IDLE_MS` long** (default 600000) so a bot restart or shard respawn doesn't
   respawn ffmpeg — stations stay warm across it.

Rollback at any step is one env var plus a restart, which is why step 1 matters: the embedded path
stays fully functional the whole way. A shard started while the audio server is down holds its
voice connections and resumes on `broadcast:start`/`broadcast:recovered` rather than failing, so
ordering between steps 2 and 3 is forgiving.

## Open problems / decisions taken

- **Batch-1 fixes are not on a branch** — they live inside teammate A's work. If a separate
  `fix/audio-lifecycle-batch1` ever appears, expect conflicts in `src/audio/`.
- **Allowlist instead of open proxy.** `/stream?url=` only serves URLs from `RadioChannels.js` +
  `process.env.RadioAudioUrl`. Decision taken in the contract §4 to avoid shipping an open
  redirector on the audio port.
- **`connectionCounts` kept in `getStats()`** purely for backwards compatibility with
  `status_bot.js:46` and `ready.js:23`.
- **`AUDIO_STATION_IDLE_MS`** added beyond the originally listed env vars — required to make
  "stop a station only after a long configurable idle period" configurable.
- **Not fixed here, by instruction:** §C5 (Idle-handler emptiness check), §C6 (`enabled` ignored on
  restore), §M1 (64 KB mid-page splice). All three remain live bugs; see `AUDIO_REPORT.md`.

## Verification (Phase 3) — `node tests/audio-server.test.js`

Run against a real station, no bot and no token involved. 12/12 pass:

- [x] late joiner (+6s) gets a valid OGG/Opus stream, header replayed
- [x] 6 concurrent consumers for one station → exactly **one** ffmpeg (`health.totals.ffmpeg == 1`)
- [x] late joiner reuses that same pid — no second spawn
- [x] idle sweep stops the station after the last listener leaves, ffmpeg pid dies
- [x] zero ffmpeg children survive `SIGTERM`
- [x] unauthenticated request → 401, non-allowlisted url → 403
- [x] `createAudioSource({mode:'embedded'})` with no env vars → embedded provider, 128k,
      `audioServer.reachable === null`
- [x] remote mode never pulls `ffmpeg-static` into `require.cache`

Not covered by the harness (needs a live bot): audio server down → voice connections held and
playback resumes. Reviewed by reading, not executed.
