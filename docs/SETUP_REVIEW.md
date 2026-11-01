# Setup flow review — radio, adhkar, prayer

Review of the three service setup flows, looking for missing permission checks, settings saved
before validation, behaviour when a channel or role is deleted, timers that outlive the service,
and anything that fails silently.

Line numbers refer to the state of the code **before** this phase's fixes where a finding is marked
fixed, and to the current code otherwise.

| Severity | Count | Fixed in this phase |
|---|---|---|
| Critical | 7 | 7 |
| Medium | 7 | 1 |
| Minor | 5 | 2 |

---

## Critical

### C1 — `/setup` was broken for every user (fixed)

`src/Commands/Radio/setup.js:13` listed `"sendMessages"` with a lowercase `s`:

```js
userPermissions: ["ManageChannels", "sendMessages", "EmbedLinks", "ViewChannel"],
```

`PermissionsBitField.resolve("sendMessages")` throws `DiscordjsError: Invalid bitfield flag or
number: sendMessages`. The user-permission check in `src/handlers/Commands.js:118-123` runs
**outside** the `try` block that wraps `interactionExecute` (the try starts at `Commands.js:154`),
so the throw propagated to `interactionCreate`'s catch and every invocation answered "There was an
error while executing this command!".

**Impact:** nobody could run `/setup` at all — radio, adhkar or prayer. The single highest-impact
bug found.

**Fixed:** corrected to `SendMessages`. It was the only mis-cased permission in the project.

### C2 — Setup guard replies were dead code (fixed)

`src/ComponentsAction/setupMenu/set_azkar.js:19` and `set_prayer.js:26` called
`await interaction.deferUpdate()` and then used `interaction.reply()` on their guard paths
(`set_azkar.js:21-24, 31-34`; `set_prayer.js:29-32, 39-42`). Replying to an already-acknowledged
interaction throws, the throw was swallowed by the handler's `catch`, and the user saw **nothing
at all** — the menu simply appeared to do nothing.

**Fixed:** all validation now happens *before* `deferUpdate()`, using `interaction.reply({ ephemeral: true })`
for failures; `deferUpdate()` + `editReply()` is used only on the success path.

### C3 — Radio channel saved with no permission check (fixed)

`set_Radio.js:35-42` stored the selected voice channel without checking whether the bot could use
it. A channel where the bot lacks **Connect** or **Speak** was accepted, and the radio then never
played with no indication why.

**Fixed:** `ViewChannel`, `Connect` and `Speak` are verified before the write, and the reply names
exactly which permissions are missing.

### C4 — Adhkar channel saved with no permission check (fixed)

`set_azkar.js:36-44` stored a text channel without checking `SendMessages`, `EmbedLinks` or
`AttachFiles`. Adhkar are posted as rendered images, so without `AttachFiles` the service is
permanently silent while the panel reports it as enabled.

**Fixed:** checked before the write, with the missing permissions named.

### C5 — Prayer channel saved with no permission check (fixed)

`set_prayer.js:44-54`, identical to C4 — prayer cards are images too.

**Fixed:** same check.

### C6 — A deleted adhkar channel retried forever (fixed)

In `sendAzkar.js` the next run was scheduled at the top of the function (lines 45-59) and the
channel lookup happened afterwards (line 65):

```js
let channel = guild.channels.cache.get(data?.channelId) || ...;
if (!channel) return resolve(!isDone);
```

Returning there left the already-scheduled timer in place, so a guild whose adhkar channel had been
deleted woke up every `msgTimeSend` forever, found nothing, and rescheduled — with no self-heal,
nothing written back, and no log. Across many guilds this is a permanent background cost.

**Fixed:** a missing channel now clears the timer, removes the `client.Azkar` entry, sets
`enabled: false` so the guild can see the service is off, and logs a warning.

### C7 — Moving the radio channel left playback in the old channel (fixed)

`set_Radio.js:35-42` wrote the new `channelId` while `client.Radio` still held a live connection to
the **previous** channel. The database and reality disagreed: audio kept playing where it no longer
belonged, the control panel showed the new channel, and the only way out was `/control` → OFF.

**Fixed:** changing the channel now stops the existing connection, releases its recovery wait,
clears the voice status, saves with `enabled: false`, and tells the user the radio was stopped.

---

## Medium — **not fixed**, listed for a later phase

### M1 — `ms()` could make the adhkar interval fire immediately (fixed)

Listed here for completeness because it is not a setup-flow bug, but it was fixed alongside C6.
`sendAzkar.js` passed `ms(data2.msgTimeSend)` straight to `setTimeout`. `ms()` returns `undefined`
for a malformed value and **throws** on an empty one; `setTimeout(fn, undefined)` fires immediately,
turning a bad stored value into a tight loop. Now coerced, guarded, and floored at 60 seconds.

