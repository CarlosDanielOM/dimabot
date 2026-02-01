# Reserved Commands Migration Plan - Option 2 (Registry Pattern)

## Context

You want to migrate reserved commands from `command/` folder to use the special function syntax:
- `!addmod <user>` → `$(twitch.moderator.add <user>)`
- `!ruletarusa <user>` → `$(game.roulette <user>)`

These will be handled by `src/handlers/commands.handler.ts`'s special functions using a **Registry Pattern**.

---

## Why Option 2 (Registry Pattern)

### Your Point: Complex Game Logic

Looking at `command/ruletarusa.js` (Russian roulette), the complexity shows why granular functions don't work:

**What the command does:**
1. Checks if user is editor (can't play)
2. Gets user data
3. Checks probability (random "death" chance)
4. Tracks attempts in cache
5. If user "dies":
   - **Non-mods:** Just timeout them
   - **Mods:** Remove mod → Timeout → Wait → Add mod back
6. Manages death count cache with expiration

**Problem with granular approach:**
If we had only `$(twitch.moderator.add)`, `$(twitch.moderator.remove)`, `$(twitch.ban)`, the Russian roulette logic would need to orchestrate all these in sequence. The switch statement becomes massive with nested conditionals.

**Better approach:**
Create `src/reserved/game/roulette.ts` - handles the entire game logic internally. The handler just calls it.

---

## Final Structure: Option 2 - Registry Pattern

```
src/reserved/
  ├── index.ts                      // Central registry + exports
  │
  ├── twitch/                       // Twitch API calls
  │   ├── moderation.ts             // add, remove
  │   ├── vip.ts                    // add, remove
  │   ├── channel.ts               // shoutout, raid, unraid
  │   ├── interactive.ts           // poll, prediction
  │   └── clip.ts                  // create, show
  │
  ├── system/                       // System operations
  │   └── game.ts                   // get, set
  │
  ├── game/                         // Fun/interactive commands
  │   ├── roulette.ts               // ruletarusa
  │   ├── duel.ts                   // duel
  │   ├── amor.ts                   // amor
  │   ├── vanish.ts                 // vanish
  │   ├── timer.ts                  // timercommand
  │   └── countdown.ts              // countdowntimer
  │
  ├── other/                        // Miscellaneous
  │   ├── poll.ts                   // poll (old command, merge with interactive?)
  │   ├── prediction.ts             // prediction (old command, merge with interactive?)
  │   ├── shoutout.ts               // shoutout (old command, merge with channel?)
  │   ├── game.ts                   // game (old command, merge with system?)
  │   └── title.ts                  // title (old command, merge with system?)
  └── cli/
      ├── commandlist.ts            // commandlist
      └── command.ts                // command (add/edit/delete)
```

---

## File Format

### Example: `src/reserved/twitch/moderation.ts`

```typescript
import * as ChannelFunctions from '../../functions/channels/index.js';

interface CommandContext {
    channelID: string;
    broadcasterID: string;
    broadcasterName: string;
    messageEventData: ITwitchEventData;
    streamer?: IStreamerData | null;
    argument?: string;
    count?: number;
    variables: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
}

export async function add(
    channelID: string,
    args: string[],
    ctx: CommandContext
): Promise<string> {
    const user = args[0];
    if (!user) {
        return 'Usage: $(twitch.moderator.add <username>)';
    }

    const result = await ChannelFunctions.addChannelModerator(channelID, user);
    return result.error ? result.message : 'Moderator added';
}

export async function remove(
    channelID: string,
    args: string[],
    ctx: CommandContext
): Promise<string> {
    const user = args[0];
    if (!user) {
        return 'Usage: $(twitch.moderator.remove <username>)';
    }

    const result = await ChannelFunctions.removeChannelModerator(channelID, user);
    return result.error ? result.message : 'Moderator removed';
}
```

### Example: `src/reserved/game/roulette.ts`

```typescript
import * as ChannelFunctions from '../../functions/channels/index.js';
import * as ModerationFunctions from '../../functions/moderation/index.js';
import * as UserFunctions from '../../functions/users/index.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';

export async function roulette(
    channelID: string,
    args: string[],
    ctx: CommandContext
): Promise<string> {
    const redis = getDragonflyClient();
    const username = args[0];
    const modID = '698614112'; // Bot's mod ID

    if (!username) {
        return 'Usage: $(game.roulette <username>)';
    }

    // Check if user is editor
    const isEditor = await redis.sismember(`${channelID}:channel:editors`, username.toLowerCase());
    if (isEditor === 1) {
        return 'Editors cannot play Russian roulette.';
    }

    // Get user data
    const userDataResult = await UserFunctions.getUserByLogin(username);
    if (userDataResult.error) {
        return userDataResult.message;
    }
    const userData = userDataResult.data;

    // Can't play on own channel
    if (userData.id === channelID) {
        return 'You cannot play Russian roulette on your own channel.';
    }

    // Random chance (3/120 = 2.5% death chance)
    const probability = Math.floor(Math.random() * 120) + 1;
    const dead = probability % 3 === 0;

    // Track attempts
    const attemptKey = `${channelID}:roulette:${userData.id}`;
    const exists = await redis.exists(attemptKey);
    if (exists === 1) {
        await redis.incr(attemptKey);
    } else {
        await redis.set(attemptKey, '1');
    }
    const attempts = await redis.get(attemptKey);

    // If alive
    if (!dead) {
        return `${userData.display_name} pulled the trigger and survived. Attempt #${attempts}.`;
    }

    // If dead - calculate timeout
    const BASE_TIMEOUT = 10;
    const previousDiedCount = Number(await redis.get(`${attemptKey}:died`)) || 0;
    let timeoutTime = BASE_TIMEOUT * (previousDiedCount + 1);

    // Special case for channel 81308976
    if (channelID === '81308976' && timeoutTime < 300) {
        timeoutTime = 300;
    }

    // Check if user is mod
    const modsResult = await ModerationFunctions.getModerators(channelID);
    const isMod = modsResult.moderators?.some(mod => mod.user_id === userData.id) || false;

    if (isMod) {
        // Remove mod
        const removeResult = await ChannelFunctions.removeChannelModerator(channelID, userData.id);
        if (removeResult.error) {
            return `Error removing mod: ${removeResult.message}`;
        }

        // Timeout user
        const banResult = await ModerationFunctions.ban(channelID, userData.id, modID, timeoutTime, 'Ruleta rusa');
        if (banResult.error) {
            return `Error timing out: ${banResult.message}`;
        }

        // Add mod back after timeout + buffer
        setTimeout(async () => {
            await ChannelFunctions.addChannelModerator(channelID, userData.id);
        }, (timeoutTime * 1000) + 5000);
    } else {
        // Just timeout
        const banResult = await ModerationFunctions.ban(channelID, userData.id, modID, timeoutTime, 'Ruleta rusa');
        if (banResult.error) {
            return `Error timing out: ${banResult.message}`;
        }
    }

    // Clear attempt counter
    await redis.del(attemptKey);

    // Track deaths
    const diedKey = `${attemptKey}:died`;
    const timeDied = await redis.exists(diedKey);
    if (timeDied === 1) {
        await redis.incr(diedKey);
    } else {
        await redis.set(diedKey, '1');
        await redis.expire(diedKey, 600);
    }

    return `${userData.display_name} pulled the trigger and... BANG! Died on attempt #${attempts}.`;
}
```

---

## Central Registry: `src/reserved/index.ts`

```typescript
// Twitch API commands
export * as TwitchModeration from './twitch/moderation.js';
export * as TwitchVIP from './twitch/vip.js';
export * as TwitchChannel from './twitch/channel.js';
export * as TwitchInteractive from './twitch/interactive.js';
export * as TwitchClip from './twitch/clip.js';

