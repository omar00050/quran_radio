const axios = require("axios");
const moment = require("moment-timezone");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const drawPrayerTimes = require("./drawPray");

const PRAYER_NAMES = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const PRAYER_TRANSLATIONS = {
  Fajr: "الفجر",
  Dhuhr: "الظهر",
  Asr: "العصر",
  Maghrib: "المغرب",
  Isha: "العشاء",
};

const PRAYER_ENUM = {
  Fajr: "fajr",
  Dhuhr: "dhuhr",
  Asr: "asr",
  Maghrib: "maghrib",
  Isha: "isha",
};

/** Strip timezone suffix from Aladhan time string: "05:05 (EET)" -> { hour: 5, minute: 5 } */
function parseApiTime(timeStr) {
  const match = timeStr?.match(/^(\d+):(\d+)/);
  return match ? { hour: parseInt(match[1]), minute: parseInt(match[2]) } : null;
}

/** 5-day TTL: re-fetch if cached data is older than this */
const CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Two-layer cache for monthly prayer calendars.
 *
 * L1 — in-memory Map (fast, lost on restart):        client.prayerCache
 * L2 — database table "prayerCache" (persistent):    survives restarts
 *
 * Cache key is coordinate+method based, NOT guild-based, so every guild
 * using the same city shares one stored entry.
 *
 * @param {import("@base/baseClient")} client
 * @param {{ latitude: number, longitude: number, method: number }} data
 * @param {number} year
 * @param {number} month
 */
async function getCalendar(client, data, year, month) {
  if (!client.prayerCache) client.prayerCache = new Map();

  // Shared key — all guilds in the same location reuse this entry
  const key = `${data.latitude}_${data.longitude}_${data.method}_${year}_${month}`;

  // L1: in-memory (fastest — zero I/O)
  if (client.prayerCache.has(key)) return client.prayerCache.get(key);

  // L2: database (survives bot restarts)
  const dbCache = await client.db.table("prayerCache");
  const stored = await dbCache.get(key);

  if (stored && (Date.now() - stored.cachedAt) < CACHE_TTL_MS) {
    // Valid DB cache — populate L1 and return
    client.prayerCache.set(key, stored.data);
    return stored.data;
  }

  // Cache miss or expired — fetch from Aladhan API
  const url = `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${data.latitude}&longitude=${data.longitude}&method=${data.method}`;
  const res = await axios.get(url, { timeout: 15_000 });

  if (res.data.code !== 200) throw new Error(`Aladhan API error: ${res.data.status}`);

  const calendarData = res.data.data;

  // Persist to L2 (DB) with timestamp
  await dbCache.set(key, { data: calendarData, cachedAt: Date.now() });

  // Populate L1
  client.prayerCache.set(key, calendarData);

  return calendarData;
}

/**
 * Delete DB cache entries for months before the current one.
 * Call this on bot startup to prevent unbounded DB growth.
 * @param {import("@base/baseClient")} client
 */
async function cleanOldPrayerCache(client) {
  try {
    const dbCache = await client.db.table("prayerCache");
    const allEntries = await dbCache.all();
    if (!allEntries) return;

    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); // start of this month

    let removed = 0;
    for (const [key, value] of Object.entries(allEntries)) {
      // Keys are: lat_lng_method_year_month — parse year/month from the end
      const parts = key.split("_");
      const month = parseInt(parts[parts.length - 1]);
      const year = parseInt(parts[parts.length - 2]);
      if (!isNaN(year) && !isNaN(month)) {
        const entryDate = new Date(year, month - 1, 1).getTime();
        if (entryDate < cutoff) {
          await dbCache.delete(key);
          removed++;
        }
      }
    }

    if (removed > 0)
      console.log(`[Prayer Cache] Cleaned ${removed} expired entries from DB.`);
  } catch (err) {
    console.error("[Prayer Cache] Cleanup error:", err.message);
  }
}

