# Reserved Commands Migration Plan

## Context

You want to migrate reserved commands from `command/` folder to use the special function syntax:
- `!addmod <user>` → `$(twitch.moderator.add <user>)`
- `!addvip <user>` → `$(twitch.vip.add <user>)`

These will be handled by `src/handlers/commands.handler.ts`'s special functions.

## Proposed Structure Analysis

### Your Idea: `/src/reserved/twitch/file.twitch.reserved.ts`

**Issues:**
1. **Doesn't match naming convention** - Codebase uses `add_vip.channel.ts`, not `.reserved.ts`
2. **Redundant nesting** - `twitch/file.twitch.reserved.ts` duplicates category in path
3. **Scatters switch statements** - Just moves complexity around, centralizes it worse
4. **Unnecessary abstraction** - Creates new file structure without clear benefit

---

## Current Structure Assessment

### Existing TypeScript Functions (Already Ready)

| Function | Location | Mapped Command |
|----------|----------|----------------|
| `addChannelVIP` | `src/functions/channels/add_vip.channel.ts` | `$(twitch.vip.add <user>)` |
| `removeChannelVIP` | `src/functions/channels/remove_vip.channel.ts` | `$(twitch.vip.remove <user>)` |
| `addChannelModerator` | `src/functions/channels/add_moderator.channel.ts` | `$(twitch.moderator.add <user>)` |
| `removeChannelModerator` | `src/functions/channels/remove_moderator.channel.ts` | `$(twitch.moderator.remove <user>)` |
| `sendShoutout` | `src/functions/chats/shoutout.chat.ts` | `$(twitch.shoutout <user> [color])` |
| `sendAnnouncement` | `src/functions/chats/announcement.chat.ts` | `$(twitch.announce <message>)` |
| `setChannelInformation` | `src/functions/channels/set_information.channel.ts` | `$(set.game <game>), $(set.title <title>)` |
| `raid` | `src/functions/channels/raid.channel.ts` | `$(raid <channel>)` |
| `unraid` | `src/functions/channels/unraid.channel.ts` | `$(unraid)` |
| `createPoll` | `src/functions/polls/create.poll.ts` | `$(twitch.poll.create "Title" "Option1/Option2" 60)` |
| `endPoll` | `src/functions/polls/end.poll.ts` | `$(twitch.poll.end)` |

### Reserved Commands to Migrate

| Command | New Syntax | Complexity |
|---------|-----------|------------|
| `addmoderator.js` | `$(twitch.moderator.add <user>)` | Low (function exists) |
| `removemoderator.js` | `$(twitch.moderator.remove <user>)` | Low (function exists) |
| `addvip.js` | `$(twitch.vip.add <user> [days])` | Medium (needs duration tracking) |
| `removevip.js` | `$(twitch.vip.remove <user>)` | Low (function exists) |
| `shoutout.js` | `$(twitch.shoutout <user> [color])` | Medium (clip queue logic) |
| `game.js` | `$(set.game <game>)` or `$(set.game)` | Low (function exists) |
| `title.js` | `$(set.title <title>)` or `$(set.title)` | Low (function exists) |
| `poll.js` | `$(twitch.poll.create "Title" "A/B" 60)` | Medium (parsing complex) |
| `prediction.js` | `$(twitch.prediction.create ...)` | High (not yet migrated) |
| `createclip.js` | `$(clip.create)` | Low (function exists) |
| `promo.js` | `$(promo <user>)` | Medium (depends on clip queue) |
| Other fun commands | `$(fun.*)` | TBD if migrating |

---

## Three Implementation Options

### Option 1: Keep Current Approach (RECOMMENDED)

**Structure:**
- Keep `src/handlers/commands.handler.ts` as-is
- Add cases to `resolveCommandSwitch()` function
- Update `MANIFEST` constant with new commands

**Pros:**
- Aligns with existing patterns
- Centralized plan-based permission checking
- Simple, minimal changes
- Easy to maintain (one place to look)

**Cons:**
- Switch statement gets larger (manageable)
- Mixes different categories in one function

