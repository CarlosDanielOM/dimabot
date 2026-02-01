# Plan: Migrate WebSocket to TypeScript with Pub/Sub Clip Queue System

## Overview
Migrate the old JavaScript WebSocket implementation to TypeScript, replacing the HTTP POST-based clip system with the new pub/sub queue architecture. This includes implementing clip download, OBS communication, timeout handling, and retry logic.

## Architecture Changes

### Old System (JavaScript)
- **Queue**: List-based (`${channelID}:clips:queue` with streamer names)
- **Communication**: HTTP POST endpoint (`/clip/:channelID`)
- **Processing**: `${channelID}:clip:playing` and `${channelID}:clip:connected`
- **Trigger**: Bot calls `promo()` command directly

### New System (TypeScript)
- **Queue**: Sorted set with random IDs (`twitch:{channelID}:clips:queue`)
- **Communication**: Pub/Sub (`twitch:{channelID}:clip:request`)
- **Processing**: `twitch:{channelID}:clip:processing` and `twitch:{channelID}:clips:connected`
- **Trigger**: Bot calls `showClip()` which publishes to pub/sub
- **Data Storage**: Separate data keys (`twitch:{channelID}:clips:queue:data:{clipID}`)

---

## Files to Create

### 1. `src/utils/video.ts`
**Purpose**: Video download and file management utilities (migrated from JS)

**Functions**:
```typescript
interface DownloadClipResult {
    error: boolean;
    message: string;
    filePath?: string;
}

export async function downloadClip(
    url: string,
    channelID: string,
    downloadDir: string
): Promise<DownloadClipResult>

export async function deleteOldClip(
    channelID: string,
    deleteDir: string
): Promise<void>

export async function checkIfClipExists(
    channelID: string,
    downloadDir: string
): Promise<boolean>
```

**Implementation Details**:
- Uses `twitch-dl` CLI tool (same as old system)
- Downloads at 480p quality: `twitch-dl download -q 480p -o "${downloadDir}/${channelID}-clip.mp4" "${url}"`
- 10-second timeout on download
- Promise-based implementation
- Error handling with detailed logging
- Download directory creation if doesn't exist

**Dependencies**:
- `fs` (Node.js filesystem)
- `exec` from `node:child_process`
- Consistent with existing logger pattern

**Path Constants**:
- Download path: `${process.cwd()}/server/routes/public/downloads` (same as old system)

---

### 2. `src/server/clip_queue_handler.ts`
**Purpose**: Handle pub/sub clip requests and manage queue processing

**Class**: `ClipQueueHandler`

**Methods**:
```typescript
class ClipQueueHandler {
    private cache: RedisClientType;
    private currentTimeouts: Map<string, NodeJS.Timeout>;
    private processingChannels: Set<string>;

    async init(): Promise<void>
    private async handleClipRequest(channelID: string, clipData: ClipRequestData): Promise<void>
    private async processNextClip(channelID: string): Promise<void>
    private async downloadAndSendToOBS(channelID: string, clipData: ClipRequestData): Promise<void>
    private cleanupOldQueueData(channelID: string): Promise<void>
    async startupCleanup(): Promise<void>
}
```

**Key Features**:

#### 1. Initialization
```typescript
async init(): Promise<void>
```
- Subscribes to `twitch:{channelID}:clip:request` for all active channels
- Initializes timeout tracking map
- Initializes processing channels set

