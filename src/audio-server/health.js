'use strict';

/**
 * Builds the §4.1 /health payload. Deliberately reads BroadcastHub's richer
 * `hub.getStats()` (which carries `startedAt`) rather than
 * `AudioSource.getStats()`, whose shape is frozen by §5 for liveSocket.js /
 * status_bot.js backwards compatibility and does not include it.
 */
function buildHealthPayload(audioSource, allowlist, startedAt) {
  const hubStats = audioSource.hub.getStats();
  const byUrl = new Map(hubStats.broadcasts.map((b) => [b.url, b]));

  const stations = [];
  let active = 0;
  let listeners = 0;
  let ffmpeg = 0;

  for (const entry of allowlist.entries) {
    const b = byUrl.get(entry.url);
    if (!b) continue; // never requested yet — nothing to report until first /stream

    stations.push({
      url: b.url,
      name: entry.name,
      state: b.state,
      listeners: b.listeners,
      lastDataAgeMs: b.lastDataAgeMs,
      ffmpegPid: b.ffmpegPid,
      attempts: b.attempts,
      startedAt: b.startedAt,
    });

    if (b.state === 'active') active++;
    listeners += b.listeners;
    if (b.ffmpegPid) ffmpeg++;
  }

  return {
    ok: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    stations,
    totals: { stations: stations.length, active, listeners, ffmpeg },
  };
}

module.exports = { buildHealthPayload };
