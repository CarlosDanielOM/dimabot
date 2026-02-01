# Plan: Migrate clip functions to TypeScript with Pub/Sub Queue System

## Architecture Overview

**Components:**
- **Bot**: Queues clip requests, generates random IDs, publishes clip data via pub/sub
- **Server**: Subscribes to clip requests, manages queue, controls OBS playback, handles timeouts
- **OBS**: Displays clips, sends "ended" message when done via WebSocket

**Communication Flow:**
```
Bot → PubSub (twitch:channelID:clip:request) → Server → WebSocket → OBS
OBS → WebSocket (ended message) → Server → Cleanup → Process next in queue
```

## Key Design Decisions

### 1. Random ID Format
- **Base 16**: Hexadecimal string (0-F)
- **Length**: 6-8 characters (16M - 4.3B unique combinations)
- **Example**: `"3A7F9B"`, `"C2D8E4F"`

### 2. Queue Duplicate Prevention
- Bot adds ID to sorted set when queuing
- Server verifies if ID exists when receiving request
- Server also adds to sorted set (defensive, handles edge cases)

### 3. Data Key Expiration
- **No TTL on data keys** during normal processing
- **Cleanup happens**: When clip ends or processing fails
- **Stuck clip protection**: Server checks on startup and cleans old data keys (>24 hours)

### 4. Bot's vs Server's ZADD
- **Both do ZADD** (defensive programming)
- Bot adds when publishing
- Server adds when receiving (verifies queue state)
- If duplicate exists, ZADD fails gracefully

### 5. Connection Handling
- Bot checks `twitch:channelID:clips:connected` before queuing
- If not connected: Skip entire showClip process
- If disconnected during processing: Continue current clip, don't start new ones
- Queue persists across reconnections

### 6. Multiple Streamers in Queue
- Queue can contain: `["streamer1", "streamer2", "streamer3"]`
- Each has their own data key: `twitch:channelID:clips:queue:data:{clipID}`
- When OBS ends: Server retrieves next streamer's data, sends to OBS

### 7. Error Handling
- On error: Server deletes processing flag, deletes data key
- Server processes next clip in queue automatically
- Bot doesn't need to know about errors (server handles everything)

### 8. Token Usage
- **createClip**: Bot token (required by Twitch API)
- **getClip**: App token (read-only operation)
- **getChannelClips**: App token (read-only operation)

## Implementation Phases

### Phase 1: Migrate PubSub Manager

**File:** `src/classes/pubsub_manager.class.ts`

**Functions:**
```typescript
class PubSubManager {
    publisher: RedisClientType | null
    subscriber: RedisClientType | null
    subscriptions: Map<string, Function>

    async init()
    async publish(channel: string, data: object)
    async subscribe(channel: string, handler: Function)
    async unsubscribe(channel: string)
    handleMessage(channel: string, message: string)

    // Clip-specific convenience methods
    async publishClipRequest(channelID: string, clipData: ClipRequestData)
    async subscribeToClipRequests(channelID: string, handler: Function)
}
```

**ClipRequestData interface:**
```typescript
interface ClipRequestData {
    clipID: string;              // Random base16 ID
    streamerLogin: string;         // Streamer's login name
    duration: number;              // Clip duration
    clipUrl: string;              // Clip URL
    title: string;                 // Stream title
    game: string;                  // Game name
    streamer: string;              // Streamer display name
    profileImage: string;           // Streamer profile image URL
    description: string;            // Streamer description
    streamerColor: string;         // Streamer chat color
    timestamp: number;              // Request timestamp
}
```

### Phase 2: Migrate Basic Clip Functions

**File:** `src/functions/clips/create.clip.ts`

**Function:** `createClip(channelID: string)`
- Uses **bot token** (Twitch requirement)
- POST to `/clips` endpoint
- Returns clip ID or error

**File:** `src/functions/clips/get_clip.clip.ts`

**Function:** `getClip(clipID: string)`
- Uses **app token** (read-only)
- Returns clip data or error

**File:** `src/functions/clips/get_clips.clip.ts`

**Function:** `getChannelClips(channelID: string, amount: number | null, skip_cache: boolean = false)`
- Uses **app token** (read-only)
- Cache key: `twitch:channelID:clips` (update from old pattern)
- Cache expiration: 3 hours
- Update `saveToCache` → `skip_cache`

### Phase 3: Create Queue Management

**File:** `src/functions/clips/queue.clip.ts`

**Functions:**

#### `generateRandomClipID()`
- Returns 6-8 character hex string (base 16)
- Example: `"3A7F9B"`, `"C2D8E4F"`

