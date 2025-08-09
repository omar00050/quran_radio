const ControlPrayer = require("@utils/functions/ControlPrayer");
const RadioChannels = require("@root/src/utils/helpers/RadioChannels");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const {
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AnySelectMenuInteraction,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const sendPrayer = require("@utils/functions/sendPrayer");
const prayer = require("@helpers/prayer.json");
const drawprayer = require("@utils/functions/drawPray");
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
      const config = client.config;
      const db = await client.db.table("channels");
      const action = parts[1];
      let data = await db.get(`${interaction.guildId}_prayerChannel`);

      let values = interaction.values;

      switch (action) {
        case "list": {
          const selectedCountry = prayer.find(
            (item) => item.country.toLowerCase() === values[0].toLowerCase()
          );

          if (selectedCountry) {
            const { flag, ...countryData } = selectedCountry;

            await db.set(`${interaction.guildId}_prayerChannel`, {
              ...data,
              ...countryData,
            });
          }

          let data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));

          break;
        }

        case "roles": {
          await db.set(`${interaction.guildId}_prayerChannel..roles`, values);
          let data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));
          break;
        }
        case "test": {
          let channel = interaction.guild.channels.cache.get(data?.channelId);

          if (!channel)
            return interaction.followUp({
              content:
                "❌ | cant find Prayer Channel | **لا يمكن العثور علي القناه الذي تم تعينها**",
              ephemeral: true,
            });

          if (!data?.country || !data?.city)
            return interaction.followUp({
              content:
                "❌ | Please choose country | **من فضلك قم باختيار دولة**",
              ephemeral: true,
            });

          if (!data?.enabled)
            return interaction.followUp({
              content:
                "❌ | Please enable Prayer Channel first | **من فضلك تشغيل بتفعيل الاذان اولا**",
              ephemeral: true,
            });

          let done = await sendPrayer(client, interaction.guild, data, true);
          if (done)
            interaction.followUp({
              content:
                "✅ | Prayer Channel send successfully | **تم ارسال الاذان بنجاح**",
              ephemeral: true,
            });
          // Todo : play Prayer test function {}
          break;
        }
        case "img": {
          let channel = interaction.guild.channels.cache.get(data?.channelId);

          if (!channel)
            return interaction.followUp({
              content:
                "❌ | cant find Prayer Channel | **لا يمكن العثور علي القناه الذي تم تعينها**",
              ephemeral: true,
            });

          if (!data?.country || !data?.city)
            return interaction.followUp({
              content:
                "❌ | Please choose country | **من فضلك قم باختيار دولة**",
              ephemeral: true,
            });

          if (!data?.enabled)
            return interaction.followUp({
              content:
                "❌ | Please enable Prayer Channel first | **من فضلك تشغيل بتفعيل الاذان اولا**",
              ephemeral: true,
            });
            let done = await drawprayer({
              city: data.city,
              country: data.country,
              method: data.method,
              format: data.format,
            }).then((res) => {
              channel.send({
                files: [
                  {
                    attachment: res.imageBuffer,
                    name: "prayer_times.png",
                  },
                ],
                content: `**Prayer Times for ${data.city}**`,
              });
            })
          
          if (done)
            interaction.followUp({
              content:
                "✅ | Prayer Channel send successfully | **تم ارسال الاذان بنجاح**",
              ephemeral: true,
            });
          
          break;
        }

        case "setChannel": {
          await db.set(
            `${interaction.guildId}_prayerChannel..channelId`,
            values[0]
          );
          let data2 = await db.get(`${interaction.guildId}_prayerChannel`);
          interaction.editReply(ControlPrayer(client, data2));

          break;
        }
        case "OnOff": {
          let enabled = data?.enabled;

          await db.set(
            `${interaction.guildId}_prayerChannel..enabled`,
            !enabled
          );
          let data2 = await db.get(`${interaction.guildId}_prayerChannel`);

          if (enabled) {
            clearTimeout(client.Adhan.get(interaction.guild.id));
            client.Adhan.delete(interaction.guild.id);
          } else sendPrayer(client, interaction.guild, data2);

          interaction.editReply(ControlPrayer(client, data2));
          break;
        }
      }
    } catch (err) {
      console.log(err);
    }
  },
};
