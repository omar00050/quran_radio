const controlData = require("@utils/functions/ControlData");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const {
  ButtonStyle,
  ButtonBuilder,
  ChannelType,
  EmbedBuilder,
  ButtonInteraction,
} = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */

// pray_fajr
// pray_dhuhr
// pray_asr
// pray_maghrib
// pray_isha

module.exports = {
  name: "pray",
  enabled: true,
  /**
   * @param {ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferUpdate();
      const action = parts[1];
      let embed = new EmbedBuilder()
        .setAuthor({
          name: `${client.user.username} | مواقيت الاذان`,
          iconURL: client.user.displayAvatarURL(),
          url: client.config.DevXorLink,
        })
        .setColor("White")
        .setFooter({
          text: client.config.Copyright.text,
          iconURL: client.config.Copyright.logo,
        })
        .setTimestamp();
      switch (action) {
        case "azkar":
          {
            embed

              .setTitle("**أذكار الاذان**")
              .setDescription(
                `
            1- تقول مثل ما يقول المؤذن، إلا في "حي على الصلاة" و"حي على الفلاح" فتقول: لا حول ولا قوة إلا بالله.

2- بعد أن يقول المؤذن "أشهد أن لا إله إلا الله، أشهد أن محمدًا رسول الله" تقول: وأنا أشهد أن لا إله إلا الله وحده لا شريك له، وأن محمدًا عبده ورسوله، رضيت بالله ربًا، وبمحمدٍ رسولًا، وبالإسلام دينًا.

3- بعد الفراغ من إجابة المؤذن، تصلّي على النبي ﷺ فتقول: اللهم صلِّ على محمد وعلى آل محمد، كما صليت على إبراهيم وعلى آل إبراهيم، إنك حميد مجيد، وبارك على محمد وعلى آل محمد، كما باركت على إبراهيم وعلى آل إبراهيم، إنك حميد مجيد.

4- تقول بعد ذلك: اللهم رب هذه الدعوة التامة، والصلاة القائمة، آت محمدًا الوسيلة والفضيلة، وابعثه مقامًا محمودًا الذي وعدته، إنك لا تخلف الميعاد.

5- تدعو لنفسك بين الأذان والإقامة بما أحببت، فإن الدعاء حينئذٍ لا يرد.
`
              )
              .setFooter({
                text: client.config.Copyright.text,
                iconURL: client.config.Copyright.logo,
              })
              .setTimestamp();
            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
        case "fajr":
          {
            embed.setTitle("**صلاة الفجر**").setDescription(`
              إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا  
الصلاة راحة للنفس وراحة القلب  
وجلاء الهم، حافظوا عليها تسعدوا  
واقرعوا باب الرحمن تنالوا رحمته  

صـلاة الفجر  
عدد ركعاتها: ركعتان |  
السنن القبلية: ركعتان |  
السنن البعدية: لا يوجد |
`);
            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
        case "dhuhr":
          {
            embed.setTitle("**صلاة الظهر**").setDescription(`
              إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا  
الصلاة راحة للنفس وراحة القلب  
وجلاء الهم، حافظوا عليها تسعدوا  
واقرعوا باب الرحمن تنالوا رحمته  

صـلاة الظـهر  
عدد ركعاتها: أربع ركعات |  
السنن القبلية: ركعتان + ركعتان |  
السنن البعدية: ركعتان |
`);

            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
        case "asr":
          {
            embed.setTitle("**صلاة العصر**").setDescription(`
              إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا  
الصلاة راحة للنفس وراحة القلب  
وجلاء الهم، حافظوا عليها تسعدوا  
واقرعوا باب الرحمن تنالوا رحمته  

صـلاة العصر  
عدد ركعاتها: أربع ركعات |  
السنن القبلية: لا يوجد |  
السنن البعدية: لا يوجد |
`);

            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
        case "maghrib":
          {
            embed.setTitle("**صلاة المغرب**").setDescription(`
              إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا  
الصلاة راحة للنفس وراحة القلب  
وجلاء الهم، حافظوا عليها تسعدوا  
واقرعوا باب الرحمن تنالوا رحمته  

صـلاة المغرب  
عدد ركعاتها: ثلاث ركعات |  
السنن القبلية: لا يوجد |  
السنن البعدية: ركعتان |
`);

            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
        case "isha":
          {
            embed.setTitle("**صلاة العشاء**").setDescription(`
              إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَوْقُوتًا  
الصلاة راحة للنفس وراحة القلب  
وجلاء الهم، حافظوا عليها تسعدوا  
واقرعوا باب الرحمن تنالوا رحمته  

صـلاة العشاء  
عدد ركعاتها: أربع ركعات |  
السنن القبلية: لا يوجد |  
السنن البعدية: ركعتان |
`);

            await interaction.followUp({ embeds: [embed], ephemeral: true });
          }
          break;
      }
    } catch (err) {
      console.log(err);
    }
  },
};