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
const prayer = require("@helpers/prayer.json");

/**
 * @param {import("../../..")} client
 * @param {*} data
 * @param {number} [cityPage=0]  0 = cities 1-25, 1 = cities 26-50
 * @returns {import("discord.js").MessageReplyOptions}
 */
module.exports = function (client, data, cityPage = 0) {
  const config = client.config;

  const channel =
    client.guilds.cache.get(data?.guildId)?.channels.cache.get(data?.channelId) || null;

  // ── Embed ──────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor("White")
    .setAuthor({
      name: client.user.username,
      iconURL: client.user.displayAvatarURL(),
      url: config.DevXorLink,
    })
    .setThumbnail(client.user.avatarURL({ size: 2048 }))
    .setTitle("التحكم في ارسال الاذان")
    .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo });

  embed.setDescription(data?.enabled ? "**حاله التشغيل : ✅**" : "**حاله التشغيل : ❌**");

  embed.addFields([
    {
      name: "Channel | القناة",
      value: channel?.id ? `<#${data?.channelId}>` : "`not set | لا يوجد`",
    },
    {
      name: "Country | الدولة",
      value: data?.country ? `\`${data.country}\`` : "`not set | لا يوجد`",
      inline: true,
    },
    {
      name: "City | المدينة",
      value:
        data?.city && data?.city_ar
          ? `\`${data.city} | ${data.city_ar}\``
          : "`not set | لا يوجد`",
      inline: true,
    },
    {
      name: "Roles | الأدوار",
      value:
        data?.roles?.length > 0
          ? data.roles.map((r) => `<@&${r}>`).join(",\n")
          : "`not set | لا يوجد`",
    },
  ]);

  // ── Row 1: Channel select ─────────────────────────────────────────────────
  const Menu_setChannel = new ChannelSelectMenuBuilder()
    .setCustomId("Selectprayer_setChannel")
    .setPlaceholder("Setup Prayer Channel")
    .setChannelTypes(ChannelType.GuildText);
  if (channel) Menu_setChannel.setDefaultChannels([channel.id]);

  // ── Row 2: Country dropdown ───────────────────────────────────────────────
  const countryOptions = Object.entries(prayer).map(([country, info]) => ({
    label: country,
    value: country,
    emoji: info.flag,
    default: data?.country?.toLowerCase() === country.toLowerCase(),
  }));

  const countryMenu = new StringSelectMenuBuilder()
    .setCustomId("Selectprayer_list")
    .setMaxValues(1)
    .setMinValues(1)
    .setPlaceholder("اختر الدولة")
    .addOptions(countryOptions);

  // ── Row 3: City dropdown (paginated) ─────────────────────────────────────
  const selectedCountryData = data?.country ? prayer[data.country] : null;
  const allCities = selectedCountryData?.cities ?? [];
  const totalCities = allCities.length;
  const hasNextPage = totalCities > 25 && cityPage === 0;
  const hasPrevPage = cityPage === 1;

  const pageSlice = allCities.slice(cityPage * 25, cityPage * 25 + 25);

  const cityOptions = selectedCountryData
    ? pageSlice.map((c) => ({
        label: `${c.city} | ${c.city_ar}`,
        value: c.city,
        default: data?.city?.toLowerCase() === c.city.toLowerCase(),
      }))
    : [{ label: "اختر الدولة أولاً", value: "placeholder" }];

  const cityMenu = new StringSelectMenuBuilder()
    .setCustomId("Selectprayer_city")
    .setMaxValues(1)
    .setMinValues(1)
    .setPlaceholder(
      !selectedCountryData
        ? "اختر الدولة أولاً"
        : cityPage === 1
        ? `المحافظات (${allCities.length - 25} المتبقية)`
        : "اختر المدينة"
    )
    .setDisabled(!selectedCountryData)
    .addOptions(cityOptions);

  // ── Row 4: Roles ──────────────────────────────────────────────────────────
  const rolesMenu = new RoleSelectMenuBuilder()
    .setMaxValues(5)
    .setMinValues(0)
    .setCustomId("Selectprayer_roles")
    .setPlaceholder("اختر الأدوار التي يتم إشعارها");
  if (data?.roles?.length > 0) rolesMenu.setDefaultRoles(data.roles);

  // ── Row 5: Buttons (+ optional page-toggle) ───────────────────────────────
  const btnToggle = new ButtonBuilder()
    .setCustomId("Selectprayer_OnOff")
    .setLabel("Prayer Status")
    .setStyle(data?.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
    .setEmoji(data?.enabled ? "1231310986833694772" : "1231310988469473372");

  const btnImg = new ButtonBuilder()
    .setCustomId("Selectprayer_img")
    .setLabel("صورة الاذان")
    .setStyle(ButtonStyle.Secondary);

  const btnTest = new ButtonBuilder()
    .setCustomId("Selectprayer_test")
    .setEmoji("✨")
    .setLabel("تجربة الاذان")
    .setStyle(ButtonStyle.Secondary);

  const buttons = [btnToggle, btnImg, btnTest];

  if (hasNextPage) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("Selectprayer_cityNext")
        .setLabel(`المزيد (${totalCities - 25}+)`)
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Primary)
    );
  } else if (hasPrevPage) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("Selectprayer_cityPrev")
        .setLabel("رجوع للقائمة")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Primary)
    );
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(Menu_setChannel),
      new ActionRowBuilder().addComponents(countryMenu),
      new ActionRowBuilder().addComponents(cityMenu),
      new ActionRowBuilder().addComponents(rolesMenu),
      new ActionRowBuilder().addComponents(...buttons),
    ],
  };
};
