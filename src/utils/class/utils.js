
const { readdirSync, lstatSync } = require("fs");
const { join, extname } = require("path");
const { permissionWord: permissions } = require("@helpers/permissions");
const { PermissionsBitField } = require("discord.js");

module.exports = class Utils {
  /**
   * Checks if a string contains a URL
   * @param {string} text
   */
  static containsLink(text) {
    return /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/.test(
      text
    );
  };

  /**
   * Checks if a string is a valid discord invite
   * @param {string} text
   */
  static containsDiscordInvite(text) {
    return /(https?:\/\/)?(www.)?(discord.(gg|io|me|li|link|plus)|discorda?p?p?.com\/invite|invite.gg|dsc.gg|urlcord.cf)\/[^\s/]+?(?=\b)/.test(
      text
    );
  };

  /**
   * Returns a random number below a max
   * @param {number} max
   */
  static getRandomInt(max, min) {
    // Calculate random number between min and max (inclusive)
    if (min) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Math.floor(Math.random() * max);
  };

  /**
   * Checks if a string is a valid Hex color
   * @param {string} text
   */
  static isHex(text) {
    return /^#[0-9A-F]{6}$/i.test(text);
  };

  /**
   * Checks if a string is a valid Hex color
   * @param {string} text
   */

  /**
  * * Parses emoji info out of a string. The string must be one of:
  * * A UTF-8 emoji (no id) 
  * * A URL-encoded UTF-8 emoji (no id)
  * * A Discord custom emoji (`<:name:id>` or `<a:name:id>`)
  * @param {string} text Emoji string to parse
  * @returns {APIEmoji} Object with `animated`, `name`, and `id` properties
  */
  static parseEmoji(text) {
    if (text.includes('%')) text = decodeURIComponent(text);
    if (!text.includes(':')) return { animated: false, name: text, id: null };
    const match = text.match(/<?(?:(a):)?(\w{2,32}):(\d{17,19})?>?/);
    return match && { animated: Boolean(match[1]), name: match[2], id: match[3] ?? null };
  };

  /**
   * Returns hour difference between two dates
   * @param {Date} dt2
   * @param {Date} dt1
   */
  static diffHours(dt2, dt1) {
    let diff = (dt2.getTime() - dt1.getTime()) / 1000;
    diff /= 60 * 60;
    return Math.abs(Math.round(diff));
  };

  /**
   * Returns remaining time in days, hours, minutes and seconds
   * @param {number} timeInSeconds
   */
  static timeformat(timeInSeconds) {
    const days = Math.floor((timeInSeconds % 31536000) / 86400);
    const hours = Math.floor((timeInSeconds % 86400) / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = Math.round(timeInSeconds % 60);
    return (
      (days > 0 ? `${days} days, ` : "") +
      (hours > 0 ? `${hours} hours, ` : "") +
      (minutes > 0 ? `${minutes} minutes, ` : "") +
      (seconds > 0 ? `${seconds} seconds` : "")
    );
  };

  /**  
   *  It takes a string parameter `duration` which represents a time duration * * in the format `HH:MM:SS` (hours:minutes:seconds). 
   * Converts duration to milliseconds
   * @param {string} duration
   */
  static durationToMillis(duration) {
    return (
      duration
        .split(":")
        .map(Number)
        .reduce((acc, curr) => curr + acc * 60) * 1000
    );
  };

  /**
   * Returns time remaining until provided date
   * @param {Date} timeUntil
   */
  static getRemainingTime(timeUntil) {
    const seconds = Math.abs((timeUntil - new Date()) / 1000);
    const time = Utils.timeformat(seconds);
    return time;
  };


  /**
   * @param {import("discord.js").PermissionResolvable[]} perms
   */
  static parsePermissions(perms) {
    const permissionWord = `permission${perms.length > 1 ? "s" : ""}`;
    return "`" + perms.map((perm) => permissions[perm]).join(", ") + "` " + permissionWord;
  };

  /**
   * @param {import("discord.js").PermissionResolvable[]} perms
   */
  static decodePermissions(perms) {
    const permissions = BigInt(perms)
    const allowedPermissions = [];
    const deniedPermissions = [];

    for (const [key, value] of Object.entries(PermissionsBitField.Flags)) {
      if ((permissions & value) === value) {
        allowedPermissions.push(key);
      } else {
        deniedPermissions.push(key);
      }
    }

    return { allowedPermissions, deniedPermissions };
  };


  /**
   * Splits an array into chunks of a specified size
   * @example
   * const array = [1, 2, 3, 4, 5, 6];
   * const chunkedArray = Utils.chunkArray(array, 2);
   * console.log(chunkedArray); // [[1, 2], [3, 4], [5, 6]]
   * @param {any[]} array
   * @param {number} chunkSize
   * @returns {any[][]}
   */
  static chunkArray(array, chunkSize) {
    const result = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      result.push(array.slice(i, i + chunkSize));
    }
    return result;
  }

  /**
   * Recursively searches for a file in a directory
   * @param {string} dir
   * @param {string[]} allowedExtensions
   */
  static recursiveReadDirSync(dir, allowedExtensions = [".js"]) {
    const filePaths = [];
    const readCommands = (dir) => {
      const files = readdirSync(join(process.cwd(), dir));
      files.forEach((file) => {
        const stat = lstatSync(join(process.cwd(), dir, file));
        if (stat.isDirectory()) {
          readCommands(join(dir, file));
        } else {
          const extension = extname(file);
          if (!allowedExtensions.includes(extension)) return;
          const filePath = join(process.cwd(), dir, file);
          filePaths.push(filePath);
        }
      });
    };
    readCommands(dir);
    return filePaths;
  };
};