#### `requestClip(channelID: string, streamerLogin: string, clipData: ClipRequestData, autoProcess: boolean = false)`
- Checks `twitch:channelID:clips:connected` (skip if not exists)
- Generates random clip ID
- Adds data to Redis: `twitch:channelID:clips:queue:data:{clipID}`
- Adds ID to sorted set: `twitch:channelID:clips:queue` (score = timestamp)
- If `autoProcess=true`: Publishes to `twitch:channelID:clip:request`
- Returns: `{error, message, clipID}`

#### `checkClipConnection(channelID: string)`
- Checks if `twitch:channelID:clips:connected` exists
- Returns: `{connected: boolean}`

### Phase 4: Refactor Show Clip Function

**File:** `src/functions/clips/show_clip.clip.ts`

**Function:** `showClip(channelID: string, clipData: any[], streamerData: any, streamerChannelData: any, sendToQueue: boolean = false)`

**Logic:**
1. Validates parameters (clipData, streamerData, streamerChannelData)
2. Gets streamer color via `getUserColor()`
3. Selects random clip from array
4. Gets game info via `searchGameById()`
5. Checks if `twitch:channelID:clips:connected` exists
6. If no: Skip entirely, return early
7. If yes:
   - Generates random clip ID
   - Prepares ClipRequestData object with all info
   - If `sendToQueue=true`: Calls `requestClip()` with `autoProcess=true`
   - If `sendToQueue=false`: Calls `requestClip()` with `autoProcess=false`

**Changes from original:**
- Remove `retryClip` (server now handles queue)
- Remove HTTP POST to server
- Return early if not connected (save resources)
- Use `requestClip` to handle queue and pub/sub

### Phase 5: Create Index File

**File:** `src/functions/clips/index.ts`

```typescript
export { createClip } from './create.clip.js';
export { getClip } from './get_clip.clip.js';
export { getChannelClips } from './get_clips.clip.js';
export { showClip } from './show_clip.clip.js';
export { requestClip, checkClipConnection, generateRandomClipID } from './queue.clip.js';
```

### Phase 6: Update Promo Command

**File:** `src/handlers/commands.handler.ts` (wherever promo logic lives)

**Changes:**
- Import TypeScript functions from `src/functions/clips/`
- Import `checkClipConnection` to skip if not connected
- Remove old `function/clip` references
- Use new `showClip` with `sendToQueue` parameter

**Flow:**
```typescript
if(!sendClip) {
    // Just queue it
    const result = await requestClip(channelID, streamerLogin, clipData, false);
    // Return result
} else {
    // Queue and process
    await showClip(channelID, clips.data, streamerData.data, broadcasterData.data, true);
}
```

## Redis Keys Structure

### Queue System Keys

| Purpose | Key | Type | TTL |
|----------|------|------|-----|
| Clip data cache | `twitch:channelID:clips` | String | 3 hours |
| Clip queue (IDs only) | `twitch:channelID:clips:queue` | Sorted Set | None |
| Clip data (by ID) | `twitch:channelID:clips:queue:data:{clipID}` | String | None (cleared on process) |
| Processing flag | `twitch:channelID:clip:processing` | String | None |
| Connected flag | `twitch:channelID:clips:connected` | String | 5s (deleted on disconnect) |
| Timeout setting | `twitch:channelID:clips:timeouts:default` | String | None (server-side only) |
| Request channel | `twitch:channelID:clip:request` | Pub/Sub | N/A |

### Data Key Lifecycle

**Creation:**
```typescript
// Bot creates
let clipID = generateRandomClipID(); // "3A7F9B"
let data = { /* full clip info */ };
await redis.set(`twitch:${channelID}:clips:queue:data:${clipID}`, JSON.stringify(data));
await redis.zadd(`twitch:${channelID}:clips:queue`, timestamp, clipID);
await pubsub.publish(`twitch:${channelID}:clip:request`, data);
```

**Processing (Server):**
```typescript
// Server receives, verifies
let exists = await redis.zrank(`twitch:${channelID}:clips:queue`, clipID);
if (!exists) {
    await redis.zadd(`twitch:${channelID}:clips:queue`, data.timestamp, clipID);
    await redis.set(`twitch:${channelID}:clips:queue:data:${clipID}`, JSON.stringify(data));
}

// Get next if not processing
if (!await redis.exists(`twitch:${channelID}:clip:processing`)) {
    let nextID = await redis.zpopmin(`twitch:${channelID}:clips:queue`);
    let nextData = await redis.get(`twitch:${channelID}:clips:queue:data:${nextID}`);
    nextData = JSON.parse(nextData);

    await redis.set(`twitch:${channelID}:clip:processing`, "true");
    // Send to OBS via WebSocket
}
```

