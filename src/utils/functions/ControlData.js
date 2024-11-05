const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js")
const RadioChannels = require("../helpers/RadioChannels")
/**
 * 
 * @param {import("./../../../")} client 
 * @param {*} data 
 * @returns {import("discord.js").MessageReplyOptions}
 */
module.exports = function (client, data) {

  let QuranOptions = []
  let anyOptions = []
  for (let ch of RadioChannels) {
    if (ch.group == "quran") QuranOptions.push({ label: ch.name, value: ch.value, emoji: "1259470700801036401" })
    if (ch.group !== "quran") anyOptions.push({ label: ch.name, value: ch.value, emoji: "1259470700801036401" })
  }
  let config = client.config

  let embed = new EmbedBuilder()
    .setColor("White")
    .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
    .setTitle("التحكم في تشغيل و ايقاف الراديو ")
    .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

  let btn = new ButtonBuilder()
    .setCustomId("onRadio_off_radio")

  let btnNextRadio = new ButtonBuilder()
    .setCustomId("next_channel")
    .setEmoji("1025001307557343252")
    .setLabel("القناه القادمة")
    .setStyle(ButtonStyle.Secondary)

  let btnPrevRadio = new ButtonBuilder()
    .setCustomId("back_channel")
    .setEmoji("1025001498557558784")
    .setLabel("القناه السابقة")
    .setStyle(ButtonStyle.Secondary)

  // let btnVolumeUp = new ButtonBuilder()
  //   .setCustomId("random_channel")
  //   .setEmoji("1024998653640851537")
  //   .setLabel("تزييد الصوت")
  //   .setStyle(ButtonStyle.Secondary)

  // let btnVolumeDown = new ButtonBuilder()
  //   .setCustomId("soon_btn_4")
  //   .setEmoji("1024999026069872640")
  //   .setLabel("تقليل الصوت")
  //   .setStyle(ButtonStyle.Secondary)

  let btnRandomChannel = new ButtonBuilder()
    .setCustomId("random_channel")
    .setEmoji("1025002020043771934")
    .setLabel("تغيير القناه")
    .setStyle(ButtonStyle.Secondary)

  let QuranMenu = new StringSelectMenuBuilder()
    .setCustomId("Radio_list_quran")
    .addOptions(QuranOptions)
    .setPlaceholder("اختر قنوات بث القرءان الكريم")

  let anyMenu = new StringSelectMenuBuilder()
    .setCustomId("Radio_list_any")
    .addOptions(anyOptions)
    // .addOptions([{ emoji: "1259470700801036401" }])
    .setPlaceholder("اختر قنوات بث مختلفة")

  if (data) {

    let findRadio = RadioChannels.find(r => r.value == data.url)

    embed.setThumbnail(findRadio?.img || null)

    if (data.enabled) {
      embed.setDescription(`**
      حاله التشغيل : ✅
      ${findRadio?.name || "قم بتغير القناه "}
      **`)

      btn.setLabel("Radio off").setStyle(ButtonStyle.Danger).setEmoji("1031533069238292520")
    } else {
      embed.setDescription(`**
      حاله التشغيل : ❌
      ${findRadio?.name || "قم بتغير القناه "}
      **`)
      btn.setLabel("Radio on").setStyle(ButtonStyle.Success).setEmoji("1024996154410291230")
    }

    let row = new ActionRowBuilder().addComponents(QuranMenu)
    let row1 = new ActionRowBuilder().addComponents(anyMenu)
    let row2 = new ActionRowBuilder().addComponents(btn, btnRandomChannel)
    let row3 = new ActionRowBuilder().addComponents(btnPrevRadio, btnNextRadio)
    // let row4 = new ActionRowBuilder().addComponents(btnVolumeDown, btnVolumeUp)



    return { embeds: [embed], components: [row, row1, row2, row3] }

  } else return {
    content: ":warning: | لم يتم تعين اي قناه صوتية لوضع قناه التحكم استخدم امر \`/setup\` حتي تتمكن من التحكم في الراديو",
    ephemeral: true
  }

}
