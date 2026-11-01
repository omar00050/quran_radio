const ControlAzkar = require('@root/src/utils/functions/ControlAzkar');
const { say } = require("@utils/functions/messages");
const { buildPreview } = require('@root/src/utils/functions/quickSetup');
const { t } = require('@root/src/utils/functions/i18n');
const ControlPrayer = require('@root/src/utils/functions/ControlPrayer');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ChannelSelectMenuBuilder, ChannelType, ApplicationCommandOptionType, PermissionFlagsBits, MessageFlags } = require('discord.js');

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "setup",
  description: "setup radio channel",
  category: "ADMIN",
  botPermissions: ["ManageChannels", "SendMessages", "EmbedLinks", "ViewChannel"],
  userPermissions: ["ManageChannels", "SendMessages", "EmbedLinks", "ViewChannel"],
  cooldown: 1000,
  command: {
    enabled: false,
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "quick",
        description: "create every channel the bot needs and configure it in one step",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "radio",
        description: "to setup radio channel",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "azkar",
        description: "to setup azkar channel",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "prayer",
        description: "to setup prayer channel",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },

  async msgExecute(client, message, args, lang) { try { } catch (err) { console.log(err) } },

  async interactionExecute(client, interaction, lang) {
    try {
      const db = await client.db.table("channels");

      const Subcommand = interaction.options.getSubcommand();

      let config = client.config

      switch (Subcommand) {
        case "quick": {
          // Quick setup creates channels, so it needs a higher bar than the
          // per-service setup flows: Manage Server, checked here rather than on
          // the command as a whole so the other subcommands keep their own
          // requirement.
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
              content: say(lang, "quick.need_manage_guild"),
              flags: MessageFlags.Ephemeral,
            });
          }

          // Preview only — nothing is created until Confirm is pressed.
          const preview = await buildPreview(client, interaction, lang);
          return interaction.reply(preview);
        }

        case "radio": {

          let data = await db.get(`${interaction.guildId}_radioChannel`) || null

          let embed = new EmbedBuilder()
            .setColor("White")
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
            .setThumbnail(client.user.avatarURL({ size: 2048 }))
            .setTitle("قائمه تسطيب القناه الصوتية ")
            .setDescription("يمكنك  تحديد القناه الصوتية   ")
            // Todo: make a quick setup for radio
            // .setDescription("يمكنك  تحديد القناه الصوتية او التسطيب التلقائي")
            .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

          // The old "Quick Setup" button was removed: its row was never sent and
          // its customId "setup_Radio" had no handler, so it would have done
          // nothing if ever rendered. `/setup quick` is the real implementation.

          let Menu_setChannel = new ChannelSelectMenuBuilder()
            .setCustomId("set_RadioChannel")
            .setPlaceholder("Setup Radio Channel")
            .setChannelTypes(ChannelType.GuildVoice)
          if (data?.ch) Menu_setChannel.setDefaultChannels([data?.ch])
          let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel)

          interaction.reply({ embeds: [embed], components: [rowMenu], ephemeral: true })
          break;
        }

        case "azkar": {

          let data = await db.get(`${interaction.guildId}_azkarChannel`) || null
          let channel = interaction.guild.channels.cache.get(data?.channelId) || null

          let embed = new EmbedBuilder()
            .setColor("White")
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
            .setThumbnail(client.user.avatarURL({ size: 2048 }))
            .setTitle("قائمه تسطيب قناه الأذكار ")
            .setDescription("يمكنك  تحديد قاناه الاذكار")
            .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

          let Menu_setChannel = new ChannelSelectMenuBuilder()
            .setCustomId("set_AzkarChannel")
            .setPlaceholder("Setup Azkar Channel")
            .setChannelTypes(ChannelType.GuildText)

          let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel);

          if (channel?.id) return interaction.reply({
            ...ControlAzkar(client, data),
            ephemeral: true
          })

          interaction.reply({ embeds: [embed], components: [rowMenu], ephemeral: true });
          break;
        }

        case "prayer": {
          let data = (await db.get(`${interaction.guildId}_prayerChannel`)) || null;
          let channel = interaction.guild.channels.cache.get(data?.channelId) || null;

          let embed = new EmbedBuilder()
            .setColor("White")
            .setAuthor({
              name: client.user.username,
              iconURL: client.user.displayAvatarURL(),
              url: config.DevXorLink,
            })
            .setThumbnail(client.user.avatarURL({ size: 2048 }))
            .setTitle("قائمه تسطيب قناه الصلاه ")
            .setDescription("يمكنك  تحديد قاناه الصلاه")
            .setFooter({
              text: config.Copyright.text,
              iconURL: config.Copyright.logo,
            });

          let Menu_setChannel = new ChannelSelectMenuBuilder()
            .setCustomId("set_PrayerChannel")
            .setPlaceholder("Setup Prayer Channel")
            .setChannelTypes(ChannelType.GuildText);

          let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel);

          if (channel?.id)
            return interaction.reply({
              ...ControlPrayer(client, data),
              ephemeral: true,
            });

          interaction.reply({
            embeds: [embed],
            components: [rowMenu],
            ephemeral: true,
          });
          break;
        }

      }

    } catch (err) {
      console.log(err.message);
    }

  },
};
