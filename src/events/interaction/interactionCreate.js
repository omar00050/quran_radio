const { CommandHandler } = require("@src/handlers");
const BEV = require("@utils/types/baseEvents");
const { t, getGuildLang } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const { maybeSendLangPrompt } = require("@utils/functions/langPrompt");

/** @type {BEV.BaseEvent<"interactionCreate">} */
module.exports = {
  name: "interactionCreate",
  async execute(client, interaction) {
    try {
      // Check if interaction has guild
      if (!interaction.guild?.id) return interaction.reply({
        content: say(null, "common.guild_only"),
        ephemeral: true
      });

//       if (interaction.user.id !== "768414261231747093") return interaction.reply({
//         content: `⚙️ 🛠️ | We apologize for the bot being temporarily unavailable for maintenance. The bot will be back online at 8:30 PM Cairo/Egypt time. We apologize for the current inconvenience.
//         نعتذر عن البوت في الوقت الحالي في وضع صيانه مؤقتة 
// و سيعود البوت للعمل مره اخري الساعة 8:30 مساءََ بتوقيت مصر/القاهرة 
// نعتذر عن عن الوقت الحالي  و شكرا لتفهمكم`,
//         ephemeral: true
//       });

      // getGuildLang falls back to English on a missing/invalid stored value;
      // requiring `lang/<value>.json` directly would throw and take down every
      // interaction in that guild.
      const lang = await getGuildLang(client, interaction.guild.id);

      // Check if interaction is a command
      if (interaction.isChatInputCommand()) {
        await CommandHandler.handleSlashCommand(client, interaction, lang);
        // After the command, never before: the one-time language tip must not
        // delay it, and must not be able to break it either.
        maybeSendLangPrompt(client, interaction).catch(() => { });
      }
      if (interaction.isAutocomplete()) CommandHandler.handleAutoComplete(client, interaction, lang);

      // Check if interaction is a button, select menu or modal submit
      if (
        interaction.isButton()
        || interaction.isModalSubmit()
        || interaction.isAnySelectMenu()
      ) {
        if (interaction?.customId?.startsWith('collect')) return;

        if (client.UserHold.get(interaction.user.id)) return interaction.reply({ content: say(lang, "common.busy"), ephemeral: true })

        let customId = interaction?.customId;

        const parts = customId?.split('_');

        // Check if interaction is a button
        const component = client.ComponentsAction.get(`${parts[0]}_${parts[1]}`) || client.ComponentsAction.get(`${parts[0]}_${parts[1]}_${parts[2]}`) || client.ComponentsAction.get(parts[0]) || client.ComponentsAction.get(customId);

        if (!component) return;


        await component.action(client, interaction, parts, lang);

        // Same one-time tip for button/menu use. Skipped for the language
        // buttons themselves, which would otherwise answer their own prompt.
        if (!String(customId).startsWith('langset')) {
          maybeSendLangPrompt(client, interaction).catch(() => { });
        }
      };
    } catch (error) {
      console.error(error);
      try {
        if (!interaction.isRepliable()) return;
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'There was an error while executing this command!' });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
      } catch (_) { /* interaction expired or already handled — ignore */ }
    };
  },
};