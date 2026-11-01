'use strict';

/**
 * Driver-agnostic database helpers.
 *
 * good.db's drivers are not uniform about async: the JSON and SQLite drivers
 * return values **synchronously**, while MongoDB, MySQL and PostgreSQL return
 * promises. `await` papers over the difference, but `.catch()` does not —
 * calling it on a plain return value is a `TypeError`.
 *
 * That makes `db.set(...).catch(() => {})` a latent crash that only appears on
 * the default JSON driver, and only on the error path where it was meant to be
 * defensive. These helpers are the safe form: they work on every driver.
 */

/**
 * Reads a key, returning null instead of throwing.
 * @param {{get: Function}} source a GoodDB instance or one of its tables
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function safeGet(source, key) {
  try {
    return await source.get(key);
  } catch (_) {
    return null;
  }
}

/**
 * Writes a key, swallowing failures.
 * @returns {Promise<boolean>} whether the write went through
 */
async function safeSet(source, key, value) {
  try {
    await source.set(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Deletes a key, swallowing failures.
 * @returns {Promise<boolean>} whether the delete went through
 */
async function safeDelete(source, key) {
  try {
    await source.delete(key);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { safeGet, safeSet, safeDelete };
