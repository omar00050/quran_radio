# Audio server — progress log

Resumable state for `feat/audio-server`. Updated by the lead after every completed task.
If a session stops mid-way (usage limits), this file plus
[`audio-source-contract.md`](./audio-source-contract.md) is enough to pick up.

**Branch:** `feat/audio-server` (from `main`, `80df1e8`)
**Last updated:** Phase 3 complete

---

## Status

| Phase | State |
|---|---|
| 1 — contract | ✅ done — commit `ab2acba` (docs only) |
| 2 — build (A: audio engine + server, B: bot integration, Haiku: config) | ✅ done |
| 3 — verification + tests | ✅ done — 12/12 harness checks pass |

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
