const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js")
const RadioChannels = require("./RadioChannels")

module.exports = function (client, data) {

  let options = []
  for (let ch of RadioChannels) {
    options.push({ label: ch.name, value: ch.value })
  }
  let config = client.db.config_get

  let embed = new EmbedBuilder()
    .setColor("White")
    .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
    .setTitle("التحكم في تشغيل و ايقاف الراديو ")
    .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

  let btn = new ButtonBuilder()
    .setCustomId("onRadio_off_radio")

  let menu = new StringSelectMenuBuilder()
    .setCustomId("Radio_list")
    .addOptions(options)
    .setPlaceholder("اختر القناه الاذاعية")

  if (data) {

    let findRadio = RadioChannels.find(r => r.value == data.url)
    if (data.enabled) {
      embed.setDescription(`**
      حاله التشغيل : ✅
      ${findRadio.name}
      **`)

      btn.setLabel("Radio off").setStyle(ButtonStyle.Danger).setEmoji("1031533069238292520")
    } else {
      embed.setDescription(`**
      حاله التشغيل : ❌
      ${findRadio.name}
      **`)
      btn.setLabel("Radio on").setStyle(ButtonStyle.Success).setEmoji("1024996154410291230")
    }
    let row = new ActionRowBuilder().addComponents(menu)
    let row1 = new ActionRowBuilder().addComponents(btn)



    return { embeds: [embed], components: [row, row1] }

  } else return { content: ":warning: | لم يتم تعين اي قناه صوتية لوضع قناه التحكم", ephemeral: true }

}