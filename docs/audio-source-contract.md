# Audio source contract

Binding interface for the audio refactor (`feat/audio-server`). Both modes implement it; the audio
logic is written **once**. If this file and the code disagree, this file wins — ask the lead to
change it first.

Goal: one ffmpeg per station **per host** instead of per shard. 16 shards × 35 stations = up to 560
→ target 35.

---

## 1. Layering

```
AudioSource  (what joinAndPlayQuran talks to — identical in both modes)
   └── BroadcastHub       shared: listeners, OGG header replay, refcount,
                          idle sweep, stall watchdog, retry/backoff, events
         └── UpstreamProvider   the ONLY thing that differs between modes
               ├── EmbeddedProvider  axios → ffmpeg → OGG/Opus      (A)
               └── RemoteProvider    axios → audio server → OGG/Opus (B)
```

`audio-server.js` is itself a consumer of `BroadcastHub` + `EmbeddedProvider`. So ffmpeg,
header capture and retry exist in exactly one place and are exercised by all three paths
(bot-embedded, bot-remote, audio-server).

---

## 2. `AudioSource` — the public surface

Created by the factory, attached to the client as `client.audio`. **Never module scope** (that is
what made `/refresh` orphan ffmpeg children — see `AUDIO_REPORT.md` §C2).

```js
// src/audio/index.js  — owner: A
/**
 * @param {object} opts
 * @param {'embedded'|'remote'} opts.mode
 * @param {string}  [opts.serverUrl]     AUDIO_SERVER_URL      (remote only)
 * @param {string}  [opts.token]         AUDIO_SERVER_TOKEN    (remote only)
 * @param {string}  [opts.bitrate]       AUDIO_BITRATE, default '128k' (embedded only)
 * @param {number}  [opts.idleMs]        stop a station after this long with 0 listeners
 * @param {object}  [opts.logger]        pino logger; falls back to console
 * @returns {AudioSource}
 */
function createAudioSource(opts) {}
module.exports = { createAudioSource };
```

`mode: 'remote'` lazily `require('./remote/RemoteProvider')` — A must not import it eagerly, so the
two teammates never block on each other.

### Methods

| Method | Returns | Contract |
|---|---|---|
| `async getOrCreate(url)` | `Promise<Broadcast>` | Idempotent. **Concurrent calls for the same url share one in-flight promise** (§C7/I4). Rejects if the upstream cannot be opened; never retries inside this call — retry is the hub's background job. |
| `createGuildStream(url)` | `Readable \| null` | A new `PassThrough` that joins the listener set and increments the refcount. If a header is already cached it is written **first**; if it is not, the stream still joins and the header-capture branch replays the whole buffered prefix to it. Returns `null` only when there is no entry, or its state is `failed`/`stopped` — **not** merely because the header hasn't arrived yet, since `getOrCreate` resolves when the upstream opens and that is always before the first OGG pages. |
| `releaseGuildStream(url, stream)` | `void` | Removes + destroys the listener, decrements refcount. On reaching 0, schedules cleanup after `idleMs` (cancelled if a listener returns) (§C3/I2). Safe to call twice, and safe with a url whose entry was replaced (§M5). A stream that is destroyed **directly** by a caller decrements the refcount too, via its own `close`/`error` — both routes go through one idempotent detach, so the refcount can't drift above the real listener count and strand the idle sweep. |
| `cleanup(url)` | `void` | Immediate teardown: end+destroy listeners, kill upstream, drop the map entry. |
| `getStats()` | `StatsPayload` | §5. Must include entries that are **failed or inactive** — the old one hid them (§m2). |
| `async destroy()` | `Promise<void>` | Cleanup every station. Must leave **zero** ffmpeg children. |
| `getState(url)` | `string\|null` | `'starting'\|'active'\|'stalled'\|'failed'\|'stopped'`, or `null` if unknown. Lets the audio server answer `503` for a failed station without calling `getOrCreate`. |
| `setAudioServerStatus(partial)` | `void` | Merges into the `audioServer` block of `getStats()`. Remote-mode wiring only. |
| `get mode()` | `'embedded'\|'remote'` | |

### Events (`AudioSource extends EventEmitter`)

Payload is always `{ url, ...detail }`. Emit-only; nothing may throw into the hub.