**Mitigation:**
- Group related cases with comments
- Extract helper functions for complex logic
- Keep switch cases concise (call functions, don't embed logic)

---

### Option 2: Registry Pattern

**Structure:**
```
src/reserved/
  ├── twitch/
  │   ├── moderation.ts       // Exports { add, remove }
  │   ├── vip.ts               // Exports { add, remove }
  │   ├── channel.ts           // Exports { shoutout, raid, unraid }
  │   ├── interactive.ts       // Exports { poll, prediction }
  │   └── clip.ts              // Exports { create, show }
  └── index.ts                 // Registry map
```

Each file exports functions:
```typescript
// src/reserved/twitch/moderation.ts
export const add = async (channelID: string, args: string[], ctx: ICommandContext): Promise<string> => {
    const user = args[0];
    const result = await ChannelFunctions.addChannelModerator(channelID, user);
    return result.error ? result.message : 'Moderator added';
};

export const remove = async (channelID: string, args: string[], ctx: ICommandContext): Promise<string> => {
    // ...
};
```

Registry in `commands.handler.ts`:
```typescript
import * as TwitchModeration from '../../reserved/twitch/moderation.js';

const RESERVED: Record<string, Function> = {
    'twitch.moderator.add': TwitchModeration.add,
    'twitch.moderator.remove': TwitchModeration.remove,
    // ...
};

// In resolveCommandSwitch:
if (commandName in RESERVED) {
    return await RESERVED[commandName](channelID, args, ctx);
}
```

**Pros:**
- Modular, each command in its own file
- Easy to test individual commands
- Cleaner `resolveCommandSwitch()` function

**Cons:**
- More files to maintain
- Adds abstraction layer
- Registry needs manual updates
- Plan checking needs to be duplicated or abstracted

---

### Option 3: Hybrid Approach (Best of Both)

**Structure:**
- Keep `commands.handler.ts` for plan checking and routing
- Create category-based handler files in `src/reserved/`
- Switch statement delegates to category handlers

```typescript
// src/reserved/twitch.ts
export async function handleTwitchCommand(
    subcommand: string,
    args: string[],
    ctx: ICommandContext
): Promise<string> {
    switch (subcommand) {
        case 'moderator.add': return await addModerator(channelID, args, ctx);
        case 'moderator.remove': return await removeModerator(channelID, args, ctx);
        // ...
        default: return `[Unknown twitch command: ${subcommand}]`;
    }
}

// src/handlers/commands.handler.ts
switch (commandName) {
    case 'twitch.moderator.add':
    case 'twitch.moderator.remove':
        return await handleTwitchCommand(commandName.split('.')[1], args, ctx);
    // ...
}
```

**Pros:**
- Centralized plan checking
- Logical grouping of commands
- Each category has its own switch (smaller)
- Easier to find specific command logic

**Cons:**
- Still some switch statements
- More files than Option 1

---

## Recommendation

**Go with Option 1** for the following reasons:

1. **Existing functions are ready** - Most logic already exists in `src/functions/`

2. **Switch statement is fine** - These aren't REST endpoints; they're inherently different operations

3. **Plan checking works best centralized** - `MANIFEST` and `PLANS` constants in one place

4. **Simpler is better** - Don't introduce abstractions unless needed

5. **Your codebase pattern** - You're already using this approach (see existing switch in `resolveCommandSwitch()`)

---

## Implementation Plan for Option 1

### Phase 1: Map and Update MANIFEST

Add to `MANIFEST` constant in `commands.handler.ts`:
```typescript
const MANIFEST: ICommandManifest = {
    // ... existing ...
    'twitch.moderator.add': 'free',
    'twitch.moderator.remove': 'free',
    'twitch.vip.add': 'free',
    'twitch.vip.remove': 'free',
    'twitch.shoutout': 'free',
    'twitch.announce': 'free',
    'twitch.poll.create': 'free',
    'twitch.poll.end': 'free',
    'clip.create': 'free',
    'promo': 'free',
};
```

### Phase 2: Add Switch Cases

Add to `resolveCommandSwitch()` function:
```typescript
case 'twitch.moderator.add': {
    const user = args[0];
    const result = await ChannelFunctions.addChannelModerator(channelID, user);
    return result.error ? result.message : 'Moderator added';
}

case 'twitch.vip.add': {
    // Implementation with duration tracking
}

case 'twitch.shoutout': {
    // Implementation with clip queue
}
// ... etc
```

### Phase 3: Test and Build

- Test each command manually
- Run `npm run build` to verify TypeScript
- Check for any errors

### Phase 4: Update Documentation

- Document new command syntax
- Examples in README
- Migration guide for users

---

## Special Cases to Handle

### 1. `addvip.js` Duration Tracking

The old command tracks VIP duration in MongoDB:
- Schema: `vipSchema`
- Stores: `expireDate`, `expireTimestamp`, `duration`

**Options:**
- Keep existing schema and integrate
- Create new function in `src/functions/channels/add_vip.channel.ts` to handle duration
- Or separate duration logic into new function

### 2. `shoutout.js` Clip Queue

Depends on new pub/sub clip system:
- Already uses `twitch:channelID:clips:queue` keys
- Integration with `showClip` function

**Options:**
- Migrate to use `showClip()` from `src/functions/clips/show_clip.clip.ts`
- Keep existing queue logic as-is in `commands.handler.ts`
- Or extract to new function

### 3. `poll.js` Complex Parsing

Old syntax: `!poll "Title;Option1/Option2;60"` (semicolon-separated)

New syntax: `$(twitch.poll.create "Title" "Option1/Option2" 60)` (space-separated arguments)

**Options:**
- Change syntax to match new pattern
- Or support both for backward compatibility

### 4. Fun Commands (Amor, Duel, etc.)

These are custom game logic, not Twitch API calls.

**Options:**
- Migrate to `$(fun.amor)`, `$(fun.duel)`, etc.
- Or keep as reserved commands (not migrate)
- Or don't migrate at all (leave as-is)

---

## Next Steps

1. **Confirm this approach** - Are you comfortable with Option 1?
2. **Decide on special cases** - How to handle VIP duration, fun commands?
3. **Start with low-hanging fruit** - Begin with simple commands (moderator, title, game)
4. **Progress to complex** - Tackle shoutout, poll after simple ones work

---

## Questions for You

1. Do you agree with Option 1 (keep current approach)?
2. How should we handle VIP duration tracking (keep MongoDB, migrate to new function)?
3. Should fun commands (amor, duel, etc.) be migrated or left as-is?
4. What plan level should be required for each command (free/premium/pro)?
5. Should we maintain backward compatibility with old command syntax?
