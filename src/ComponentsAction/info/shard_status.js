const { EmbedBuilder, ButtonInteraction } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "shard_status",
  enabled: true,
  /**
   * @param {ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const totalShards  = client.shard?.count ?? 1;
      const guildShardId = Number(BigInt(interaction.guild.id) >> 22n) % totalShards;

      // Each shard only has its own guilds — collect counts via broadcastEval

      const formatUptime = (ms) => {
        const d = Math.floor(ms / 86400000);
        const h = Math.floor((ms % 86400000) / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
      };

      let shardStats;

      if (client.shard) {
        const raw = await client.shard.broadcastEval((c) => ({
          guilds: c.guilds.cache.size,
          ping:   Math.round(c.ws.ping),
          radio:  c.Radio.size,
          azkar:  c.Azkar.size,
          adhan:  c.Adhan.size,
          uptime: c.uptime,
          status: c.ws.status,
        }));
        // broadcastEval returns results in shard order — use index as shard ID
        shardStats = raw.map((s, i) => ({ ...s, id: i }));
      } else {
        shardStats = [{
          id:     0,
          guilds: client.guilds.cache.size,
          ping:   Math.round(client.ws.ping),
          radio:  client.Radio.size,
          azkar:  client.Azkar.size,
          adhan:  client.Adhan.size,
          uptime: client.uptime,
          status: client.ws.status,
        }];
      }

      shardStats.sort((a, b) => a.id - b.id);

      const totalGuilds  = shardStats.reduce((a, b) => a + b.guilds, 0);
      const totalUsers   = shardStats.reduce((a, b) => a + (b.users || 0), 0);
      const totalRadio   = shardStats.reduce((a, b) => a + b.radio,  0);
      const totalAzkar   = shardStats.reduce((a, b) => a + b.azkar,  0);
      const totalAdhan   = shardStats.reduce((a, b) => a + b.adhan,  0);
      const avgPing      = Math.round(shardStats.reduce((a, b) => a + b.ping, 0) / shardStats.length);
      const onlineCount  = shardStats.filter((s) => s.status === 0).length;

      // One field per shard — Discord allows up to 25 fields total
      const shardFields = shardStats.map((s) => {
        const online = s.status === 0 ? "🟢" : "🔴";
        const isHere = s.id === guildShardId ? " ◄ هذا السيرفر" : "";
        return {
          name:   `${online} Shard ${s.id}${isHere}`,
          value:  `Servers: \`${s.guilds.toLocaleString()}\` | Ping: \`${s.ping}ms\` | Uptime: \`${formatUptime(s.uptime)}\`\nRadio: \`${s.radio}\` | Azkar: \`${s.azkar}\` | Adhan: \`${s.adhan}\``,
          // inline: true,
        };
      });

      const embed = new EmbedBuilder()
        .setTitle("📡 Shard Status | حالة الشاردات")
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: client.config.DevXorLink })
        .setFooter({ text: client.config.Copyright.text, iconURL: client.config.Copyright.logo })
        .setTimestamp()
        .addFields([
          {
            name:  "📊 Overall | إجمالي",
            value: `Shards: \`${totalShards}\` (${onlineCount} online) | Servers: \`${totalGuilds.toLocaleString()}\` | Users: \`${totalUsers.toLocaleString()}\` | Avg Ping: \`${avgPing}ms\`\nRadio: \`${totalRadio}\` | Azkar: \`${totalAzkar}\` | Adhan: \`${totalAdhan}\``,
          },
          {
            name:  "🏠 This Server | هذا السيرفر",
            value: `Running on **Shard ${guildShardId}** of **${totalShards}** total shards`,
          },
          ...shardFields,
        ]);

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[shard_status]", err);
      interaction.editReply({ content: "❌ Failed to fetch shard data." });
    }
  },
};
