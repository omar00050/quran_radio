'use strict';

/**
 * `Authorization: Bearer <AUDIO_SERVER_TOKEN>` required on EVERY request,
 * /health included (contract §4). If the token is unset, the server still
 * requires the literal fallback 'change_me' — it never runs open — but boots
 * with a loud warning (see server.js) telling the operator to set a real one.
 */
function checkAuth(req, token) {
  const expected = token || 'change_me';
  const header = (req.headers && req.headers['authorization']) || '';
  return header === `Bearer ${expected}`;
}

module.exports = { checkAuth };
