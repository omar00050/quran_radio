# Test-bot checklist

Manual acceptance tests for the audio refactor, to run on the **test bot** in both modes.

> **Never use the production token and never restart production pm2.** Use the test bot's own
> `.env` (its own `token`), and `testMode=1`. Everything below assumes a test guild you can join a
> voice channel in.
>
> The automated harnesses (`node tests/audio-server.test.js`, `node tests/broadcast-hub.test.js`)
> already cover fan-out, header replay, ffmpeg counting, reconnects and shutdown. This checklist
> covers what only a real Discord client can show: that people actually hear audio.

---

## 0. Before you start

```bash
git rev-parse --abbrev-ref HEAD        # expect feat/audio-server
node tests/broadcast-hub.test.js       # expect 16/16, no network needed
node tests/audio-server.test.js        # expect 17/17 (skips are fine if a station is down)
```

Know how to count ffmpeg processes — you will do it repeatedly:

```bash
bash scripts/count-ffmpeg.sh                        # Linux/macOS
powershell -File scripts/count-ffmpeg.ps1           # Windows
```

And how to read the audio server's state (token comes from your `.env`; don't paste it anywhere):

```bash
curl -s -H "Authorization: Bearer $AUDIO_SERVER_TOKEN" 127.0.0.1:3040/health | jq
```

---

## Part A — embedded mode (the default, must not regress)

Set **no** `AUDIO_*` variables at all. This is the plain self-hosted path.

| # | Step | Expected |
|---|---|---|
| A1 | `npm start` | Boots. Log line: `Audio mode: embedded — AUDIO_MODE=embedded` |
| A2 | `/setup radio` in the test guild, pick a channel, press ON | Bot joins the voice channel |
| A3 | Join that voice channel yourself | **You hear Quran audio within a few seconds** |
| A4 | Count ffmpeg | Exactly **1** (one station in use) |
| A5 | Switch station from the menu | Audio changes with **no long silence**; still **1** ffmpeg (old one reclaimed after the idle period) |
| A6 | Press Next, then Previous, then Random, quickly | Audio follows each press; ffmpeg count stays small (1–2 during overlap); no error replies |
| A7 | `/status` (or the status button) | Shows `Audio Mode: embedded`, a listener count, and audio-server reachability as N/A |
| A8 | Leave the voice channel (bot alone) | Audio stops shortly after… **but see the note below** |
| A9 | Rejoin the channel | Audio resumes |
| A10 | Press OFF | Bot leaves the channel; ffmpeg drops to **0** within ~10 min (`AUDIO_STATION_IDLE_MS`), or immediately if you also stop the bot |
| A11 | Restart the bot (`Ctrl+C`, `npm start`) | After the 2-minute restore delay the bot rejoins and audio returns |

> **A8 caveat — known, deliberately out of scope.** The Idle handler still restarts playback ~5s
> after the channel empties (`AUDIO_REPORT.md` §C5), so audio will come back even with nobody
> listening. Expect the *pause then resume*, and do not treat it as a regression from this work.
> Same for §C6: a restart re-enables radio in guilds that had pressed OFF.

---

## Part B — remote mode, one shard

```bash
# .env on the test bot
AUDIO_MODE=remote
AUDIO_SERVER_TOKEN=<a real secret, same value for both processes>
```

Start the audio server **first**, in its own terminal:

```bash
node audio-server.js
```