/** Find the next upcoming prayer from now, fetching tomorrow's Fajr if all today's prayers passed */
async function findNextPrayer(client, data) {
  const now = moment().tz(data.timezone);
  const year = now.year();
  const month = now.month() + 1;
  const day = now.date();
  console.log("Next prayer check:", now, year, month, day);

  const calendar = await getCalendar(client, data, year, month);
  const todayTimings = calendar[day - 1]?.timings;

  for (const name of PRAYER_NAMES) {
    const parsed = parseApiTime(todayTimings?.[name]);
    if (!parsed) continue;

    const prayerMoment = now.clone().startOf("day")
      .hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0);
    const diff = prayerMoment.diff(now);

    if (diff > 0) return { name, time: prayerMoment, diff, timings: todayTimings };
  }

  // All prayers passed today — schedule tomorrow's Fajr
  const tomorrow = now.clone().add(1, "day");
  const tCalendar = await getCalendar(client, data, tomorrow.year(), tomorrow.month() + 1);
  const tomorrowTimings = tCalendar[tomorrow.date() - 1]?.timings;

  const parsed = parseApiTime(tomorrowTimings?.Fajr);
  if (!parsed) throw new Error("Cannot parse tomorrow's Fajr time");

  const prayerMoment = tomorrow.clone().startOf("day")
    .hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0);

  return { name: "Fajr", time: prayerMoment, diff: prayerMoment.diff(now), timings: tomorrowTimings };
}

/**
 * @typedef {Object} adhanChannelData
 * @property {string} channelId
 * @property {string} guildId
 * @property {boolean} enabled
 * @property {string} city
 * @property {string} city_ar
 * @property {string} country
 * @property {number} method
 * @property {string} format
 * @property {string} timezone
 * @property {string[]} roles
 */

/**
 * Schedule or immediately test the Adhan for a guild.
 * @param {import("@base/baseClient")} client
 * @param {import("discord.js").Guild} guild
 * @param {adhanChannelData} data
 * @param {boolean} [isTest=false]
 * @returns {Promise<boolean>}
 */
