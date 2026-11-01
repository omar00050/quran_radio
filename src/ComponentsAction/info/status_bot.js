const { getBroadcastStats } = require("@utils/functions/joinAndPlayQuran");
const { EmbedBuilder, ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t } = require("@utils/functions/i18n");
const { isOwner, isMod } = require("@utils/functions/access");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "status_bot",
  enabled: true,
  /**
   * @param {ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const totalShards    = client.shard?.count ?? 1;
      const currentShardId = client.shard?.ids[0] ?? 0;

      let totalGuilds, totalChannels, totalUsers, totalRadio, totalAzkar, totalAdhan;

      if (client.shard) {
        const results = await client.shard.broadcastEval((c) => ({
          guilds:   c.guilds.cache.size,
          channels: c.channels.cache.size,
          users:    c.guilds.cache.reduce((a, b) => a + b.memberCount, 0),
          radio:    c.Radio.size,
          azkar:    c.Azkar.size,
          adhan:    c.Adhan.size,
        }));
        totalGuilds   = results.reduce((a, b) => a + b.guilds,   0);
        totalChannels = results.reduce((a, b) => a + b.channels, 0);
        totalUsers    = results.reduce((a, b) => a + b.users,    0);
        totalRadio    = results.reduce((a, b) => a + b.radio,    0);
        totalAzkar    = results.reduce((a, b) => a + b.azkar,    0);
        totalAdhan    = results.reduce((a, b) => a + b.adhan,    0);
      } else {
        totalGuilds   = client.guilds.cache.size;
        totalChannels = client.channels.cache.size;
        totalUsers    = client.guilds.cache.reduce((a, b) => a + b.memberCount, 0);
        totalRadio    = client.Radio.size;
        totalAzkar    = client.Azkar.size;
        totalAdhan    = client.Adhan.size;
      }

      const activeBroadcasts = getBroadcastStats(client);
      const audioServerLine = activeBroadcasts.audioServer?.configured
        ? (activeBroadcasts.audioServer.reachable ? "✅ reachable" : "❌ unreachable")
        : "n/a (embedded)";

      const embed = new EmbedBuilder()
        .setTitle("**Bot Status** | **معلومات البوت**")
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: client.config.DevXorLink })
        .setFooter({ text: client.config.Copyright.text, iconURL: client.config.Copyright.logo })
        .setImage("https://i.pinimg.com/originals/6c/76/32/6c76328c235c489736330d743515500c.jpg")
        .addFields([
          { name: "Bot Name | اسم البوت",              value: `**${client.user.username}**`,               inline: true },
          { name: "Bot ID",                             value: `\`${client.user.id}\``,                     inline: true },
          { name: "Shard | الشارد",                    value: `\`${currentShardId} / ${totalShards}\``,    inline: true },
          { name: "Server Count | عدد السيرفرات",      value: `\`${totalGuilds.toLocaleString()}\``,       inline: true },
          { name: "Channel Count | عدد القنوات",       value: `\`${totalChannels.toLocaleString()}\``,     inline: true },
          { name: "User Count | عدد المستخدمين",       value: `\`${totalUsers.toLocaleString()}\``,        inline: true },
          { name: "Radio Channels | قنوات الراديو",    value: `\`${totalRadio}\``,                         inline: true },
          { name: "Azkar Channels | قنوات الاذكار",    value: `\`${totalAzkar}\``,                         inline: true },
          { name: "Adhan Channels | قنوات الاذان",     value: `\`${totalAdhan}\``,                         inline: true },
          { name: "Active Broadcasts | البثوث النشطة", value: `\`${activeBroadcasts.activeBroadcasts}\``,  inline: true },
          { name: "Audio Mode | نمط الصوت",             value: `\`${activeBroadcasts.mode ?? "embedded"}\``, inline: true },
          { name: "Total Listeners | عدد المستمعين",   value: `\`${activeBroadcasts.totalListeners ?? 0}\``, inline: true },
          { name: "Audio Server | سيرفر الصوت",        value: audioServerLine,                              inline: true },
          { name: "Ping | سرعة الاستجابة",             value: `\`${client.ws.ping}ms\` 🏓`,               inline: true },
          { name: "Version | الاصدار",                 value: `\`${require('../../../package.json').version}\``, inline: true },
          { name: "Developer | المطور",                value: `**${require('../../../package.json').author.name}**`, inline: true },
          { name: "Developer GitHub | حساب المطور",    value: `**${require('../../../package.json').author.url}**`, inline: true },
        ]);

      client.logger.log(
        `${client.user.username} Status Command has been used! | by user [${interaction.user.username}] | in server ${interaction.guild.name} [${interaction.guild.id}]`
      );

      // The reply is already ephemeral (deferReply above), so these buttons are
      // only ever visible to the person who pressed Status. They are still
      // just presentation: every manager action re-checks access server-side.
      const rows = [];
      const owner = isOwner(client, interaction.user.id);
      const mod = owner ? false : await isMod(client, interaction.user.id);

      if (owner || mod) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(owner ? "manager_owner" : "manager_mod")
            .setLabel(t(lang, owner ? "manager.btn_owner" : "manager.btn_mod"))
            .setStyle(ButtonStyle.Primary),
        ));
      }

      interaction.editReply({ embeds: [embed], components: rows });
    } catch (err) {
      console.error("[status_bot]", err);
      interaction.editReply({ content: "❌ Failed to fetch bot status." });
    }
  },
};