// System commands
export * as SystemGame from './system/game.js';

// Game/fun commands
export * as GameRoulette from './game/roulette.js';
export * as GameDuel from './game/duel.js';
export * as GameAmor from './game/amor.js';
export * as GameVanish from './game/vanish.js';
export * as GameTimer from './game/timer.js';
export * as GameCountdown from './game/countdown.js';

// CLI/management commands
export * as CliCommandList from './cli/commandlist.js';
export * as CliCommand from './cli/command.js';

// Command registry map
import * as TwitchModeration from './twitch/moderation.js';
import * as TwitchVIP from './twitch/vip.js';
import * as TwitchChannel from './twitch/channel.js';
import * as TwitchInteractive from './twitch/interactive.js';
import * as TwitchClip from './twitch/clip.js';
import * as SystemGame from './system/game.js';
import * as GameRoulette from './game/roulette.js';
import * as GameDuel from './game/duel.js';
import * as GameAmor from './game/amor.js';
import * as GameVanish from './game/vanish.js';
import * as GameTimer from './game/timer.js';
import * as GameCountdown from './game/countdown.js';
import * as CliCommandList from './cli/commandlist.js';
import * as CliCommand from './cli/command.js';

export const RESERVED_COMMANDS: Record<string, Function> = {
    // Twitch moderation
    'twitch.moderator.add': TwitchModeration.add,
    'twitch.moderator.remove': TwitchModeration.remove,

    // Twitch VIP
    'twitch.vip.add': TwitchVIP.add,
    'twitch.vip.remove': TwitchVIP.remove,

    // Twitch channel
    'twitch.shoutout': TwitchChannel.shoutout,
    'twitch.raid': TwitchChannel.raid,
    'twitch.unraid': TwitchChannel.unraid,

    // Twitch interactive
    'twitch.poll.create': TwitchInteractive.createPoll,
    'twitch.poll.end': TwitchInteractive.endPoll,
    'twitch.prediction.create': TwitchInteractive.createPrediction,
    'twitch.prediction.end': TwitchInteractive.endPrediction,

    // Twitch clip
    'clip.create': TwitchClip.create,
    'clip.show': TwitchClip.show,
    'promo': TwitchClip.promo,

    // System
    'system.game.get': SystemGame.get,
    'system.game.set': SystemGame.set,

    // Games
    'game.roulette': GameRoulette.roulette,
    'game.duel': GameDuel.duel,
    'game.amor': GameAmor.amor,
    'game.vanish': GameVanish.vanish,
    'game.timer': GameTimer.timer,
    'game.countdown': GameCountdown.countdown,

    // CLI
    'cli.command.list': CliCommandList.list,
    'cli.command.add': CliCommand.add,
    'cli.command.edit': CliCommand.edit,
    'cli.command.delete': CliCommand.delete,
};
```

---

## Updated `commands.handler.ts`

### Update MANIFEST

```typescript
const MANIFEST: ICommandManifest = {
    // Existing commands
    'user': 'free',
    'touser': 'free',
    'random': 'free',
    'randomuser': 'free',
    'vip': 'free',
    'ban': 'free',
    'count': 'free',
    'scount': 'free',
    'twitch.subs': 'free',
    'twitch.title': 'free',
    'twitch.game': 'free',
    'twitch.channel': 'free',
    'twitch.viewers': 'free',
    'twitch.follows': 'free',
    'set.game': 'free',
    'set.title': 'free',
    'start.prediction': 'free',
    'start.poll': 'free',
    'raid': 'free',
    'unraid': 'free',
    'ai': 'free',

    // Reserved commands (from registry)
    'twitch.moderator.add': 'free',
    'twitch.moderator.remove': 'free',
    'twitch.vip.add': 'free',
    'twitch.vip.remove': 'free',
    'twitch.shoutout': 'free',
    'twitch.raid': 'free',
    'twitch.unraid': 'free',
    'twitch.poll.create': 'free',
    'twitch.poll.end': 'free',
    'twitch.prediction.create': 'free',
    'twitch.prediction.end': 'free',
    'clip.create': 'free',
    'clip.show': 'free',
    'promo': 'free',
    'system.game.get': 'free',
    'system.game.set': 'free',
    'game.roulette': 'free',
    'game.duel': 'free',
    'game.amor': 'free',
    'game.vanish': 'free',
    'game.timer': 'free',
    'game.countdown': 'free',
    'cli.command.list': 'free',
    'cli.command.add': 'free',
    'cli.command.edit': 'free',
    'cli.command.delete': 'free',
};
```

### Update `resolveCommandSwitch()`

```typescript
import { RESERVED_COMMANDS } from '../reserved/index.js';

