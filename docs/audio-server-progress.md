# Audio server — progress log

Resumable state for `feat/audio-server`. Updated by the lead after every completed task.
If a session stops mid-way (usage limits), this file plus
[`audio-source-contract.md`](./audio-source-contract.md) is enough to pick up.

**Branch:** `feat/audio-server` (from `main`, `80df1e8`)
**Last updated:** Phase 1 complete

---

## Status

| Phase | State |
|---|---|
| 1 — contract | ✅ done |
| 2 — build (A: audio engine + server, B: bot integration, Haiku: config) | ⏳ not started |
| 3 — verification + tests | ⬜ not started |

---

## Done

- **Branch check.** `fix/audio-lifecycle-batch1` does **not** exist (locally or on `origin`).
  → Teammate A must therefore carry the batch-1 fixes itself: I4 in-flight dedup, I2 refcount +
  idle sweep, ending listeners on abandon.
- **Branch created:** `feat/audio-server` off `main`.
- **`docs/audio-source-contract.md`** written and committed — `AudioSource` surface, the
  `UpstreamProvider` A/B seam, audio-server HTTP API, `getStats()` shape, env table, file ownership.

## In progress

- nothing yet

## Next

1. Spawn teammate A (Sonnet) — `src/audio/**`, `audio-server.js`, `src/audio-server/**`.
2. Spawn teammate B (Sonnet) — `src/audio/remote/`, `joinAndPlayQuran.js`, AUDIO_MODE switch, stats.
3. Spawn Haiku subagent — `.env.example`, `ecosystem.config.js`, `scripts/count-ffmpeg.*`.
4. Phase 3: review both diffs, add `tests/` harness, commit.

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

## Verification checklist (Phase 3)

- [ ] late joiner gets a valid OGG stream (header replayed)
- [ ] N concurrent requests for one station → exactly **one** ffmpeg
- [ ] zero ffmpeg children remain after `SIGTERM`
- [ ] `npm start` with no new env vars behaves exactly as before (embedded, 128k)
- [ ] remote mode spawns no ffmpeg in the bot process
- [ ] audio server down → voice connections held, playback resumes when it returns