#### 2. Clip Request Handler
```typescript
private async handleClipRequest(channelID: string, clipData: ClipRequestData): Promise<void>
```
**Flow**:
1. Verify clipID exists in queue (defensive)
   ```typescript
   let idExists = await this.cache.zRank(`twitch:${channelID}:clips:queue`, clipData.clipID);
   if (!idExists) {
       await this.cache.zAdd(`twitch:${channelID}:clips:queue`, {
           score: clipData.timestamp,
           value: clipData.clipID
       });
       await this.cache.set(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`, JSON.stringify(clipData));
   }
   ```

2. Check if currently processing
   ```typescript
   let isProcessing = await this.cache.exists(`twitch:${channelID}:clip:processing`);
   ```

3. If not processing, start this clip
   ```typescript
   if (!isProcessing) {
       await this.cache.set(`twitch:${channelID}:clip:processing`, "true");
       await this.downloadAndSendToOBS(channelID, clipData);
   }
   ```

#### 3. Process Next Clip
```typescript
private async processNextClip(channelID: string): Promise<void>
```
**Flow**:
1. Get next clip ID from queue
   ```typescript
   let nextID = await this.cache.zPopMin(`twitch:${channelID}:clips:queue`);
   ```

2. If next clip exists:
   ```typescript
   if (nextID) {
       let nextData = await this.cache.get(`twitch:${channelID}:clips:queue:data:${nextID}`);
       let clipData = JSON.parse(nextData);

       await this.cache.set(`twitch:${channelID}:clip:processing`, "true");
       await this.downloadAndSendToOBS(channelID, clipData);
   }
   ```

#### 4. Download and Send to OBS
```typescript
private async downloadAndSendToOBS(channelID: string, clipData: ClipRequestData): Promise<void>
```
**Flow**:
1. Read timeout setting from cache
   ```typescript
   let timeoutSeconds = await this.cache.get(`twitch:${channelID}:clips:timeouts:default`) || "60";
   let timeout = parseInt(timeoutSeconds) + 5; // Add 5s buffer
   ```

2. Setup timeout timer
   ```typescript
   let timeoutId = setTimeout(async () => {
       console.error(`Clip timeout for ${channelID}, clipID: ${clipData.clipID}`);
       await this.cache.del(`twitch:${channelID}:clip:processing`);
       await this.cache.del(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`);
       await this.processNextClip(channelID);
   }, timeout * 1000);

   this.currentTimeouts.set(`${channelID}:${clipData.clipID}`, timeoutId);
   ```

3. Download clip
   ```typescript
   const downloadDir = `${process.cwd()}/server/routes/public/downloads`;
   const downloadResult = await downloadClip(clipData.clipUrl, channelID, downloadDir);

   if (downloadResult.error) {
       clearTimeout(timeoutId);
       this.currentTimeouts.delete(`${channelID}:${clipData.clipID}`);
       await this.cache.del(`twitch:${channelID}:clip:processing`);
       await this.cache.del(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`);
       await this.processNextClip(channelID);
       return;
   }
   ```

4. Send to OBS via WebSocket
   ```typescript
   const io = getIO();
   const clipPayload = {
       clipID: clipData.clipID,
       clipUrl: clipData.clipUrl,
       duration: clipData.duration,
       title: clipData.title,
       game: clipData.game,
       streamer: clipData.streamer,
       streamerLogin: clipData.streamerLogin,
       profileImage: clipData.profileImage,
       description: clipData.description,
       streamerColor: clipData.streamerColor
   };

   io.of(`/clip/${channelID}`).emit('play-clip', clipPayload);
   ```

#### 5. Cleanup Old Queue Data
```typescript
private cleanupOldQueueData(channelID: string): Promise<void>
```
- Deletes old data keys (>24 hours)
- Prevents memory buildup
- Called on startup and periodically

#### 6. Startup Cleanup
```typescript
async startupCleanup(): Promise<void>
```
**Flow**:
1. Get all active channels (from TwitchStreamers or cache)
2. For each channel:
   ```typescript
   // Delete stuck processing flags
   await this.cache.del(`twitch:${channelID}:clip:processing`);

   // Delete old data keys
   let keys = await this.cache.keys(`twitch:${channelID}:clips:queue:data:*`);
   for (let key of keys) {
       let ttl = await this.cache.ttl(key);
       if (ttl === -1 || ttl > 86400) { // No expiry or >24h
           await this.cache.del(key);
       }
   }
   ```

**Edge Cases Handled**:
- Duplicate clip IDs in queue
- Timeout on download
- OBS disconnected during processing
- Server crash (cleanup on startup)
- Clip added twice by bot

---

### 3. Update `src/server/websocket.ts`
**Purpose**: Add clip namespace with OBS connection tracking and clip-ended handling

**Add after line 114 (TODO comment)**:

```typescript
//? Clip Namespace
io.of(/^\/clip\/\w+$/).on('connection', async (socket) => {
    const cacheClient = await getDragonflyClient('Websocket');
    const channelID = socket.nsp.name.split('/')[2];

    // Validate channel
    const account = await TwitchStreamers.getTwitchAccountById(channelID);
    if(!account) {
        socket.emit('error', {
            message: 'Account not found',
            status: 404
        });
        return;
    }

    // Cleanup old keys
    try {
        await cacheClient.del(`twitch:${channelID}:clip:processing`);
    } catch (error) {
        console.error(`Error deleting old processing flag for ${channelID}:`, error);
    }

    // Set connection flag
    await cacheClient.set(`twitch:${channelID}:clips:connected`, "true");
    console.log(`${channelID} (${account.name}) connected to clip`);

    // Handle clip-ended event from OBS
    socket.on('clip-ended', async () => {
        console.log(`Clip ended for channel ${channelID}`);

        // Clear processing flag
        await cacheClient.del(`twitch:${channelID}:clip:processing`);

        // Process next clip in queue
        await clipQueueHandler.processNextClip(channelID);
    });

    // Handle disconnect with 5s delay
    let disconnectTimeout: NodeJS.Timeout;
    socket.on('disconnect', () => {
        console.log(`${channelID} (${account.name}) disconnected from clip`);

        // Wait 5s for reconnect before deleting
        disconnectTimeout = setTimeout(async () => {
            await cacheClient.del(`twitch:${channelID}:clips:connected`);
            await cacheClient.del(`twitch:${channelID}:clips:timeouts:default`);
            console.log(`${channelID} OBS connection fully removed`);
        }, 5000);
    });

    // Clear disconnect timeout if reconnected
    socket.on('connect', () => {
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
        }
    });

    // Optional: Read timeout from query param
    const urlParams = new URLSearchParams(socket.handshake.query as string);
    const timeoutParam = urlParams.get('timeout');
    if (timeoutParam && !isNaN(parseInt(timeoutParam))) {
        await cacheClient.set(`twitch:${channelID}:clips:timeouts:default`, timeoutParam);
    }
});
```

**Key Features**:
- Sets `twitch:{channelID}:clips:connected` flag on connect
- Deletes processing flag on connect (cleanup)
- Handles `clip-ended` event from OBS
- 5-second delay on disconnect before removing connection flag
- Reads timeout from query parameter
- Clears old timeout on reconnect

**Socket Events**:
- `clip-ended` - Sent by OBS when clip playback finishes
- `play-clip` - Sent to OBS to play clip (from clip queue handler)
- `disconnect` - OBS disconnects
- `connect` - OBS reconnects (clears disconnect timeout)

---

### 4. Update `src/server/index.ts`
**Purpose**: Initialize clip queue handler on server startup

**Add to initialization**:
```typescript
import { clipQueueHandler } from './clip_queue_handler.js';