**Completion (Server):**
```typescript
// OBS sends "ended" or timeout
await redis.del(`twitch:${channelID}:clip:processing`);
await redis.del(`twitch:${channelID}:clips:queue:data:${clipID}`);

// Process next
processNextClip(channelID);
```

## Server-Side Requirements (For You)

### What Server Must Do:

1. **Subscribe to pub/sub:**
```typescript
pubsub.subscribe(`twitch:${channelID}:clip:request`, async (data) => {
    // data has everything already
    // { clipID, streamerLogin, duration, clipUrl, title, game, ... }
});
```

2. **Queue Processor:**
```typescript
pubsub.subscribe(`twitch:${channelID}:clip:request`, async (clipData) => {
    // 1. Verify ID in queue (defensive)
    let idExists = await redis.zrank(`twitch:${channelID}:clips:queue`, clipData.clipID);
    if (!idExists) {
        await redis.zadd(`twitch:${channelID}:clips:queue`, clipData.timestamp, clipData.clipID);
        await redis.set(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`, JSON.stringify(clipData));
    }

    // 2. Check if currently processing
    let isProcessing = await redis.exists(`twitch:${channelID}:clip:processing`);

    // 3. If not processing, start this one
    if (!isProcessing) {
        await redis.set(`twitch:${channelID}:clip:processing`, "true");
        // Download clip, send to OBS via WebSocket
        await downloadAndSendToOBS(channelID, clipData);
    }
    // 4. If processing, leave it in queue for later
});
```

3. **OBS Integration:**
```typescript
async function downloadAndSendToOBS(channelID: string, clipData: ClipRequestData) {
    // Download clip to local storage (like old code)
    let clipPath = await downloadClip(clipData.clipUrl, channelID, DOWNLOADPATH);

    // Send to OBS via WebSocket
    io.of(`/clip/${channelID}`).emit('play-clip', clipData);

    // Wait for "ended" message or timeout
    // Timeout = (twitch:channelID:clips:timeouts:default) + 5s buffer
}
```

4. **WebSocket "Ended" Handler:**
```typescript
websocket.on('ended', async () => {
    // 1. Cleanup
    await redis.del(`twitch:${channelID}:clip:processing`);
    await redis.del(`twitch:${channelID}:clips:queue:data:${currentClipID}`);

    // 2. Get next from queue
    let nextID = await redis.zpopmin(`twitch:${channelID}:clips:queue`);

    if (nextID) {
        // 3. Retrieve full data
        let nextData = await redis.get(`twitch:${channelID}:clips:queue:data:${nextID}`);
        nextData = JSON.parse(nextData);

        // 4. Process next
        await redis.set(`twitch:${channelID}:clip:processing`, "true");
        await downloadAndSendToOBS(channelID, nextData);
    }
});
```

5. **Timeout Handler:**
```typescript
async function processClip(channelID: string, clipData: ClipRequestData) {
    await redis.set(`twitch:${channelID}:clip:processing`, "true");

    let timeoutSeconds = await redis.get(`twitch:${channelID}:clips:timeouts:default`) || 60;
    timeoutSeconds += 5; // Add 5s buffer

    let timeoutId = setTimeout(async () => {
        // Timeout! Something went wrong
        await redis.del(`twitch:${channelID}:clip:processing`);
        await redis.del(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`);

        // Process next
        processNextClip(channelID);
    }, timeoutSeconds * 1000);

    websocket.on('ended', () => {
        clearTimeout(timeoutId);
        // Normal cleanup...
    });
}
```

6. **Connection Tracking:**
```typescript
// When OBS connects
websocket.on('connect', async () => {
    await redis.set(`twitch:${channelID}:clips:connected`, "true");
    let timeoutParam = getTimeoutParamFromUrl(); // Get from query param
    await redis.set(`twitch:${channelID}:clips:timeouts:default`, timeoutParam);
});

// When OBS disconnects
websocket.on('disconnect', async () => {
    // Wait 5s for reconnect
    setTimeout(async () => {
        await redis.del(`twitch:${channelID}:clips:connected`);
        await redis.del(`twitch:${channelID}:clips:timeouts:default`);
    }, 5000);
});
```

7. **Startup Cleanup (On Server Start):**
```typescript
async function cleanupStuckClips() {
    let allChannels = /* get active channels */;

    for (let channelID of allChannels) {
        // Delete stuck processing flags
        await redis.del(`twitch:${channelID}:clip:processing`);

        // Delete old data keys (>24 hours)
        let keys = await redis.keys(`twitch:${channelID}:clips:queue:data:*`);
        for (let key of keys) {
            let ttl = await redis.ttl(key);
            if (ttl === -1 || ttl > 86400) { // -1 = no expiry, >24h
                await redis.del(key);
            }
        }
    }
}
```

## Edge Cases

### 1. Clip Added Twice
- Bot and server both add to sorted set
- Second `ZADD` fails gracefully (already exists)
- Data keys: Both write, no conflict (same key)

### 2. OBS Disconnects During Playback
- Current clip continues to finish
- Processing flag set, queue items remain
- After timeout, server cleans up and processes next
- Reconnection: Server resumes queue processing

### 3. Server Crash/Restart
- Processing flags persist
- Data keys persist (>24h cleanup on startup)
- On restart: Cleanup script removes stuck flags
- Queue remains intact (sorted set)

### 4. Bot Publishes to Disconnected Channel
- Bot checks `twitch:channelID:clips:connected`
- If not exists: Skips entire showClip process
- Saves resources, doesn't fill disconnected queue

### 5. Random ID Collision
- Base 16, 6-8 chars = ~16M unique values
- Probability of collision: Extremely low
- If collision: Same streamer's data gets overwritten (acceptable)

## Implementation Steps

1. ✅ Migrate PubSub Manager (`src/classes/pubsub_manager.class.ts`)
2. ✅ Migrate basic clip functions (`create.clip.ts`, `get_clip.clip.ts`, `get_clips.clip.ts`)
3. ✅ Create queue management (`queue.clip.ts` with ID generation, connection checking)
4. ✅ Refactor show clip function (`show_clip.clip.ts` with pub/sub, early exit)
5. ✅ Create index file (`index.ts`)
6. ✅ Build verification (`npm run build`)
7. ✅ Commit changes
8. ⚠️ Server-side implementation (you'll handle separately)

## File Structure After Migration

```
src/
├── classes/
│   └── pubsub_manager.class.ts (NEW)
├── functions/
│   └── clips/
│       ├── create.clip.ts
│       ├── get_clip.clip.ts
│       ├── get_clips.clip.ts
│       ├── show_clip.clip.ts
│       ├── queue.clip.ts (NEW)
│       └── index.ts
```

## Migration Scope

**TO MIGRATE (TypeScript in src/):**
1. `create.js` → `src/functions/clips/create.clip.ts` (bot token)
2. `getclip.js` → `src/functions/clips/get_clip.clip.ts` (app token)
3. `getclips.js` → `src/functions/clips/get_clips.clip.ts` (app token, cache update)
4. `showclip.js` → `src/functions/clips/show_clip.clip.ts` (remove retryClip, remove promo import, use pub/sub)
5. `class/pubsub.js` → `src/classes/pubsub_manager.class.ts` (new, TypeScript version)
6. NEW: `src/functions/clips/queue.clip.ts` (queue management, connection checking)

**NOT TO TOUCH (will be handled separately):**
- `command/promo.js` - Old command file, will be updated separately when ready
- `src-js/server/websocket.js` - Old WebSocket server code, independent migration

## Summary

**Bot Responsibilities (After Migration):**
- Generate random clip IDs (base 16, 6-8 chars)
- Check if OBS connected before queuing
- Publish full clip data to pub/sub
- Manage queue (add IDs to sorted set)
- Skip processing if not connected
- **NOT call promo** (new pub/sub system replaces command-based approach)

**Server Responsibilities (You'll Implement Separately):**
- Subscribe to clip requests from pub/sub
- Save clip data to Redis (by ID)
- Manage processing state (single clip at a time)
- Download clips, send to OBS via WebSocket
- Handle timeouts and OBS "ended" messages
- Manage connection tracking (set/delete `clips:connected` and timeouts)
- Startup cleanup of stuck clips
- Replace old HTTP POST endpoint with pub/sub listener

**Communication:**
- Pub/Sub replaces HTTP POST to `/clips/channelID/show`
- Single message contains all clip data
- Server owns queue processing logic
- Bot is just a messenger with data

**Architecture Changes:**
```
OLD: Bot → HTTP POST → Server → Queue → WebSocket → OBS
NEW: Bot → PubSub (twitch:channelID:clip:request) → Server → WebSocket → OBS
```

This architecture is clean, scalable, and separates concerns nicely!