### M2 — Prayer stops silently when its channel is deleted

`sendPrayer.js:193` (`if (!channel) return false;`) and `sendPrayer.js:298`
(`if (!freshChannel) return;`). Unlike adhkar this does **not** loop — the guard sits before the
timer is armed — but the chain simply stops while the stored row still says `enabled: true`. The
panel claims prayer is on, nothing is ever posted, and it never recovers until someone toggles it
off and on.

**Suggested fix:** mirror C6 — set `enabled: false`, clear `client.Adhan`, log it.

### M3 — Changing the adhkar interval does not reschedule the running timer

`SelectControlAzkar.js:37-45` writes the new `msgTimeSend` but leaves the armed timer alone. The old
interval runs once more before the new value takes effect (the recursive call re-reads the row, so
it does self-correct after one cycle). Confusing when someone changes 6h → 10m and sees nothing for
six hours.

**Suggested fix:** clear and re-arm from the new value.

### M4 — Adhkar/prayer `setChannel` skips all validation

`SelectControlAzkar.js:80-87` and `SelectControlPrayer.js:125` write `channelId` directly from the
select menu with no existence check, no type check and no permission check — the same class of bug
as C4/C5, just reached through the control panel instead of the setup menu.

**Suggested fix:** route both through the same validation helper the setup handlers now use
(`missingTextPermissions` in `src/utils/functions/radioGuards.js`).

### M5 — Deleted roles are never pruned

Both services store role ids (`set_azkar.js:63`, `set_prayer.js` roles array) and mention them when
posting. A deleted role leaves a stale id that renders as a broken mention forever. Nothing prunes
the list.

**Suggested fix:** filter the stored ids against `guild.roles.cache` when rendering, and drop
unknown ids on write.

### M6 — A service can be enabled with no channel

Nothing prevents `enabled: true` while `channelId` is null or points at a deleted channel — the
`OnOff` handlers (`SelectControlAzkar.js:88`, `SelectControlPrayer.js:101`) do not re-validate the
channel. Prayer at least checks country and city (`SelectControlPrayer.js:102-107`); adhkar checks
nothing.

**Suggested fix:** re-validate the channel on enable and refuse with a clear reason.

### M7 — Adhkar `test` used the wrong field name

`SelectControlAzkar.js:62` read `data?.catogory` (typo) instead of `category`, so the "please choose
a category first" guard never fired and the test ran with an empty category list, silently picking
`undefined`.

**Fixed** in this phase (one-word change, zero risk) — `if (!data?.category?.length)`.

---

## Minor

### m1 — `control.js` prefix path referenced an undefined variable (fixed)

`control.js:27` used `interaction.guildId` inside `msgExecute`, where only `message` exists — a
guaranteed `ReferenceError`. Unreachable while `command.enabled` is `false`, but wrong. Now uses
`message.guildId`.

### m2 — `/control` left orphaned panels (fixed)

`control.js:48-51` posted a new panel and overwrote `msgId` without removing the previous message,
so repeated use scattered stale panels that still responded to clicks. The old panel is now deleted
first, which also removes any surviving embed-based panel from before Components v2.

### m3 — "Already set" blocks re-confirming a channel

All three setup handlers refuse when the selected channel equals the stored one. If something else
is broken (permissions changed, panel deleted), re-selecting the same channel is the natural repair
action and it is rejected. Behaviour preserved this phase, only translated.

### m4 — `lastSned` misspelling

`set_azkar.js:66`, `sendAzkar.js:16,95`. Consistent, so harmless; worth renaming if the schema is
ever migrated.

### m5 — Adhkar and prayer panels are still hardcoded Arabic

`ControlAzkar.js` and `ControlPrayer.js` contain hardcoded Arabic strings and ignore the `lang`
argument now passed to them. Out of scope for this phase (only *new* UI text was required to come
from `lang/`), but they are the largest remaining blocker to real bilingual support.

---

## Not a defect, worth knowing

- **Prayer validates location before enabling** (`SelectControlPrayer.js:102-107`) — good, and the
  pattern M6 should copy.
- **Both services clear their timers on disable** (`SelectControlAzkar.js:94-97`,
  `SelectControlPrayer.js:113-115`), so the "timer outlives the service" concern does not apply to
  the OnOff path. The gaps are channel deletion (C6, M2) and reconfiguration (M3).
- **`interaction.channels.first()`** is safe on a channel select menu; the resolved channel object
  is provided by Discord.
