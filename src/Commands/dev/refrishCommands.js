const { recursiveReadDirSync } = require("@utils/class/utils");
const { ApplicationCommandOptionType } = require("discord.js");

/** Directories whose require.cache entries are cleared on every refresh */
const HOT_DIRS = ['src/utils', 'src/Commands', 'src/ComponentsAction', 'src/events'];

/**
 * There is deliberately no stateful-module exclusion list any more.
 *
 * It used to guard `AudioBroadcaster.js`, but that guard could never work: the
 * module exported the class, not the instance, so `broadcaster.broadcasts` was
 * always undefined, the read threw, and the module was reported "skipped" on
 * every invocation. Worse, the singleton it was trying to protect actually
 * lived in `joinAndPlayQuran.js` — which IS inside HOT_DIRS — so each refresh
 * constructed a second broadcaster and orphaned the first one's ffmpeg
 * children (docs/AUDIO_REPORT.md §C2).
 *
 * The audio source now hangs off the client (`client.audio`, built once in
 * baseClient's constructor) instead of module scope, and `src/audio/**` is not
 * in HOT_DIRS. Purging these directories can no longer touch live ffmpeg
 * processes, so hot reload is safe without any exclusion machinery.
 */

/**
 * Clears require.cache for all hot-reloadable files, then reloads
 * commands, components, and events in-place without touching the
 * active Radio/Azkar/Adhan/prayerCache collections.
 *
 * @param {import("@root/src/base/baseClient")} client
 * @returns {{ commands: number, components: number, events: number, utils: number }}
 */
async function doRefresh(client) {
  // Nothing to exclude: live audio state lives on client.audio, not in any
  // module here. Kept as an empty array because the reply templates below
  // report it.
  const skipped = [];

  // 1. Purge require.cache for all hot-reloadable directories.
  for (const dir of HOT_DIRS) {
    recursiveReadDirSync(dir).forEach(fp => {
      delete require.cache[require.resolve(fp)];
    });
  }

  // 2. Clear collections so deleted files don't linger
  client.commands.clear();
  client.slashCommands.clear();
  client.ComponentsAction.clear();
  // Note: client.events entries are cleaned up inside EventsLoader per-file

  // 3. Reload — EventsLoader removes old listeners before re-registering
  client.loadCommands('src/Commands');
  client.loadComponents('src/ComponentsAction');
  client.loadEvents('src/events');

  return {
    commands:   client.commands.size,
    components: client.ComponentsAction.size,
    events:     client.events.size,
    utils:      recursiveReadDirSync('src/utils').length,
    skipped,
  };
}

/** @type {import("@utils/types/baseCommand")} */
module.exports = {
  name: "refresh",
  description: "Hot-reload commands, components, events and utils without restarting",
  category: "OWNER",
  botPermissions: [],
  userPermissions: [],
  cooldown: 5000,

  command: {
    enabled: true,
    aliases: ["re", "reload"],
    usage: "[all]",
    subcommands: [{ trigger: "all", description: "Reload all files" }],
    minArgsCount: 0,
  },

  slashCommand: {
    enabled: true,
    options: [
      {
        name: "commands",
        description: "Reload targets",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "all",
            description: "Reload all commands, components, events and utils",
            type: ApplicationCommandOptionType.Subcommand,
          },
        ],
      },
    ],
  },

  async msgExecute(client, message, args, lang) {
    const result  = await doRefresh(client);
    const warning = result.skipped.length
      ? `\n⚠ Skipped (active streams): ${result.skipped.join(', ')}`
      : '';
    await message.reply({
      content: `\`\`\`\nDONE\nCommands   : ${result.commands}\nComponents : ${result.components}\nEvents     : ${result.events}\nUtils      : ${result.utils}${warning}\`\`\``,
    });
  },

  async interactionExecute(client, interaction, lang) {
    const result  = await doRefresh(client);
    const warning = result.skipped.length
      ? `\n⚠ Skipped (active streams): ${result.skipped.join(', ')}`
      : '';
    await interaction.reply({
      content: `\`\`\`\nDONE\nCommands   : ${result.commands}\nComponents : ${result.components}\nEvents     : ${result.events}\nUtils      : ${result.utils}${warning}\`\`\``,
    });
  },
};
