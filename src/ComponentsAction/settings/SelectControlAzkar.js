const ControlAzkar = require("@utils/functions/ControlAzkar");
const RadioChannels = require("@root/src/utils/helpers/RadioChannels");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { ButtonStyle, ButtonBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AnySelectMenuInteraction, ChannelType, EmbedBuilder } = require("discord.js");
const SendAzkar = require("@utils/functions/sendAzkar");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "SelectAzkarDuaa",
  enabled: true,
  /**
   * @param {AnySelectMenuInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferUpdate()
      await client.wait(200)
      const config = client.config
      const db = await client.db.table("channels");
      const action = parts[1];
      let data = await db.get(`${interaction.guildId}_azkarChannel`);

      let values = interaction.values

      switch (action) {
        case "list": {

          await db.set(`${interaction.guildId}_azkarChannel..category`, values);

          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);
          interaction.editReply(ControlAzkar(client, data2));

          break;
        }
        case "timeOptions": {

          await db.set(`${interaction.guildId}_azkarChannel..msgTimeSend`, values[0]);

          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);
          interaction.editReply(ControlAzkar(client, data2));

          break;
        }
        case "roles": {
          await db.set(`${interaction.guildId}_azkarChannel..roles`, values);
          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);
          interaction.editReply(ControlAzkar(client, data2));
          break;
        }

        case "test": {

          let channel = interaction.guild.channels.cache.get(data?.channelId)

          if (!channel) return interaction.followUp({
            content: "❌ | cant find Azkar Channel | **لا يمكن العثور علي القناه الذي تم تعينها**",
            ephemeral: true
          })

          if (data?.catogory?.length == 0) return interaction.followUp({
            content: "❌ | Please choose category | **من فضلك قم بتحديد الفئات**",
            ephemeral: true
          })

          if (!data?.enabled) return interaction.followUp({
            content: "❌ | Please enable Azkar Channel first | **من فضلك تشغيل بتفعيل الاذكار اولا**",
            ephemeral: true
          });

          let done = await SendAzkar(client, interaction.guild, data, true);
          if (done) interaction.followUp({
            content: "✅ | Azkar Channel send successfully | **تم ارسال الاذكار بنجاح**", ephemeral: true
          });
          // Todo : play Azkar test function {}
          break;
        }

        case "setChannel": {

          await db.set(`${interaction.guildId}_azkarChannel..channelId`, values[0]);
          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);
          interaction.editReply(ControlAzkar(client, data2));

          break;
        }
        case "OnOff": {
          let enabled = data?.enabled

          await db.set(`${interaction.guildId}_azkarChannel..enabled`, !enabled);
          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);

          if (enabled) {
            clearTimeout(client.Azkar.get(interaction.guild.id));
            client.Azkar.delete(interaction.guild.id);
          }
          else SendAzkar(client, interaction.guild, data2);

          interaction.editReply(ControlAzkar(client, data2));
          break;
        }
        case "EmbedOnOff": {
          let enabledEmbed = data?.embed

          await db.set(`${interaction.guildId}_azkarChannel..embed`, !enabledEmbed);
          let data2 = await db.get(`${interaction.guildId}_azkarChannel`);
          interaction.editReply(ControlAzkar(client, data2));
          break;
        }
      }



    } catch (err) {
      console.log(err);
    }
  },
};