async function resolveCommandSwitch(
    commandName: string,
    args: string[],
    ctx: ICommandContext
): Promise<string> {
    const { channelID, broadcasterID, broadcasterName, messageEventData, streamer, argument, count, variables } = ctx;

    const requiredPlan = MANIFEST[commandName];
    if (requiredPlan === undefined) {
        return `[Unknown command: ${commandName}]`;
    }

    const userPlan = ctx.userPlan || 'free';
    const userPlanLevel = PLANS[userPlan] || 0;
    const requiredPlanLevel = PLANS[requiredPlan] || 0;

    if (userPlanLevel < requiredPlanLevel) {
        return `[This feature requires ${requiredPlan} plan]`;
    }

    // Check reserved commands registry first
    if (commandName in RESERVED_COMMANDS) {
        return await RESERVED_COMMANDS[commandName](channelID, args, ctx);
    }

    // Fallback to existing simple commands
    switch (commandName) {
        case 'user':
            return messageEventData.chatter_user_name || messageEventData.chatter_user_login || '';

        case 'touser': {
            const target = args[0] || argument;
            if (target) {
                return sanitizeInput(target);
            }
            return messageEventData.chatter_user_name || messageEventData.chatter_user_login || '';
        }

        case 'random': {
            const maxNumber = parseInt(args[0] || '100', 10) || 100;
            return String(Math.floor(Math.random() * maxNumber));
        }

        case 'randomuser': {
            const chattersResult = await ChatFunctions.getChatters(channelID, channelID);
            if (chattersResult.error) {
                return chattersResult.message;
            }
            if (!chattersResult.chatters || chattersResult.chatters.length === 0) {
                return messageEventData.chatter_user_name || messageEventData.chatter_user_login || 'Unknown';
            }
            const randomChatter = chattersResult.chatters[Math.floor(Math.random() * chattersResult.chatters.length)];
            return randomChatter.user_name || randomChatter.user_login || 'Unknown';
        }

        case 'vip': {
            const user = args.join(' ') || argument;
            if (!user) return '';

            const vipResult = await ChannelFunctions.addChannelVIP(channelID, user);
            if (vipResult.error) {
                return vipResult.message;
            }
            return vipResult.message;
        }

        case 'ban':
            return '⚠️ This feature is being implemented';

        case 'count': {
            let incrementArg = args[0] || argument || '0';
            if (incrementArg !== '0') {
                incrementArg = incrementArg.replace(/\+/g, '');
            }
            const increment = parseInt(incrementArg, 10) || 0;
            const currentCount = ctx.count || 0;
            const newCount = currentCount + increment;
            ctx.count = newCount;
            return String(newCount);
        }

        case 'scount': {
            const currentCount = (ctx.count || 0) + 1;
            ctx.count = currentCount;
            return String(currentCount);
        }

        case 'twitch.subs': {
            const result = await ChannelFunctions.getChannelSubscriptions(channelID);
            if (result.error) {
                return `Error fetching subscribers: ${result.message}`;
            }
            return String(result.total || 0);
        }

        case 'twitch.title': {
            const result = await ChannelFunctions.getChannelInformation(channelID);
            if (result.error) {
                return `Error fetching channel title: ${result.message}`;
            }
            return result.data?.title || 'No title set';
        }

        case 'twitch.game': {
            const result = await ChannelFunctions.getChannelInformation(channelID);
            if (result.error) {
                return `Error fetching game: ${result.message}`;
            }
            return result.data?.game_name || 'No game set';
        }

        case 'twitch.viewers': {
            const viewersResult = await ChatFunctions.getChatters(channelID, channelID);
            if (viewersResult.error) {
                return viewersResult.message;
            }
            return String(viewersResult.chatters?.length || 0);
        }

        case 'twitch.follows': {
            const result = await ChannelFunctions.getTwitchFollowers(channelID);
            if (result.error) {
                return `Error fetching followers: ${result.message}`;
            }
            return String(result.total || 0);
        }

        case 'set.game':
            return '⚠️ This feature is being implemented';

        case 'set.title': {
            const newTitle = args[0] || '';
            if (!newTitle) {
                return 'Usage: $(set.title new title)';
            }
            const result = await ChannelFunctions.setChannelInformation(channelID, { title: newTitle });
            if (result.error) {
                return `Error setting title: ${result.message}`;
            }
            await ChatFunctions.sendTwitchChatMessage(channelID, `Title updated to: ${newTitle}`);
            return '';
        }

        case 'start.prediction':
            return '⚠️ This feature is being implemented';

        case 'start.poll':
            return '⚠️ This feature is being implemented';

        case 'raid': {
            const raidTarget = args[0] || argument || '';
            if (!raidTarget) return '';

            const raidUserData = await TwitchStreamers.getTwitchAccountById(raidTarget);
            if (!raidUserData) {
                return 'User not found';
            }

            const raidResult = await ChannelFunctions.raid(channelID, raidUserData.id || '');
            if (raidResult.error) {
                return raidResult.message || 'Error raiding channel';
            }
            return '';
        }

        case 'unraid': {
            const result = await ChannelFunctions.unraid(channelID);
            if (result.error) {
                return `Error cancelling raid: ${result.message}`;
            }
            await ChatFunctions.sendTwitchChatMessage(channelID, 'Raid cancelled!');
            return '';
        }

        case 'ai':
            return '⚠️ This feature is being implemented';

        default:
            return `[Unknown command: ${commandName}]`;
    }
}
```

---

## Migration Mapping

| Old Command | New Syntax | Category | Status |
|-------------|-----------|----------|--------|
| `addmoderator.js` | `$(twitch.moderator.add <user>)` | `twitch/moderation.ts` | ✅ Function exists |
| `removemoderator.js` | `$(twitch.moderator.remove <user>)` | `twitch/moderation.ts` | ✅ Function exists |
| `addvip.js` | `$(twitch.vip.add <user> [days])` | `twitch/vip.ts` | ⚠️ Duration handling |
| `removevip.js` | `$(twitch.vip.remove <user>)` | `twitch/vip.ts` | ✅ Function exists |
| `shoutout.js` | `$(twitch.shoutout <user> [color])` | `twitch/channel.ts` | ⚠️ Clip queue logic |
| `game.js` | `$(system.game.set <game>)` | `system/game.ts` | ✅ Function exists |
| `title.js` | `$(system.game.set.title <title>)` | `system/game.ts` | ✅ Function exists |
| `poll.js` | `$(twitch.poll.create "Title" "A/B" 60)` | `twitch/interactive.ts` | ⚠️ Syntax change |
| `prediction.js` | `$(twitch.prediction.create ...)` | `twitch/interactive.ts` | ⚠️ Not migrated yet |
| `createclip.js` | `$(clip.create)` | `twitch/clip.ts` | ✅ Function exists |
| `promo.js` | `$(promo <user>)` | `twitch/clip.ts` | ⚠️ Depends on clip queue |
| `ruletarusa.js` | `$(game.roulette <user>)` | `game/roulette.ts` | ✅ Logic defined |
| `duel.js` | `$(game.duel <user1> <user2>)` | `game/duel.ts` | ❓ To check |
| `amor.js` | `$(game.amor)` | `game/amor.ts` | ❓ To check |
| `vanish.js` | `$(game.vanish <user>)` | `game/vanish.ts` | ❓ To check |
| `timercommand.js` | `$(game.timer <time> <message>)` | `game/timer.ts` | ❓ To check |
| `countdowntimer.js` | `$(game.countdown <time> <message>)` | `game/countdown.ts` | ❓ To check |

---

## Implementation Phases

### Phase 1: Create Registry Structure (Foundation)

1. Create `src/reserved/` directory
2. Create subdirectories: `twitch/`, `system/`, `game/`, `cli/`, `other/`
3. Create `src/reserved/index.ts` with registry map (empty)
4. Update `commands.handler.ts` to import and check registry
5. Build and test

### Phase 2: Migrate Simple Twitch Commands

**Files to create:**
- `src/reserved/twitch/moderation.ts` (add, remove)
- `src/reserved/twitch/vip.ts` (add, remove - without duration first)
- `src/reserved/twitch/channel.ts` (shoutout, raid, unraid)

**Steps:**
1. Create files with simple function wrappers
2. Add to `index.ts` registry
3. Add to `MANIFEST` in `commands.handler.ts`
4. Test each command
5. Build and verify

### Phase 3: Migrate Complex Twitch Commands

**Files to create:**
- `src/reserved/twitch/interactive.ts` (poll, prediction)
- `src/reserved/twitch/clip.ts` (create, show, promo)

**Handling complexities:**
- Poll: Change syntax from `!poll "Title;A/B;60"` to `$(twitch.poll.create "Title" "A/B" 60)`
- Promo: Integrate with new pub/sub clip queue system
- Prediction: May need to create functions in `src/functions/predictions/` first

### Phase 4: Migrate Game Commands

**Files to create:**
- `src/reserved/game/roulette.ts` (ruletarusa)
- `src/reserved/game/duel.ts` (duel)
- `src/reserved/game/amor.ts` (amor)
- `src/reserved/game/vanish.ts` (vanish)
- `src/reserved/game/timer.ts` (timercommand)
- `src/reserved/game/countdown.ts` (countdowntimer)

**Steps:**
1. Read each old command file
2. Migrate logic to TypeScript
3. Handle mod removal/restoration (roulette example)
4. Test each game
5. Build and verify

### Phase 5: Migrate System Commands

**Files to create:**
- `src/reserved/system/game.ts` (get, set)

**Steps:**
1. Merge old `game.js` and `title.js` logic
2. Handle both get and set operations
3. Test
4. Build

### Phase 6: Migrate CLI Commands

**Files to create:**
- `src/reserved/cli/commandlist.ts`
- `src/reserved/cli/command.ts`

**Steps:**
1. Migrate command list logic
2. Migrate command add/edit/delete logic
3. Test
4. Build

### Phase 7: Cleanup and Documentation

1. Delete old `command/` folder files (confirm with user first)
2. Update README with new command syntax
3. Create migration guide for users
4. Add examples for each command

---

## Special Cases to Address

### 1. VIP Duration Tracking

**Old behavior:** `addvip.js` tracks VIP duration in MongoDB (`vipSchema`)

**Options:**
- Keep existing MongoDB schema and integrate
- Create new function in `src/functions/channels/add_vip.channel.ts` to handle duration
- Store duration info in Redis cache instead

**Recommendation:** Keep MongoDB for persistence, integrate into `add_vip.channel.ts`

---

### 2. Shoutout Clip Queue

**Old behavior:** `shoutout.js` checks clip connection, adds to queue

**New system:** Pub/sub based clip queue (see plan at `cat .opencode/plans/migrate_clip_functions_final.md`)

**Integration:**
- Use existing `showClip()` from `src/functions/clips/show_clip.clip.ts`
- Command checks `twitch:channelID:clips:connected` flag
- If connected, queues clip via `requestClip()`

---

### 3. Mod Removal/Restoration (Games)

**Example:** Russian roulette removes mod, times out, then adds mod back

**Implementation:**
```typescript
// Remove mod
await ChannelFunctions.removeChannelModerator(channelID, userID);

