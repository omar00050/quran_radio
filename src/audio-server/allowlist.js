'use strict';

/**
 * "Allowlist, not a proxy" (contract §4). Built at boot from the station
 * list (`src/utils/helpers/RadioChannels.js`) plus `process.env.RadioAudioUrl`.
 * Anything else is 403 on /stream — without this the server is an open
 * redirector for whoever reaches the port.
 */
function buildAllowlist(radioChannels, extraUrl) {
  const set = new Set();
  const entries = [];

  for (const ch of radioChannels || []) {
    if (ch && ch.value && !set.has(ch.value)) {
      set.add(ch.value);
      entries.push({ url: ch.value, name: ch.name || ch.value });
    }
  }

  if (extraUrl && !set.has(extraUrl)) {
    set.add(extraUrl);
    entries.push({ url: extraUrl, name: 'default' });
  }

  return { set, entries };
}

function isAllowed(allowlist, url) {
  return !!url && allowlist.set.has(url);
}

function nameFor(allowlist, url) {
  const found = allowlist.entries.find((e) => e.url === url);
  return found ? found.name : url;
}

module.exports = { buildAllowlist, isAllowed, nameFor };