| # | Step | Expected |
|---|---|---|
| B1 | Audio server boot log | `listening on 127.0.0.1:3040`. **No** "token is unset or still change_me" warning. If you see that warning, the token didn't load — check you're using the repo-root `.env` |
| B2 | `npm start` | Log line: `Audio mode: remote — AUDIO_MODE=remote (all shards)` |
| B3 | Press ON, join the channel | **You hear audio** |
| B4 | Count ffmpeg **in the bot process** | **0** — the bot must spawn none in remote mode |
| B5 | Count ffmpeg overall | **1** (the audio server's) |
| B6 | `curl /health` | One station, `state: "active"`, `listeners: 1`, small `lastDataAgeMs`, a real `ffmpegPid` |
| B7 | `/status` | `Audio Mode: remote`, audio server shown as reachable |
| B8 | Switch station | Audio changes; `/health` shows the new station; the old one disappears after its idle period |
| B9 | Second guild (or second voice channel) on the **same** station | `/health` shows `listeners: 2` and **still one** `ffmpegPid` — this is the whole point of the refactor |

---

## Part C — kill the audio server while guilds are playing

**This is the important one.** Audio is playing in at least one guild, with you listening.

| # | Step | Expected |
|---|---|---|
| C1 | Kill the audio server (`Ctrl+C`, or `pm2 stop quran-audio`) | Audio stops. **The bot must stay in the voice channel** — it must not leave, and the control panel must not flip to OFF |
| C2 | Bot logs | Upstream end, then `broadcast:reconnect` with a growing delay. **No** per-guild retry spam — one retry line per station, not per guild |
| C3 | Wait ~30s with it still down | Bot still in the channel, still silent, still retrying. Backoff grows 3s → 60s with jitter |
| C4 | Start the audio server again | **Audio resumes on its own, no interaction.** Expect it within one backoff interval — worst case ~60s after the server is back, typically much sooner |
| C5 | `/health` on the new server | The station is active again with your guild as a listener |
| C6 | Count ffmpeg | 1 on the audio server, still **0** in the bot |

### C7 — the long outage (the case that was broken)

| # | Step | Expected |
|---|---|---|
| C7a | Kill the audio server and leave it down **>10 minutes** (longer than `AUDIO_STATION_IDLE_MS`) | Bot stays in the channel the whole time, retrying once a minute per station |
| C7b | Start it again | **Audio still resumes on its own.** Before the `wanted`-registry fix the idle sweep deleted the station and cancelled the retries, so it would have stayed silent forever |

If C7b fails — silence after the server returns — that is a real regression, not expected
behaviour. Capture the bot log around the restart.

### C8 — restart the bot while the audio server is down

| # | Step | Expected |
|---|---|---|
| C8a | Audio server down, restart the bot | Boots fine; after the 2-minute restore delay it rejoins voice channels **without audio** and keeps retrying. It must not crash or leave |
| C8b | Start the audio server | Audio appears on its own for every restored guild |

---

## Part D — partial rollout (`AUDIO_REMOTE_SHARDS`)

Only meaningful with the sharding manager (`node shard.js`), not `npm start`.

```bash
AUDIO_MODE=remote
AUDIO_REMOTE_SHARDS=0
```

| # | Step | Expected |
|---|---|---|
| D1 | `node shard.js` | Shard 0 logs `Audio mode: remote — shard 0 is in AUDIO_REMOTE_SHARDS=0`; every other shard logs `embedded — shard N not in AUDIO_REMOTE_SHARDS=0` |
| D2 | A guild on shard 0 | Audio works; its ffmpeg is on the audio server |
| D3 | A guild on another shard | Audio works; that shard has its **own** ffmpeg |
| D4 | Clear `AUDIO_REMOTE_SHARDS`, restart | All shards remote; **0** ffmpeg in every shard process |

---

## Part E — hot reload and shutdown hygiene

| # | Step | Expected |
|---|---|---|
| E1 | With audio playing, run `/refresh` | Replies DONE. **Audio keeps playing uninterrupted**, and the ffmpeg count does **not** increase. (Before this work, each `/refresh` built a second broadcaster and orphaned the first's ffmpeg children — `AUDIO_REPORT.md` §C2) |
| E2 | After `/refresh`, switch station | Still works — the reloaded handlers use the same `client.audio` |
| E3 | Stop the audio server with SIGTERM | Exits cleanly; ffmpeg count goes to **0**. No orphans left behind |
| E4 | Stop the bot in embedded mode | ffmpeg count goes to **0** |

> On Windows, `Ctrl+C` in the terminal delivers a real SIGINT, but `taskkill /F` and pm2's forced
> stop do not run the signal handlers — ffmpeg children then rely on stdin EOF to exit. If E3 leaves
> orphans on Windows, check again after a graceful `pm2 stop quran-audio` before filing it.

---

## What to report back

For anything that fails, capture:

1. which step number,
2. the bot log lines around it (and the audio server's, in remote mode),
3. `curl /health` output at that moment,
4. the ffmpeg count,
5. whether the bot was still in the voice channel.

Never paste `AUDIO_SERVER_TOKEN`, the bot token, or the contents of `.env` into a report.

---

## Related

- [`audio-server-progress.md`](./audio-server-progress.md) — what changed and the rollout plan
- [`audio-source-contract.md`](./audio-source-contract.md) — the interface both modes implement
- [`AUDIO_REPORT.md`](./AUDIO_REPORT.md) — §C5, §C6 and §M1 remain open by design