// ... existing code ...

async function startServer() {
    // ... existing initialization ...

    // Initialize clip queue handler
    await clipQueueHandler.init();

    // Run startup cleanup
    await clipQueueHandler.startupCleanup();

    // ... start server ...
}
```

---

## Cache Keys Used

| Purpose | Key | Type | TTL | Owner |
|----------|------|------|--------|
| Processing flag | `twitch:{channelID}:clip:processing` | String | None | Server |
| Connected flag | `twitch:{channelID}:clips:connected` | String | None | Server |
| Queue (IDs) | `twitch:{channelID}:clips:queue` | Sorted Set | None | Bot/Server |
| Clip data | `twitch:{channelID}:clips:queue:data:{clipID}` | String | None | Bot/Server |
| Timeout setting | `twitch:{channelID}:clips:timeouts:default` | String | None | Server |

---

## Communication Flow

### Normal Flow:
```
1. Bot calls promo() → showClip() → requestClip()
   - Adds clip to sorted set
   - Stores full data
   - Publishes to pub/sub

2. Server receives pub/sub message
   - Verifies ID in queue
   - Checks if processing
   - Starts download if not processing

3. Server downloads clip
   - Uses twitch-dl CLI
   - 10s timeout
   - Sets processing flag

4. Server sends to OBS
   - Emits 'play-clip' event via WebSocket
   - OBS receives and plays clip

5. OBS finishes playback
   - Sends 'clip-ended' event
   - Server clears processing flag
   - Server processes next clip in queue
```

### Retry/Timeout Flow:
```
1. Download times out (10s)
   - Clear timeout timer
   - Delete processing flag
   - Delete data key
   - Process next clip

2. OBS playback times out (from setting)
   - Timeout timer fires
   - Delete processing flag
   - Delete data key
   - Process next clip
```

### Connection Flow:
```
1. OBS connects
   - Set `twitch:{channelID}:clips:connected` = "true"
   - Delete old processing flag
   - Read timeout from query param

2. OBS disconnects
   - Start 5s timer
   - If reconnect: clear timer
   - If timeout: delete connection flag

3. Bot checks connection before queuing
   - Check `twitch:{channelID}:clips:connected`
   - If not exists: skip queuing
```

---

## Error Handling

All errors follow the established pattern:

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

    // cleanup if needed
    // return/error throw appropriately
}
```

---

## Implementation Order

### Phase 1: Video Utilities
1. Create `src/utils/video.ts`
2. Implement downloadClip, deleteOldClip, checkIfClipExists
3. Run `npm run build` to verify

### Phase 2: Clip Queue Handler
4. Create `src/server/clip_queue_handler.ts`
5. Implement ClipQueueHandler class
6. Run `npm run build` to verify

### Phase 3: WebSocket Integration
7. Update `src/server/websocket.ts` to add clip namespace
8. Import clipQueueHandler
9. Run `npm run build` to verify

### Phase 4: Server Initialization
10. Update `src/server/index.ts` to initialize clip queue handler
11. Run startup cleanup on init
12. Run `npm run build` for final verification

### Phase 5: Testing
13. Test OBS connection/disconnection
14. Test clip queue processing
15. Test timeout handling
16. Test retry logic

---

## Notes

- **Download Quality**: 480p (same as old system)
- **Download Tool**: `twitch-dl` CLI (same as old system)
- **Timeout Defaults**: 60s for playback, 10s for download
- **Delay on Disconnect**: 5 seconds before removing connection flag
- **Cleanup Interval**: On startup, delete keys >24h old
- **Queue Persistence**: Survives OBS reconnections (only empties when channel goes offline)
- **Retry Logic**: Automatic on timeout or error
- **Duplicate Handling**: Server verifies ID in queue before processing

---

## Dependencies

- `fs` - File system operations
- `node:child_process` - Exec for twitch-dl
- `socket.io` - WebSocket communication
- `redis` (Dragonfly) - Queue and cache management
- `pubSubManager` - Pub/sub communication
- `TwitchStreamers` - Channel validation
- `getDragonflyClient` - Database client
