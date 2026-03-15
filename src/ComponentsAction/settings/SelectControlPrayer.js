const ControlPrayer = require("@utils/functions/ControlPrayer");
const {
  AnySelectMenuInteraction,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
} = require("discord.js");
const sendPrayer = require("@utils/functions/sendPrayer");
const { getCalendar } = require("@utils/functions/sendPrayer");
const drawprayer = require("@utils/functions/drawPray");
const prayer = require("@helpers/prayer.json");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "Selectprayer",
  enabled: true,
  /**
   * @param {AnySelectMenuInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferUpdate();
      await client.wait(200);

      const db = await client.db.table("channels");
      const action = parts[1];
      let data = await db.get(`${interaction.guildId}_prayerChannel`);
      const values = interaction.values;

      switch (action) {
        // ── Country selected ────────────────────────────────────────────────
        case "list": {
          const country = values[0];
          const countryInfo = prayer[country];
          if (!countryInfo) break;

          await db.set(`${interaction.guildId}_prayerChannel`, {
            ...data,
            country,
            method: countryInfo.method,
            format: countryInfo.format,
            // Clear city when country changes
            city: null,
            city_ar: null,
            timezone: null,
          });

          const data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));
          break;
        }

        // ── City selected ───────────────────────────────────────────────────
        case "city": {
          const cityName = values[0];
          const countryInfo = prayer[data?.country];
          if (!countryInfo) break;

          const cityInfo = countryInfo.cities.find(
            (c) => c.city.toLowerCase() === cityName.toLowerCase()
          );
          if (!cityInfo) break;

          await db.set(`${interaction.guildId}_prayerChannel`, {
            ...data,
            city: cityInfo.city,
            city_ar: cityInfo.city_ar,
            timezone: cityInfo.timezone,
            latitude: cityInfo.latitude,
            longitude: cityInfo.longitude,
          });

          const data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));
          break;
        }

        // ── Roles selected ──────────────────────────────────────────────────
        case "roles": {
          await db.set(`${interaction.guildId}_prayerChannel..roles`, values);
          const data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));
          break;
        }

        // ── City list: next page ────────────────────────────────────────────
        case "cityNext": {
          interaction.editReply(ControlPrayer(client, data, 1));
          break;
        }

        // ── City list: previous page ────────────────────────────────────────
        case "cityPrev": {
          interaction.editReply(ControlPrayer(client, data, 0));
          break;
        }

        // ── Toggle on/off ───────────────────────────────────────────────────
        case "OnOff": {
          if (!data?.country || !data?.city) {
            return interaction.followUp({
              content: "❌ | من فضلك اختر الدولة والمدينة أولاً",
              ephemeral: true,
            });
          }

          const enabled = data?.enabled;
          await db.set(`${interaction.guildId}_prayerChannel..enabled`, !enabled);
          const data2 = await db.get(`${interaction.guildId}_prayerChannel`);

          if (enabled) {
            clearTimeout(client.Adhan.get(interaction.guild.id));
            client.Adhan.delete(interaction.guild.id);
          } else {
            sendPrayer(client, interaction.guild, data2);
          }

          interaction.editReply(ControlPrayer(client, data2));
          break;
        }

        // ── Channel selected ────────────────────────────────────────────────
        case "setChannel": {
          await db.set(`${interaction.guildId}_prayerChannel..channelId`, values[0]);
          const data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));
          break;
        }

        // ── Test: send adhan embed ──────────────────────────────────────────
        case "test": {
          const channel = interaction.guild.channels.cache.get(data?.channelId);
          if (!channel)
            return interaction.followUp({
              content: "❌ | لا يمكن العثور على القناة",
              ephemeral: true,
            });
          if (!data?.country || !data?.city)
            return interaction.followUp({
              content: "❌ | من فضلك اختر الدولة والمدينة أولاً",
              ephemeral: true,
            });
          if (!data?.enabled)
            return interaction.followUp({
              content: "❌ | من فضلك قم بتفعيل الاذان أولاً",
              ephemeral: true,
            });

          const done = await sendPrayer(client, interaction.guild, data, true);
          if (done)
            interaction.followUp({
              content: "✅ | تم ارسال الاذان بنجاح",
              ephemeral: true,
            });
          break;
        }

        // ── Test: send prayer times image ───────────────────────────────────
        case "img": {
          const channel = interaction.guild.channels.cache.get(data?.channelId);
          if (!channel)
            return interaction.followUp({
              content: "❌ | لا يمكن العثور على القناة",
              ephemeral: true,
            });
          if (!data?.country || !data?.city)
            return interaction.followUp({
              content: "❌ | من فضلك اختر الدولة والمدينة أولاً",
              ephemeral: true,
            });

          try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();

            const calendar = await getCalendar(client, data, year, month);
            const timings = calendar?.[day - 1]?.timings;
            if (!timings) throw new Error("No timings available");

            const { imageBuffer } = await drawprayer({
              timings,
              city: data.city,
              city_ar: data.city_ar,
              format: data.format,
              timezone: data.timezone,
            });

            await channel.send({
              files: [{ attachment: imageBuffer, name: "prayer_times.png" }],
              content: `**مواقيت الصلاة | ${data.city_ar}**`,
            });

            interaction.followUp({
              content: "✅ | تم ارسال صورة مواقيت الصلاة بنجاح",
              ephemeral: true,
            });
          } catch (err) {
            console.error("[Prayer img test]", err.message);
            interaction.followUp({
              content: "❌ | حدث خطأ أثناء جلب مواقيت الصلاة",
              ephemeral: true,
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error("[SelectControlPrayer]", err);
    }
  },
};
