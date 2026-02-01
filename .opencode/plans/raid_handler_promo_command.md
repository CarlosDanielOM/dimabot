# Plan: Enable Raid Handler and Create Promo Command

## Overview
Migrate raid handler from old JS to TypeScript, replacing shoutout with promo command. The promo command will use the new pub/sub clip queue system.

## Files to Create

### 1. `src/functions/users/get_user_by_login.users.ts`
**Purpose**: Get Twitch user data by login name
**API Endpoint**: `GET /helix/users?login={login}`

```typescript
interface TwitchUserData {
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    view_count: number;
    created_at: string;
}

interface GetUserByLoginResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: TwitchUserData;
}

export async function getTwitchUserByLogin(login: string, skipCache: boolean = false): Promise<GetUserByLoginResponse>
```

**Pattern**: Similar to `get_user_by_id.users.ts` but uses login parameter
**Dependencies**: `getTwitchAppHeader`, `getTwitchHelixUrl`

---

### 2. `src/functions/promo/chat.promo.ts`
**Purpose**: Promo command that sends announcements and optionally shows clips using pub/sub queue system

**Function Signature**:
```typescript
interface PromoResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: {
        streamerChannelInfo?: {
            game: string;
            title: string;
            login: string;
            name: string;
        };
        clip?: any;
    };
}

export async function promo(
    channelID: string,
    streamerName: string,
    sendClip: boolean = false
): Promise<PromoResponse>
```

**Key Features**:
- Check if OBS is connected before adding to queue (optional)
- Get streamer data by login (using `getTwitchUserByLogin`)
- Get broadcaster data by ID (using `getTwitchUserById`)
- Get channel information (using `getChannelInformation`)
- Get clips (using `getChannelClips`)
- If `sendClip=true`: call `showClip` with `sendToQueue=false` (queue managed separately)
- Build announcement message
- No announcement/shoutout sent by this function (caller handles that)

**Cache Keys**:
- `twitch:${channelID}:clips:connected` - Check if OBS connected
- Uses existing clip functions that handle queue via pub/sub

**Pattern**: Simplified version of old promo.js, focuses on data gathering and clip queue management
**Dependencies**:
- `getTwitchUserByLogin` (new function)
- `getTwitchUserById` (existing)
- `getChannelInformation` (existing)
- `getChannelClips` (existing)
- `showClip` (existing, with pub/sub support)
- `getDragonflyClient` (existing)

---

### 3. `src/handlers/raid.handler.ts`
**Purpose**: Handle channel.raid events from Twitch EventSub

**Function Signature**:
```typescript
interface RaidEventData {
    to_broadcaster_user_id: string;
    to_broadcaster_user_login: string;
    from_broadcaster_user_id: string;
    from_broadcaster_user_name: string;
    from_broadcaster_user_login: string;
    viewers: number;
}

interface RaidHandlerResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function raidHandler(
    eventData: RaidEventData,
    eventsubData: IEventsub
): Promise<RaidHandlerResponse>
```

**Key Features**:
- Check `eventsubData.minViewers` against `eventData.viewers`
- Get streamer (raider) data by login (using `getTwitchUserByLogin`)
- Get raider channel information (using `getChannelInformation`)
- Call promo function to:
  - Check clip connection and queue clips if connected
  - Gather all necessary data
- Build announcement message:
  - Format: `Check out {raiderChannel.name} at https://twitch.tv/{raiderChannel.login} and give them a follow! They were last playing {raiderChannel.game}`
- Send announcement using `sendAnnouncement` with purple color and modID='698614112'
- Send shoutout using `sendShoutout` with modID='698614112'

**Pattern**: Simplified version of old raid.js, replaces shoutout command with direct promo call
**Dependencies**:
- `getTwitchUserByLogin` (new function)
- `getChannelInformation` (existing)
- `promo` (new function)
- `sendAnnouncement` (existing)
- `sendShoutout` (existing)

**Constants**:
- `const modID = '698614112';` (consistent with message.handler.ts)

---

### 4. `src/interfaces/twitch/eventsub.interface.ts`
**Purpose**: Add raid event data interface

**Add to file**:
```typescript
interface IRaidEventData extends ITwitchEventBase {
    viewers: number;
    to_broadcaster_user_id: string;
    to_broadcaster_user_login: string;
    to_broadcaster_user_name: string;
    from_broadcaster_user_id: string;
    from_broadcaster_user_login: string;
    from_broadcaster_user_name: string;
}

export type ITwitchEventData = IBitUseEvent | IChatMessage | IRaidEventData;
```

---

### 5. `src/handlers/eventsub.handler.ts`
**Purpose**: Integrate raid handler into eventsub switch case

**Changes**:
1. Import raid handler: `import { raidHandler } from './raid.handler.js';`
2. Add case in switch statement:
```typescript
case 'channel.raid':
    await raidHandler(eventData as IRaidEventData, eventsubData);
    break;
```
3. Remove TODO comment for raid handler

---

### 6. `src/functions/users/index.ts`
**Purpose**: Export new function

**Add**:
```typescript
export { getTwitchUserByLogin } from './get_user_by_login.users.js';
```

---

## Implementation Order

### Phase 1: Core Functions
1. Create `src/functions/users/get_user_by_login.users.ts`
2. Update `src/functions/users/index.ts` to export new function
3. Run `npm run build` to verify TypeScript compilation

### Phase 2: Promo Command
4. Create `src/functions/promo/chat.promo.ts`
5. Create `src/functions/promo/index.ts` (if needed)
6. Run `npm run build` to verify

### Phase 3: Raid Handler
7. Update `src/interfaces/twitch/eventsub.interface.ts` to add IRaidEventData
8. Create `src/handlers/raid.handler.ts`
9. Run `npm run build` to verify

### Phase 4: Integration
10. Update `src/handlers/eventsub.handler.ts` to integrate raid handler
11. Run `npm run build` for final verification
12. Test raid event handling

---

## Key Differences from Old Implementation

### Old JS (raid.js):
- Used shoutout command
- Command handled announcements and shoutouts internally
- Used old clip queue system (list-based)

### New TypeScript:
- Directly calls promo function
- Handler controls announcements and shoutouts
- Uses new pub/sub clip queue system
- Better separation of concerns (promo for data, handler for actions)

### Old JS (promo.js):
- Managed clip queue directly with rpush
- Sent messages directly
- Used user functions that don't exist in JS

### New TypeScript:
- Delegates queue management to existing clip functions
- Returns data, caller handles messaging
- Uses properly migrated TypeScript functions

---

## Error Handling

All functions follow the established pattern:
```typescript
try {
    // implementation
} catch (error) {
    console.error(`Error in functionName:`, {
        // context params
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
    });

    return {
        error: true,
        message: 'Internal server error',
        type: 'error'
    };
}
```

---

## Testing Strategy

1. Build after each phase to catch TypeScript errors early
2. Verify function exports in index files
3. Check that raid event data interface matches Twitch EventSub schema
4. Test with sample raid event data

---

## Notes

- modID='698614112' is used consistently across the codebase for bot moderator ID
- Clip queue system uses pub/sub (see AGENTS.md "Clip Queue System" section)
- Promo command doesn't send messages directly - raid handler sends announcements and shoutouts
- Promo command checks clip connection but doesn't manage queue directly (showClip handles it)
- All cache keys use `twitch:` prefix for Twitch-related data
