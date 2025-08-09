const {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const RadioChannels = require("../helpers/RadioChannels");
const prayer = require("@helpers/prayer.json");
/**
 *
 * @param {import("../../..")} client
 * @param {*} data
 * @returns {import("discord.js").MessageReplyOptions}
 */
module.exports = function (client, data) {
  let CategoryPrayer = prayer.map((item) => ({
    label: item.country,
    value: item.country,
    emoji: item.flag,
    default: data?.country?.toLowerCase() === item.country.toLowerCase(),
  }));

  let channel =
    client.guilds.cache.get(data.guildId)?.channels.cache.get(data.channelId) ||
    null;

  let config = client.config;

  let embed = new EmbedBuilder()
    .setColor("White")
    .setAuthor({
      name: client.user.username,
      iconURL: client.user.displayAvatarURL(),
      url: config.DevXorLink,
    })
    .setThumbnail(client.user.avatarURL({ size: 2048 }))
    .setTitle("التحكم في ارسال الاذان")
    .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo });

  let btn = new ButtonBuilder().setCustomId("Selectprayer_OnOff");
  let btnTest = new ButtonBuilder()
    .setCustomId("Selectprayer_test")
    .setEmoji("✨")
    .setLabel("تجربة ارسال الاذان")
    .setStyle(ButtonStyle.Secondary);
  let btnimg = new ButtonBuilder()
    .setCustomId("Selectprayer_img")
    .setLabel("تجربة ارسال صورة الاذان")
    .setStyle(ButtonStyle.Secondary);
  let categoryPrayer = new StringSelectMenuBuilder()
    .setCustomId("Selectprayer_list")
    .setMaxValues(1)
    .setMinValues(1)
    .addOptions(CategoryPrayer)
    .setPlaceholder("اختر المدينة التي تريد ارسال الاذان لها");

  let rolesPrayer = new RoleSelectMenuBuilder()
    .setMaxValues(5)
    .setMinValues(0)
    .addDefaultRoles(data?.roles)
    .setCustomId("Selectprayer_roles")
    .setPlaceholder("اختر الادوار التي يتم اشعارها لها");

  let Menu_setChannel = new ChannelSelectMenuBuilder()
    .setCustomId("Selectprayer_setChannel")
    .setPlaceholder("Setup Prayer Channel")
    .setChannelTypes(ChannelType.GuildText);

  if (channel) Menu_setChannel.setDefaultChannels([channel?.id]);

  if (data) {
    if (data.enabled) {
      embed.setDescription(`**حاله التشغيل : ✅**`);
      btn
        .setLabel("Prayer Status")
        .setStyle(ButtonStyle.Success)
        .setEmoji("1231310986833694772");
    } else {
      embed.setDescription(`**حاله التشغيل : ❌**`);
      btn
        .setLabel("Prayer Status")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("1231310988469473372");
    }
    embed.addFields([
      {
        name: "Channel | الروم",
        value: `${
          channel?.id ? `<#${data?.channelId}>` : "`not set | لا يوجد`"
        }`,
      },
      {
        name: "City | المدينة",
        value: `\`${
          data?.city && data?.city_ar
            ? data.city + " | " + data.city_ar
            : "not set | لا يوجد"
        }\``,
      },

      {
        name: "Roles | الادوار",
        value: `${
          data?.roles.length > 0
            ? data?.roles?.map((r) => `<@&${r}>`).join(",\n")
            : ["`not set | لا يوجد`"].join(" ")
        }`,
        inline: true,
      },
    ]);

    let row = new ActionRowBuilder().addComponents(categoryPrayer);
    let row2 = new ActionRowBuilder().addComponents(rolesPrayer);
    let row3 = new ActionRowBuilder().addComponents(btn, btnimg, btnTest);

    let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel);

    return { embeds: [embed], components: [rowMenu, row, row2, row3] };
  }
};
