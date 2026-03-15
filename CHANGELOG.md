# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased] — 2026-03-15

### Added

#### Prayer System — complete overhaul
- **Aladhan API integration** (`sendPrayer.js`, `drawPray.js`, `SelectControlPrayer.js`)
  - Replaced the `muwaqqit` library with the [Aladhan API](https://api.aladhan.com) for prayer time calculation.
  - Monthly prayer calendar is fetched and cached per location (see persistent cache entry below), eliminating redundant HTTP calls.
  - API calls now use **latitude/longitude coordinates** (`/v1/calendar/{year}/{month}?latitude=&longitude=`) instead of city name geocoding for higher accuracy.

- **Exact scheduling** (`sendPrayer.js`)
  - Replaced the previous 60-second polling loop with a single precise `setTimeout` targeting the exact millisecond of each prayer.
  - After each prayer fires, the next one is scheduled automatically.
  - If all five prayers for the day have passed, Fajr of the following day is scheduled; month rollover is handled transparently via cache.

- **Anti-spam guard** (`sendPrayer.js`)
  - Each prayer is tracked with a `guildId_date_prayerName` key in `client.prayerLastSent`.
  - If a prayer was already sent (e.g. due to a race condition or restart), the duplicate is skipped silently.
  - Old keys from previous days are purged automatically to keep memory bounded.

- **Startup restoration** (`ready.js`)
  - Prayer channels are now restored on bot startup alongside radio and azkar channels.
  - Removed the early `return` that silently skipped azkar and prayer initialization when no radio channels existed.

- **Country + city two-step selection** (`ControlPrayer.js`, `SelectControlPrayer.js`, `prayer.json`)
  - Replaced the single flat country dropdown with a **country → city** two-step flow.
  - Selecting a country clears the previously selected city and enables the city dropdown for that country.
  - Selecting a city saves `city`, `city_ar`, `timezone`, `latitude`, and `longitude` to the database.

- **City list pagination** (`ControlPrayer.js`, `SelectControlPrayer.js`)
  - Countries with more than 25 cities (Discord's select menu limit) show a **"⬅️ المزيد (N+)"** button in the buttons row.
  - Pressing it replaces the city dropdown with cities 26–50 and shows a **"➡️ رجوع للقائمة"** button to return.
  - Countries with ≤ 25 cities are unaffected.

- **Human-readable time remaining** (`sendPrayer.js`)
  - The test adhan message now displays the remaining time as natural Arabic text:
    - `بعد 1 ساعة و 23 دقيقة` (hours + minutes)
    - `بعد 45 دقيقة` (minutes only)
    - `بعد 30 ثانية` (seconds only)

- **`prayer.json` restructured**
  - Changed from a flat array of 19 entries to a nested object keyed by country name.
  - Each country now contains `flag`, `method`, `format`, and a `cities[]` array.
  - Each city entry contains `city`, `city_ar`, `timezone`, `latitude`, and `longitude`.
  - Added **Yemen** as a new country.
  - Expanded city lists for all countries (5–27 cities per country).

- **`drawPray.js` updated**
  - Removed `muwaqqit` dependency; now accepts a pre-fetched `timings` object from the Aladhan API.
  - Strips timezone suffixes (e.g. `(EET)`, `(+03)`) from API time strings before rendering.
  - Updated background image URL.

- **Two-layer persistent prayer cache** (`sendPrayer.js`, `SelectControlPrayer.js`, `ready.js`)
  - Introduced a two-layer caching system to eliminate redundant Aladhan API calls on bot startup and restarts:
    - **L1 — in-memory** (`client.prayerCache`): instant lookup, cleared on restart.
    - **L2 — database** (`prayerCache` table): persistent across restarts, shared between sessions.
  - Cache key is `{latitude}_{longitude}_{method}_{year}_{month}` — **location-based, not guild-based**. All guilds using the same city share a single cache entry, so 100 guilds in Cairo produce one API call total.
  - **5-day TTL**: cached entries older than 5 days are considered stale and transparently refreshed from the API, ensuring ongoing accuracy.
  - **Startup cleanup** (`cleanOldPrayerCache`): runs once on `ready`, deletes DB entries for months prior to the current one to prevent unbounded database growth.
  - `getCalendar` exported from `sendPrayer.js` and reused in `SelectControlPrayer.js`, eliminating duplicated fetch logic.

### Fixed

- **`prayer.json` missing file** — copied `locations.json` to `prayer.json` to resolve a startup crash (`MODULE_NOT_FOUND`).
- **`node-fetch` ESM incompatibility** (`AudioBroadcaster.js`) — `node-fetch` v3 is ESM-only and cannot be `require()`'d in CommonJS; replaced with `axios` using `responseType: 'stream'`.
- **FFmpeg not found on Windows** (`index.js`) — `ffmpeg-static@5.2.0` binary is now registered via `process.env.FFMPEG_PATH` at startup so `prism-media` can locate it.
- **`dotenv` duplicate calls** (`index.js`) — removed duplicate `require('dotenv').config()` and `require('module-alias/register')` lines.
- **Prayer startup skipped when no radio channels** (`ready.js`) — removed `if (RadioChannels.length === 0) return` which silently prevented azkar and prayer from initializing.
- **`img` test button** (`SelectControlPrayer.js`) — was calling `drawPray` with the old `muwaqqit` signature; updated to fetch timings from Aladhan API and pass them in the new format.
- **`OnOff` button** (`SelectControlPrayer.js`) — now validates that both country and city are configured before allowing the prayer system to be enabled.

### Changed

- `ControlPrayer.js` — embed fields restructured; city and country shown as separate inline fields; roles field always visible; button labels shortened to fit alongside the optional page-toggle button.
- `SelectControlPrayer.js` — `list` handler now saves only `country`, `method`, `format` and explicitly clears `city`, `city_ar`, `timezone`, `latitude`, `longitude` when the country changes.