// Timeout user
await ModerationFunctions.ban(channelID, userID, modID, duration, reason);

// Restore mod after timeout + buffer
setTimeout(async () => {
    await ChannelFunctions.addChannelModerator(channelID, userID);
}, (duration * 1000) + 5000);
```

This logic stays in the game file - it's self-contained.

---

### 4. Poll Syntax Change

**Old syntax:** `!poll "Title;Option1/Option2;60"`

**New syntax:** `$(twitch.poll.create "Title" "Option1/Option2" 60)`

**Decision:** Change to new syntax for consistency. Document migration for users.

---

### 5. Prediction Functions

**Status:** Not yet migrated to TypeScript

**Action:** Create functions in `src/functions/predictions/` first (or migrate as part of this project)

---

## Benefits of This Approach

1. **Self-contained logic** - Each command file handles its own complexity
2. **Easy to test** - Can test individual commands in isolation
3. **Modular** - Add/remove commands without touching core handler
4. **Maintainable** - Related commands grouped in folders
5. **Scalable** - New categories easily added
6. **Registry pattern** - Clean mapping from command string to function
7. **Plan checking** - Centralized in `commands.handler.ts`

---

## Questions for You

1. **VIP duration:** Should we keep the MongoDB schema or migrate to Redis?

2. **Poll syntax:** Are you okay changing from `!poll "Title;A/B;60"` to `$(twitch.poll.create "Title" "A/B" 60)`?

3. **Old commands:** Should we delete the `command/` folder files after migration?

4. **Predictions:** Should we migrate `src/functions/predictions/` as part of this project?

5. **Fun commands:** Are you migrating all of them (amor, duel, vanish, timer, countdown)?

6. **CLI commands:** Do you want `cli.command.*` commands or keep them separate?

7. **Plan levels:** What plan level should each command require (free/premium/pro)?

---

## Next Steps

1. **Confirm this approach** - Does this Registry Pattern work for you?

2. **Answer questions** - VIP duration, poll syntax, etc.

3. **Start Phase 1** - Create registry structure and test

4. **Progress through phases** - Simple → Complex → Games → CLI
