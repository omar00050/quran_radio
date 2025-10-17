const { PrayerTimes } = require("muwaqqit");
const { baseClient } = require("@root/src/base");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const drawPrayerTimes = require("./drawPray");
const moment = require("moment-timezone");
function parseTimeString(timeStr) {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return null;

  let [_, hourStr, minStr, period] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);

  if (period) {
    period = period.toUpperCase();
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
  }

  return { hour, minute };
}

function translatePrayerName(name) {
  const translations = {
    Fajr: "الفجر",
    Dhuhr: "الظهر",
    Asr: "العصر",
    Maghrib: "المغرب",
    Isha: "العشاء",
  };
  return translations[name] || name;
}

// Enum داخلي بدل adhan.Prayer
const PRAYER_ENUM = {
  Fajr: "fajr",
  Dhuhr: "dhuhr",
  Asr: "asr",
  Maghrib: "maghrib",
  Isha: "isha",
};

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
 */

/**
 * Send adhan in a channel
 * @param {baseClient} client
 * @param {import("discord.js").Guild} guild
 * @param {adhanChannelData} data
 * @param {boolean} [isTest=false]
 * @returns {Promise<boolean>}
 */
module.exports = async function SendAdhan(client, guild, data, isTest = false) {
  let db = await client.db.table("channels");

  return new Promise(async (resolve) => {
    const isDone = true;
    let data2 = await db.get(`${guild.id}_prayerChannel`);

    if (!isTest) {
      clearTimeout(client.Adhan?.get(guild.id));
      let timeout = setTimeout(async function () {
        let isGuild =
          client.guilds.cache.get(guild.id) ||
          (await client.guilds.fetch(guild.id).catch(() => null));

        if (!isGuild) {
          await db.set(`${guild.id}_prayerChannel..enabled`, false);
          clearTimeout(client.Adhan.get(guild.id));
          client.Adhan.delete(guild.id);
          return resolve(false);
        }
        await SendAdhan(client, isGuild, data2);
      }, 60_000);
      client.Adhan.set(guild.id, timeout);
    }

    let channel =
      guild.channels.cache.get(data?.channelId) ||
      (await guild.channels.fetch(data?.channelId).catch(() => null));
    if (!channel) return resolve(!isDone);

    if (data?.enabled) {
      const pt = new PrayerTimes({
        city: data.city,
        country: data.country,
        method: data.method,
        format: data.format,
      });

      const times = await pt.getTimes(new Date());
      const timezone = data.timezone;

      const now = moment().tz(timezone);
      let nextPrayer = null;
      let minDiff = Infinity;
      const PRAYER_NAMES = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

      for (const name of PRAYER_NAMES) {
        const timeStr = times[name];
        const parsed = parseTimeString(timeStr);
        if (!parsed) continue;

        const prayerTime = moment
          .tz(now.format("YYYY-MM-DD"), "YYYY-MM-DD", timezone)
          .hour(parsed.hour)
          .minute(parsed.minute)
          .second(0);

        const diff = prayerTime.diff(now);
        if (diff > 0 && diff < minDiff) {
          minDiff = diff;
          nextPrayer = { name, time: prayerTime };
        }
      }

      if (!nextPrayer) {
        const tomorrow = now.clone().add(1, "day");
        const tomorrowTimes = await pt.getTimes(tomorrow.toDate());
        const parsed = parseTimeString(tomorrowTimes.Fajr);
        const prayerTime = moment
          .tz(tomorrow.format("YYYY-MM-DD"), "YYYY-MM-DD", timezone)
          .hour(parsed.hour)
          .minute(parsed.minute)
          .second(0);

        minDiff = prayerTime.diff(now);
        nextPrayer = { name: "Fajr", time: prayerTime };
      }

      if (!nextPrayer) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowTimes = await pt.getTimes(tomorrow);
        const parsed = parseTimeString(tomorrowTimes.Fajr);
        const prayerTime = new Date(tomorrow);
        prayerTime.setHours(parsed.hour, parsed.minute, 0, 0);
        minDiff = prayerTime - now;
        nextPrayer = { name: "Fajr", time: prayerTime };
      }

      const minsLeft = Math.floor(minDiff / 60000);
      const nextPrayerTimeFormatted = nextPrayer.time.format(
        data.format === "12h" ? "hh:mm A" : "HH:mm"
      );

      if (isTest) {
        let btn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pray_${PRAYER_ENUM[nextPrayer.name]}`)
            .setLabel(`صلاه ${translatePrayerName(nextPrayer.name)}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("pray_azkar")
            .setLabel("أذكار الاذان")
            .setStyle(ButtonStyle.Secondary)
        );

        let embed = new EmbedBuilder()
          .setColor("White")
          .setAuthor({
            name: `${client.user.username} | مواقيت الاذان`,
            iconURL: client.user.displayAvatarURL(),
            url: client.config.DevXorLink,
          })
          .setDescription(
            `**الاذان القادم هو ${translatePrayerName(
              nextPrayer.name
            )} بعد ${minsLeft} دقيقة الساعة ${nextPrayerTimeFormatted}**`
          )
          .setTimestamp()
          .setFooter({
            text: `قد يختلف وقت الأذان بدقائق بسيطة`,
          });

        let sender = {};
        data.roles?.length > 0
          ? (sender.content = data.roles.map((role) => `<@&${role}>`).join(" "))
          : (sender.content = "** **");

        sender.embeds = [embed];
        sender.components = [btn];

        await channel.send(sender);
        return resolve(isDone);
      }

      const { imageBuffer } = await drawPrayerTimes({
        city: data.city,
        country: data.country,
        method: data.method,
        format: data.format,
      });
      await channel.send({
        files: [
          {
            attachment: imageBuffer,
            name: "prayer-times.png",
          },
        ],
      });

      clearTimeout(client.Adhan.get(guild.id));

      let timeout = setTimeout(async () => {
        let btn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pray_${PRAYER_ENUM[nextPrayer.name]}`)
            .setLabel(`صلاه ${translatePrayerName(nextPrayer.name)}`)
            .setStyle(ButtonStyle.Primary)
        );
        let embed = new EmbedBuilder()
          .setColor("White")
          .setAuthor({
            name: `${client.user.username} | مواقيت الاذان`,
            iconURL: client.user.displayAvatarURL(),
            url: client.config.DevXorLink,
          })
          .setTimestamp()
          .setFooter({
            text: `قد يختلف وقت الأذان بدقائق بسيطة`,
          })
          .setDescription(
            `**حان الان موعد اذان ${translatePrayerName(
              nextPrayer.name
            )} حسب التوقيت المحلي لمدينة ${data.city_ar} **`
          );

        let sender = {};
        data.roles?.length > 0
          ? (sender.content = data.roles.map((role) => `<@&${role}>`).join(" "))
          : (sender.content = "** **");

        sender.embeds = [embed];
        sender.components = [btn];
        await channel.send(sender);
        SendAdhan(client, guild, data2);
      }, minDiff);

      client.Adhan.set(guild.id, timeout);
      resolve(isDone);
    }
  });
};