const SendAdhan = async function SendAdhan(client, guild, data, isTest = false) {
  if (!client.prayerCache) client.prayerCache = new Map();
  if (!client.prayerLastSent) client.prayerLastSent = new Map();

  if (!data?.enabled && !isTest) return false;

  const db = await client.db.table("channels");

  const channel =
    guild.channels.cache.get(data?.channelId) ||
    (await guild.channels.fetch(data?.channelId).catch(() => null));
  if (!channel) return false;

  let nextPrayer;
  try {
    nextPrayer = await findNextPrayer(client, data);
  } catch (err) {
    console.error(`[Prayer] API error for ${guild.name}:`, err.message);
    if (!isTest) {
      clearTimeout(client.Adhan?.get(guild.id));
      client.Adhan.set(
        guild.id,
        setTimeout(async () => {
          const fresh = await db.get(`${guild.id}_prayerChannel`);
          if (fresh?.enabled) SendAdhan(client, guild, fresh);
        }, 5 * 60_000)
      );
    }
    return false;
  }

  const timeFormatted = nextPrayer.time.format(
    data.format === "12h" ? "hh:mm A" : "HH:mm"
  );

  const totalSeconds = Math.floor(nextPrayer.diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let timeLeftText;
  if (hours > 0) {
    timeLeftText = minutes > 0
      ? `${hours} ساعة و ${minutes} دقيقة`
      : `${hours} ساعة`;
  } else if (minutes > 0) {
    timeLeftText = `${minutes} دقيقة`;
  } else {
    timeLeftText = `${seconds} ثانية`;
  }

  // ── Test mode: send immediately and return ──────────────────────────────
  if (isTest) {
    const embed = new EmbedBuilder()
      .setColor("White")
      .setAuthor({
        name: `${client.user.username} | مواقيت الاذان`,
        iconURL: client.user.displayAvatarURL(),
        url: client.config.DevXorLink,
      })
      .setDescription(
        `**الاذان القادم هو ${PRAYER_TRANSLATIONS[nextPrayer.name]} بعد ${timeLeftText} الساعة ${timeFormatted}**`
      )
      .setTimestamp()
      .setFooter({ text: "قد يختلف وقت الأذان بدقائق بسيطة" });

    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pray_${PRAYER_ENUM[nextPrayer.name]}`)
        .setLabel(`صلاه ${PRAYER_TRANSLATIONS[nextPrayer.name]}`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("pray_azkar")
        .setLabel("أذكار الاذان")
        .setStyle(ButtonStyle.Secondary)
    );

    const sender = { embeds: [embed], components: [btn] };
    sender.content =
      data.roles?.length > 0
        ? data.roles.map((r) => `<@&${r}>`).join(" ")
        : "** **";

    await channel.send(sender);
    return true;
  }

  // ── Schedule exact timeout for the next prayer ──────────────────────────
  clearTimeout(client.Adhan?.get(guild.id));

  const timeout = setTimeout(async () => {
    // Anti-spam: each prayer fires at most once per day per guild
    const now = moment().tz(data.timezone);
    const spamKey = `${guild.id}_${now.format("YYYY-MM-DD")}_${nextPrayer.name}`;
    if (client.prayerLastSent.get(spamKey)) {
      // Already sent — move on to the next prayer without sending
      const fresh = await db.get(`${guild.id}_prayerChannel`);
      if (fresh?.enabled) SendAdhan(client, guild, fresh);
      return;
    }
    client.prayerLastSent.set(spamKey, true);

    // Purge yesterday's anti-spam keys to keep memory bounded
    const todayPrefix = `${guild.id}_${now.format("YYYY-MM-DD")}`;
    for (const key of client.prayerLastSent.keys()) {
      if (key.startsWith(`${guild.id}_`) && !key.startsWith(todayPrefix)) {
        client.prayerLastSent.delete(key);
      }
    }

    // Re-fetch data to respect any config changes made since we scheduled
    const freshData = await db.get(`${guild.id}_prayerChannel`);
    if (!freshData?.enabled) return;

    const freshChannel =
      guild.channels.cache.get(freshData.channelId) ||
      (await guild.channels.fetch(freshData.channelId).catch(() => null));
    if (!freshChannel) return;

    // Send prayer times image
    try {
      const { imageBuffer } = await drawPrayerTimes({
        timings: nextPrayer.timings,
        city: freshData.city,
        city_ar: freshData.city_ar,
        format: freshData.format,
        timezone: freshData.timezone,
      });
      await freshChannel.send({
        files: [{ attachment: imageBuffer, name: "prayer-times.png" }],
      });
    } catch (err) {
      console.error(`[Prayer] Image error for ${guild.name}:`, err.message);
    }

    // Send adhan announcement embed
    const embed = new EmbedBuilder()
      .setColor("White")
      .setAuthor({
        name: `${client.user.username} | مواقيت الاذان`,
        iconURL: client.user.displayAvatarURL(),
        url: client.config.DevXorLink,
      })
      .setDescription(
        `**حان الان موعد اذان ${PRAYER_TRANSLATIONS[nextPrayer.name]} حسب التوقيت المحلي لمدينة ${freshData.city_ar}**`
      )
      .setTimestamp()
      .setFooter({ text: "يعتمد هذه التوقيت من خلال المنطقة الزمنية المختارة" });

    const btn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pray_${PRAYER_ENUM[nextPrayer.name]}`)
        .setLabel(`صلاه ${PRAYER_TRANSLATIONS[nextPrayer.name]}`)
        .setStyle(ButtonStyle.Primary)
    );

    const sender = { embeds: [embed], components: [btn] };
    sender.content =
      freshData.roles?.length > 0
        ? freshData.roles.map((r) => `<@&${r}>`).join(" ")
        : "** **";

    await freshChannel.send(sender);

    // Schedule the next prayer
    SendAdhan(client, guild, freshData);
  }, nextPrayer.diff);

  client.Adhan.set(guild.id, timeout);
  return true;
};

module.exports = SendAdhan;
module.exports.getCalendar = getCalendar;
module.exports.cleanOldPrayerCache = cleanOldPrayerCache;