| Event | When |
|---|---|
| `broadcast:start` | upstream opened, header captured |
| `broadcast:stall` | watchdog fired (`lastDataAt` older than `stallMs`) |
| `broadcast:reconnect` | retry scheduled — `{ attempt, delayMs }` |
| `broadcast:failed` | attempts exhausted → `failed` state; listeners have been ended |
| `broadcast:recovered` | reopened after `stalled` **or** `failed` — i.e. any successful reconnect, not just one following full exhaustion. A consumer waiting on a station needs the same resume signal in both cases. |
| `broadcast:stop` | cleaned up (idle sweep or explicit) |

### States

`starting → active → (stalled → active) → failed → active`, and any → `stopped`.
A `failed` broadcast keeps retrying on a long periodic timer (`failedRetryMs`, default 60s) so a
station that comes back recovers without operator action (§C4/I5).

A **first** open that fails keeps its entry and starts the retry policy even though refcount is
still 0 — the guild that asked is waiting with its voice connection held, and dropping the entry
would leave no retry timer and no event to resume from. The idle timer is the bounded give-up: if
no listener attaches within `idleMs`, `cleanup()` ends the retries. For the same reason
`_reconnect` has no `refCount === 0 → cleanup` short-circuit.

A station that was never up emits `broadcast:start` (not `recovered`) when it first serves data, so
anything waiting on a cold station must listen for both.

### Error behaviour — non-negotiable

1. `getOrCreate` rejects; callers must not crash. `joinAndPlayQuran` keeps the voice connection.
2. **When a broadcast is abandoned, `end()` every listener.** This is the §C1 fix: an open-but-silent
   `PassThrough` means the player never goes `Idle`, so nothing ever recovers.
3. Retries belong to the **station**, never the guild. No per-guild reconnect loops (§C4).
4. Upstream failures never propagate as unhandled rejections.

---

## 3. `UpstreamProvider` — the A/B seam

The only interface either teammate needs from the other.

```js
/**
 * @typedef {object} UpstreamHandle
 * @property {import('stream').Readable} stream  raw OGG/Opus bytes
 * @property {() => void} destroy                tear down everything it owns
 * @property {number|null} pid                   ffmpeg pid (embedded) or null (remote)
 */

/**
 * @typedef {object} UpstreamProvider
 * @property {'embedded'|'remote'} kind
 * @property {(url: string) => Promise<UpstreamHandle>} open
 * @property {() => Promise<void>} [destroy]
 */
```

Rules for `open`:

- Resolve only once bytes are flowing or the response is committed; reject on connect/HTTP error.
- **Do not retry.** Reject and let the hub schedule.
- Never emit `'end'` on success-but-silent; the hub's watchdog handles that case.
- `destroy()` must be idempotent.

---

## 4. Audio server HTTP API

Binds **127.0.0.1** only (`AUDIO_SERVER_PORT`, default 3040). Every request requires
`Authorization: Bearer <AUDIO_SERVER_TOKEN>` → `401` otherwise. Log a loud warning at boot if the
token is missing or still `change_me`.

| Method | Path | Response |
|---|---|---|
| `GET` | `/stream?url=<urlencoded>` | `200 audio/ogg`, chunked, **header pages replayed first**. `403` if the url is not allowlisted, `503` if the station is `failed`. |
| `GET` | `/health` | `200 application/json`, §4.1 |
| `GET` | `/stations` | `200` — the allowlist, `[{ url, name }]` |

**Allowlist, not a proxy.** Only URLs from `src/utils/helpers/RadioChannels.js` plus
`process.env.RadioAudioUrl` are servable. Anything else is `403`. Without this the server is an open
redirector for whoever reaches the port.

Station lifecycle on the server: started on first `/stream` request, kept **warm** after the last
client disconnects for `AUDIO_STATION_IDLE_MS` (default 600000 = 10 min) so a bot restart or a shard
respawn does not re-spawn ffmpeg. `SIGINT`/`SIGTERM` → `destroy()` → zero ffmpeg children, exit 0.

### 4.1 `/health` payload

