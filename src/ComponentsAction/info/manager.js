const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { t } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const {
  isOwner,
  requireAccess,
  isValidId,
  addMod,
  removeMod,
  listMods,
} = require("@utils/functions/access");
const {
  resetGuildData,
  findGuild,
  inspectGuildData,
  shardIdFor,
} = require("@utils/functions/resetGuildData");

const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/**
 * Owner and mod manager.
 *
 * Reached through `manager_<action>[_<arg>]`. interactionCreate's lookup tries
 * the two- and three-segment forms first; neither is registered, so everything
 * falls through to `parts[0]` — this component.
 *
 * Authorisation is re-checked inside every branch. The buttons are only
 * *rendered* for owners and mods, but a customId can be replayed by anyone who
 * can see the message, so rendering is never treated as permission.
 *
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "manager",
  enabled: true,
  /**
   * @param {import("discord.js").MessageComponentInteraction|import("discord.js").ModalSubmitInteraction} interaction
   * @param {string[]} parts
   */
  async action(client, interaction, parts, lang) {
    const action = parts[1];

    try {
      switch (action) {
        // ── Home pages ───────────────────────────────────────────────────
        case "owner": {
          if (!await requireAccess(client, interaction, lang, "owner")) return;
          return interaction.reply({ ...ownerHome(client, lang), flags: EPHEMERAL_V2 });
        }

        case "mod": {
          if (!await requireAccess(client, interaction, lang, "mod")) return;
          return interaction.reply({ ...modHome(client, lang), flags: EPHEMERAL_V2 });
        }

        case "home": {
          // "Back" — render whichever home the presser is actually entitled to.
          if (isOwner(client, interaction.user.id)) {
            if (!await requireAccess(client, interaction, lang, "owner")) return;
            return interaction.update(ownerHome(client, lang));
          }
          if (!await requireAccess(client, interaction, lang, "mod")) return;
          return interaction.update(modHome(client, lang));
        }

        // ── Mods: add / remove (owner only) ──────────────────────────────
        case "addmod":
        case "removemod": {
          if (!await requireAccess(client, interaction, lang, "owner")) return;
          const adding = action === "addmod";
          return interaction.showModal(
            new ModalBuilder()
              .setCustomId(`manager_${adding ? "addmodsubmit" : "removemodsubmit"}`)
              .setTitle(t(lang, adding ? "manager.modal_add_title" : "manager.modal_remove_title"))
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("userId")
                    .setLabel(t(lang, "manager.modal_user_label"))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(17)
                    .setMaxLength(20)
                    .setRequired(true),
                ),
              ),
          );
        }

        case "addmodsubmit":
        case "removemodsubmit": {
          if (!await requireAccess(client, interaction, lang, "owner")) return;

          const raw = interaction.fields.getTextInputValue("userId").trim();
          if (!isValidId(raw)) {
            return interaction.reply({ content: say(lang, "manager.invalid_id", { id: raw }), flags: MessageFlags.Ephemeral });
          }

          if (action === "addmodsubmit") {
            if (isOwner(client, raw)) {
              return interaction.reply({ content: say(lang, "manager.mod_is_owner", { id: raw }), flags: MessageFlags.Ephemeral });
            }
            const added = await addMod(client, raw, interaction.user.id);
            client.logger?.warn?.(`[manager] ${interaction.user.id} ${added ? "added" : "re-added"} mod ${raw}`);
            return interaction.reply({
              content: say(lang, added ? "manager.mod_added" : "manager.mod_already", { id: raw }),
              flags: MessageFlags.Ephemeral,
            });
          }

          const removed = await removeMod(client, raw);
          if (removed) client.logger?.warn?.(`[manager] ${interaction.user.id} removed mod ${raw}`);
          return interaction.reply({
            content: say(lang, removed ? "manager.mod_removed" : "manager.mod_not_found", { id: raw }),
            flags: MessageFlags.Ephemeral,
          });
        }

        case "listmods": {
          if (!await requireAccess(client, interaction, lang, "owner")) return;

          const mods = await listMods(client);
          const body = mods.length
            ? mods.map((m) => t(lang, "manager.mods_list_entry", {
              id: m.userId,
              addedBy: m.addedBy,
              when: m.addedAt ? `<t:${Math.floor(m.addedAt / 1000)}:R>` : "",
            })).join("\n")
            : t(lang, "manager.mods_list_empty");

          return interaction.update(page(
            `## ${t(lang, "manager.mods_list_title")}`,
            body,
            lang,
          ));
        }

        // ── Reset server data (mod or owner) ─────────────────────────────
        case "reset": {
          if (!await requireAccess(client, interaction, lang, "mod")) return;
          return interaction.showModal(
            new ModalBuilder()
              .setCustomId("manager_resetlookup")
              .setTitle(t(lang, "manager.modal_guild_title"))
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("guildId")
                    .setLabel(t(lang, "manager.modal_guild_label"))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(17)
                    .setMaxLength(20)
                    .setRequired(true),
                ),
              ),
          );
        }

        case "resetlookup": {
          if (!await requireAccess(client, interaction, lang, "mod")) return;

          const raw = interaction.fields.getTextInputValue("guildId").trim();
          if (!isValidId(raw)) {
            return interaction.reply({ content: say(lang, "manager.invalid_id", { id: raw }), flags: MessageFlags.Ephemeral });
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          const guild = await findGuild(client, raw);
          if (!guild) {
            return interaction.editReply({ content: say(lang, "manager.reset_not_found", { id: raw }) });
          }

          const data = await inspectGuildData(client, raw);
          if (!data.any) {
            return interaction.editReply({ content: say(lang, "manager.reset_nothing") });
          }

          // Show exactly what will go before anything is touched.
          const items = [];
          if (data.radio) items.push(`• ${t(lang, "manager.reset_item_radio")}`);
          if (data.azkar) items.push(`• ${t(lang, "manager.reset_item_azkar")}`);
          if (data.prayer) items.push(`• ${t(lang, "manager.reset_item_prayer")}`);
          if (data.lang || data.prefix) items.push(`• ${t(lang, "manager.reset_item_lang")}`);
          items.push(`• ${t(lang, "manager.reset_item_runtime")}`);

          const container = new ContainerBuilder()
            .setAccentColor(0xed4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              `## ${t(lang, "manager.reset_confirm_title")}\n`
              + t(lang, "manager.reset_confirm_body", {
                name: guild.name,
                id: guild.id,
                shard: `\`${guild.shardId ?? shardIdFor(guild.id, client.shard?.count ?? 1)}\``,
              }),
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              `${t(lang, "manager.reset_will_delete")}\n${items.join("\n")}\n\n`
              + t(lang, "manager.reset_keeps_membership"),
            ))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`manager_resetgo_${guild.id}`)
                .setLabel(t(lang, "manager.btn_reset_confirm"))
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId("manager_home")
                .setLabel(t(lang, "manager.btn_back"))
                .setStyle(ButtonStyle.Secondary),
            ));

          return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [container] });
        }

        case "resetgo": {
          if (!await requireAccess(client, interaction, lang, "mod")) return;

          const guildId = parts[2];
          if (!isValidId(guildId)) {
            return interaction.reply({ content: say(lang, "manager.invalid_id", { id: guildId }), flags: MessageFlags.Ephemeral });
          }

          await interaction.deferUpdate();

          const guild = await findGuild(client, guildId);
          const result = await resetGuildData(
            client,
            guildId,
            { id: interaction.user.id, tag: interaction.user.tag },
            guild ?? {},
          );

          const body = result.errors.length
            ? say(lang, "manager.reset_failed", { id: guildId, reason: result.errors.join("; ") })
            : say(lang, "manager.reset_done", {
              name: result.guildName,
              id: guildId,
              deleted: result.deleted.length ? result.deleted.join(", ") : t(lang, "manager.reset_nothing_deleted"),
            });

          return interaction.editReply(page(`## ${t(lang, "manager.reset_confirm_title")}`, body, lang));
        }

        default:
          return;
      }
    } catch (err) {
      client.logger?.error?.("manager", err);
      const payload = { content: say(lang, "common.unexpected"), flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (_) { /* interaction gone */ }
    }
  },
};

/** Owner home: mod management plus everything a mod can do. */
function ownerHome(client, lang) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${t(lang, "manager.owner_title")}\n${t(lang, "manager.home")}`,
    ))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("manager_addmod").setLabel(t(lang, "manager.btn_add_mod")).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("manager_removemod").setLabel(t(lang, "manager.btn_remove_mod")).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("manager_listmods").setLabel(t(lang, "manager.btn_list_mods")).setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("manager_reset").setLabel(t(lang, "manager.btn_reset_guild")).setStyle(ButtonStyle.Danger),
      ),
    );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Mod home: reset only. */
function modHome(client, lang) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${t(lang, "manager.mod_title")}\n${t(lang, "manager.home")}`,
    ))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("manager_reset").setLabel(t(lang, "manager.btn_reset_guild")).setStyle(ButtonStyle.Danger),
    ));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** A simple result page with a Back button. */
function page(heading, body, lang) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${heading}\n${body}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("manager_home").setLabel(t(lang, "manager.btn_back")).setStyle(ButtonStyle.Secondary),
    ));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}