```json
{
  "ok": true,
  "uptimeSec": 1234,
  "stations": [{
    "url": "https://Qurango.net/radio/yasser_aldosari",
    "name": "إذاعة ياسر الدوسري",
    "state": "active",
    "listeners": 3,
    "lastDataAgeMs": 420,
    "ffmpegPid": 12345,
    "attempts": 0,
    "startedAt": 1730000000000
  }],
  "totals": { "stations": 4, "active": 3, "listeners": 7, "ffmpeg": 3 }
}
```

---

## 5. `getStats()` payload

Consumed by `liveSocket.js` and `status_bot.js`. Shape is fixed:

```json
{
  "mode": "embedded",
  "activeBroadcasts": 3,
  "totalListeners": 120,
  "broadcasts": [{ "url": "...", "state": "active", "listeners": 40,
                   "lastDataAgeMs": 300, "ffmpegPid": 12345, "attempts": 0 }],
  "audioServer": { "configured": false, "reachable": null, "url": null,
                   "consecutiveFailures": 0, "lastCheckAt": null },
  "connectionCounts": [{ "url": "...", "count": 40 }]
}
```

`connectionCounts` is **kept for backwards compatibility** — `status_bot.js:46` and `ready.js:23`
read the old shape. `audioServer.reachable` is `null` in embedded mode.

---

## 6. Environment

| Var | Default | Mode | Meaning |
|---|---|---|---|
| `AUDIO_MODE` | `embedded` | both | `embedded` \| `remote` |
| `AUDIO_REMOTE_SHARDS` | *(empty)* | remote | Comma-separated shard ids that go remote; empty = all. Ignored in embedded mode and on unsharded runs. Ids come from `SHARDS`. |
| `AUDIO_SERVER_URL` | `http://127.0.0.1:3040` | remote | where the bot pulls from |
| `AUDIO_SERVER_PORT` | `3040` | server | listen port, 127.0.0.1 only |
| `AUDIO_SERVER_TOKEN` | `change_me` | both | bearer token, required on every request |
| `AUDIO_BITRATE` | `128k` | embedded | ffmpeg `-b:a`; **do not change the default** |
| `AUDIO_STATION_IDLE_MS` | `600000` | server | keep a station warm this long after the last client |

**`npm start` with none of these set must behave exactly like today**: embedded mode, ffmpeg in
process, 128k. That is the default path for small self-hosted bots and it must not regress.

---

## 7. File ownership

Do not edit a file you do not own. If you need a change in someone else's file, tell the lead.

### Teammate A — audio engine + server

```
src/audio/index.js              factory (lazy-requires ./remote/RemoteProvider for remote mode)
src/audio/AudioSource.js        class: EventEmitter + the §2 surface
src/audio/BroadcastHub.js       shared fan-out, refcount, idle sweep, watchdog, retry
src/audio/OggPageParser.js      validated page parsing (I9)
src/audio/providers/EmbeddedProvider.js   axios + ffmpeg
audio-server.js                 standalone entry
src/audio-server/**             http server, auth, routes, health, allowlist
```

Carries the never-merged batch-1 fixes: **I4** in-flight dedup, **I2** refcount + idle sweep,
**ending listeners on abandon**. Report sections: §C1, §C3, §C4, §C7, §M2, §M5, §m2, §m4.

### Teammate B — bot integration

```
src/audio/remote/RemoteProvider.js   HTTP pull from the audio server
src/utils/functions/joinAndPlayQuran.js
src/base/baseClient.js               construct client.audio from env (AUDIO_MODE switch)
src/server/liveSocket.js             stats wiring
src/ComponentsAction/info/status_bot.js
```

In remote mode: **never spawn ffmpeg, never require `ffmpeg-static`.** Server unreachable → hold the
voice connections, retry per station with backoff, resume automatically. Report sections: §C2, §C4,
§M4, §m2.

Do **not** rename `client.Radio`, `client.Azkar`, `client.Adhan`, `client.radioUrlCache` —
`liveSocket.js:99-158` reads them through `broadcastEval` and a rename fails silently.

### Haiku subagent — mechanical

`.env.example`, `ecosystem.config.js` (two apps), `scripts/count-ffmpeg.*`.

---

## 8. Out of scope

`shard.js` and clustering · the Idle-handler emptiness check (§C5) · the `enabled` flag in
`ready.js` (§C6) · the 128k default · the 64 KB skip (§M1) · anything not audio.

Never run the bot with the production token. Never restart pm2. `testMode` and the test bot only.
