# AI Agent Safety Guidelines

## Project Structure

### TypeScript Project (Complete)
- **Location:** `src/`
- **Status:** Fully migrated from JavaScript
- **Language:** TypeScript
- **Migration Status:** ✅ Bot side complete, now working on server side

### Server-Side Migration
- **Location:** `src/server/`
- **Files:** WebSocket and HTTP route files only
- **Public HTML:** Already migrated to `src/server/routes/public/`
- **Functions/Utils/Classes:** All migrated to TypeScript

### Legacy JavaScript Project
- **Location:** `src-js/`
- **Status:** Legacy code being replaced (read-only)
- **Language:** JavaScript
- **Note:** Do not modify unless explicitly requested

---

## Database & Cache Rules (CRITICAL)

### ✅ ALLOWED
- **READ operations only**
  - Query MongoDB for data retrieval
  - Read from DragonFlyDB/Redis cache
  - Inspect cache keys and values
  - Analyze database schemas

### ❌ FORBIDDEN
- **WRITE operations to databases**
  - NO modifying MongoDB documents without explicit permission
  - NO deleting database collections
  - NO schema changes without approval

- **WRITE operations to cache**
  - NO flushing cache (FLUSHALL, FLUSHDB)
  - NO deleting cache keys without explicit permission
  - NO invalidating cache without user confirmation
  - NO clearing specific key patterns without approval

- **Installing packages or software**
  - NO installing npm packages without explicit permission
  - NO installing system packages without explicit permission
  - NO running any install commands without user confirmation

- **Modifying OS or system**
  - NO modifying system files or configurations without explicit permission
  - NO changing system settings or environment variables without permission
  - Reading system information is allowed for investigation purposes

---

## Required Actions

### Before Any Database/Cache Modification

1. **STOP** - Do not proceed
2. **ASK** - Request explicit permission from user
3. **EXPLAIN** - Describe exactly what will be modified
4. **WAIT** - Only proceed after user confirms

**Never assume permission. Always ask first.**

---

## Example Scenarios

### ✅ CORRECT
```
User: "Delete all expired cache keys"
Agent: "I found 124 expired cache keys. Should I delete them? 
        This will affect user sessions and command cooldowns.
        Please confirm before I proceed."
User: "Yes, delete them"
Agent: [Proceeds with deletion]
```

### ❌ WRONG
```
User: "My cache is acting up"
Agent: [Runs FLUSHALL command]
User: "YOU JUST DELETED MY DATA!"
```

---

## Code Modifications

### TypeScript (src/)
- Safe to modify, test, and build
- **Bot side:** Fully migrated ✅
- **Functions/Utils/Classes:** Fully migrated ✅
- **Server side:** Currently in progress
- Use proper TypeScript types
- Follow existing patterns in `src/classes/`, `src/handlers/`, etc.

### JavaScript (src-js/)
- Read only
- Legacy code being replaced by TypeScript versions in `src/server/`
- May be deleted after server-side migration is complete

---

## Migration Conventions

### File Naming Convention

**Bot Functions:**
- **Pattern:** `what_the_file_is.parent_folder.ts`
- **Examples:**
  - `add_vip.channel.ts` (for VIP management)
  - `get_editors.channel.ts` (for channel editors)
  - `send_message.chat.ts` (for chat messages)

**Server Routes:**
- **Pattern:** `resource.route.ts` (singular)
- **Examples:**
  - `admin.route.ts` (for admin CRUD operations)
  - `reward.route.ts` (for reward management)
  - `user.route.ts` (for user operations)

### Dependency Mapping

When migrating from JavaScript to TypeScript:

| Old Dependency | New Dependency | Location |
|---------------|----------------|----------|
| `getStreamerHeaderById()` | `getTwitchStreamerHeaderById()` | `src/utils/header.ts` |
| `getBotHeader()` | `getTwitchAppHeader()` | `src/utils/header.ts` |
| `getTwitchHelixUrl()` | `getTwitchHelixUrl()` | `src/utils/links.ts` |
| `getClient()` | `getDragonflyClient()` | `src/utils/databases/dragonfly.database.ts` |
| `STREAMERS.getStreamerById()` | `TwitchStreamers.getTwitchAccountById()` | `src/classes/twitch_streamers.class.ts` |
| `STREAMERS.getStreamerIds()` | `TwitchStreamers.getTwitchStreamers()` | `src/classes/twitch_streamers.class.ts` |
| `getAppToken()` | `getAppToken()` | `src/utils/tokens.ts` |

### Code Style Guidelines

1. **Named Exports** - Always use named exports for functions
2. **TypeScript Interfaces** - Define interfaces for function parameters and return types
3. **Error Handling** - Follow the pattern: `{ error: boolean, message: string, ... }`
4. **Cache Operations** - Use `getDragonflyClient()` from dragonfly.database.ts
5. **Response Format** - Maintain consistent response structure with old functions

### Error Handling and Logging

**User-Facing Errors:**
- Return clear, user-friendly error messages in response objects
- Use `message` field for errors that users should see
- Keep error messages concise and actionable

**Developer-Facing Logging:**
- Always log detailed error information using `console.error()`
- Include context: function name, parameters, error object, stack trace
- Log the full error object for debugging purposes

**Example Pattern:**

```typescript
export async function exampleFunction(param: string): Promise<Response> {
    try {
        // implementation
    } catch (error) {
        console.error(`Error in exampleFunction:`, {
            param,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Failed to complete operation'
        };
    }
}
```

**Guidelines:**
- User messages: Simple, non-technical, action-oriented
- Developer logs: Full context, error details, timestamps
- Always log before returning error responses
- Use structured logging (objects) when possible

### Example Migration Pattern

**Bot Function:**
```typescript
// Old JavaScript
async function addChannelVIP(channelID, userID) {
    let streamerHeader = await getStreamerHeaderById(channelID);
    // ... implementation
}

// New TypeScript
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface AddVipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function addChannelVIP(channelID: string, userID: string): Promise<AddVipResponse> {
    try {
        const streamerHeader = await getTwitchStreamerHeaderById(channelID);
        // ... implementation
    } catch (error) {
        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
```

**Server Route:**
```typescript
// Old JavaScript
const express = require('express');
const router = express.Router();
router.use(auth);

router.get('/:channelID', async (req, res) => {
    // ... implementation
});

module.exports = router;

// New TypeScript
import express, { type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';

const router = express.Router();

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        // ... implementation
    } catch (error) {
        console.error('Error in GET /:channelID:', {
            channelID: req.params.channelID,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const resourceNameRoute = router;
```

### Index File Updates

When creating new function files:
1. Update the corresponding `index.ts` file to export new functions
2. Use ES module syntax with `.js` extensions for imports
3. Maintain alphabetical or logical ordering

### Cache Key Naming Convention

When caching Twitch-related data, use the following pattern:

**Format:** `twitch:channelID:category[:subcategory]`

**Examples:**
- Channel editors: `twitch:channelID:editors`
- Moderators: `twitch:channelID:moderators`
- Moderator IDs: `twitch:channelID:moderators:ids`
- Moderator logins: `twitch:channelID:moderators:logins`
- Commands: `twitch:channelID:commands:cmd` (cmd is the command name)
- Polls: `twitch:channelID:polls`

**Key Points:**
- Always use `twitch:` prefix if its related to Twitch, if in doubt, ask
- Use broadcaster ID (numeric string), not login
- Use plural form for collections (moderators, editors, polls)
- Use hierarchical structure with `:` as separator (like folder structure)
- For nested data, add subcategories after the main category

### Server Routes Style

**File Structure:**
```typescript
import express, { type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
// other imports...

const router = express.Router();

// Define routes on router
router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    // Implementation
});

router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    // Implementation
});

// Export router
export const resourceNameRoute = router;
```

**Route Registration (in server.ts):**
```typescript
import { resourceNameRoute } from './routes/resource.route.js';

// Inside server() function:
app.use('/resource-path', resourceNameRoute);
```

**Key Points:**
- Use `express.Router()` instead of a function taking app as parameter
- Export router as a named export: `export const resourceNameRoute = router`
- In server.ts, mount with `app.use('/path', route)`
- Always use `.js` extensions for imports
- Apply `authMiddleware as any` to routes that require authentication
- Handle array params: `Array.isArray(param) ? param[0] : param`

**Error Handling Pattern:**
```typescript
router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        // Implementation
    } catch (error) {
        console.error('Error in GET /:channelID:', {
            channelID: req.params.channelID,
            query: req.query,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});
```

**Response Format:**
```typescript
res.status(200).json({
    error: false,
    message: 'Success message',
    status: 200,
    data: responseData
});
```

---

## Git Operations

### ✅ ALLOWED
- **Local commits** - Allowed when it seems necessary for progress tracking
  - Commits help track work locally
  - Should be made after completing tasks
  - Helps maintain git history of development

### ❌ FORBIDDEN
- **Pushing to remote**
  - NO pushing commits without explicit permission
  - NO force pushing without user confirmation
  - Wait for user to request push or ask permission first
  - Pushing affects remote repository state significantly

### Required Actions

### Before Pushing to Remote

1. **STOP** - Do not proceed with push
2. **ASK** - Request explicit permission from user
3. **EXPLAIN** - Describe what will be pushed
4. **WAIT** - Only proceed after user confirms

**Never assume permission to push. Always ask first.**

---

## Emergency Procedures

If accidental data loss occurs:

1. **IMMEDIATELY** stop all destructive operations
2. **REPORT** the issue clearly to the user
3. **DO NOT** attempt recovery without permission
4. **DOCUMENT** what happened for transparency

---

## Reminder

**READ-ONLY on data stores. WRITE ONLY with permission.**

---

## Lessons Learned for Future Agents

### Smart Token Refresh Pattern

When implementing token refresh systems:

1. **Expiration-Based Refresh**: Only refresh tokens when they're expired or close to expiring (5-minute buffer)
   - Store `expires_at` timestamp in cache
   - Check against current time before returning token
   - This prevents unnecessary API calls and improves performance

2. **URL Encoding**: Always URL-encode refresh tokens when making OAuth refresh calls
   ```typescript
   const params = new URLSearchParams({
       refresh_token: encodeURIComponent(refresh_token)  // Critical for special characters
   });
   ```

3. **Error Handling on Token Failure**: When refresh fails, completely invalidate both cache and DB:
   - Clear cache: set `access_token` and `refresh_token` to empty strings
   - Clear DB: set tokens to `{iv: null, content: null}`
   - Set permissions: set `has_permissions` and `up_to_date_permissions` to `false`
   - This prevents infinite retry loops

4. **Simplification Pattern**: Remove unnecessary parameters like `independent` flags
   - Make functions do one thing consistently
   - Always update both cache and DB when called

### Token Type Selection

When working with Twitch API, use the correct token type:

| Operation | Token Type | Function |
|-----------|-------------|-----------|
| Announcements/Shoutouts (bot actions) | Bot token | `getTwitchBotHeader()` |
| Channel moderation/management | Streamer token | `getTwitchStreamerHeaderById()` |
| Read-only operations (user info, search) | App token | `getTwitchAppHeader()` |

**Key**: Bot tokens are stored in DB like any user, but cached under `app:twitch:bot` key.

### TypeScript Build Issues and Fixes

1. **Header Type Casting**: TypeScript doesn't accept custom interfaces for fetch headers
   ```typescript
   // Don't do this (fails type check):
   headers: streamerHeader
   
   // Do this instead:
   headers: streamerHeader as unknown as Record<string, string>
   ```

2. **URLSearchParams toString()**: Always convert URLSearchParams to string before passing
   ```typescript
   // Don't do this:
   getTwitchHelixUrl('endpoint', params)
   
   // Do this instead:
   getTwitchHelixUrl('endpoint', params.toString())
   ```

3. **Nullable ID Fields**: When accessing ID fields from cache, handle undefined:
   ```typescript
   const raidResult = await ChannelFunctions.raid(channelID, raidUserData.id || '');
   // Use default fallback to prevent type errors
   ```

### Commands Handler Implementation Pattern

1. **Dot Notation**: Commands like `twitch.subs` are parsed as `twitch` + `subs` args
   ```typescript
   if (['twitch', 'set', 'start'].includes(commandName) && args.length > 0) {
       const subCommand = args[0];
       resolvedCommand = `${commandName}.${subCommand}`;
       resolvedArgs = args.slice(1);
   }
   ```

2. **Gradual Implementation**: When implementing commands, work in phases:
   - Phase 1: Implement functions and verify build passes
   - Phase 2: Wire functions into commands handler
   - Phase 3: Test each command individually
   - Phase 4: Commit after each phase

### Response Interface Consistency

All function responses should follow this structure:

```typescript
interface StandardResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}
```

**Note**: `message` is for user-facing messages (keep simple). Developer-facing logs go in `console.error()`.

### Testing Strategy

1. **Build Early, Build Often**: Run `npm run build` after each major change
   - Catch TypeScript errors immediately
   - Prevents cascading type errors
   - Makes debugging easier

2. **Commit in Logical Chunks**: Commit related changes together
   - One feature/function per commit
   - Clear, descriptive commit messages
   - Easier to review and revert if needed

### Deprecated Function Handling

When deprecating functions:
1. Add `@deprecated` JSDoc comment
2. Keep function available but clearly marked
3. Document what replaces it
4. Let user decide when to remove

Example:
```typescript
  /**
   * @deprecated This function is deprecated. Tokens are now refreshed automatically when needed.
   * Use getBotToken() or refreshTwitchToken() instead.
   */
  export const refreshAllTokens = async () => { ... }
  ```

### Clip Queue System (Pub/Sub Based)

**Architecture:**
- Bot uses pub/sub to send clip requests
- Server subscribes to clip requests, manages queue, controls OBS playback
- OBS displays clips, sends "ended" message when done via WebSocket

**Communication Flow:**
```
Bot → PubSub (twitch:channelID:clip:request) → Server → WebSocket → OBS
OBS → WebSocket (ended message) → Server → Cleanup → Process next in queue
```

**Redis Keys Structure:**

| Purpose | Key | Type | TTL | Owner |
|----------|------|------|--------|
| Clip data cache | `twitch:channelID:clips` | String | 3 hours | Bot |
| Clip queue (IDs only) | `twitch:channelID:clips:queue` | Sorted Set | None | Bot/Server |
| Clip data (by ID) | `twitch:channelID:clips:queue:data:{clipID}` | String | None | Bot/Server |
| Processing flag | `twitch:channelID:clip:processing` | String | None | Server |
| Connected flag | `twitch:channelID:clips:connected` | String | 5s (on disconnect) | Server |
| Timeout setting | `twitch:channelID:clips:timeouts:default` | String | None (deleted on disconnect) | Server |
| Request channel | `twitch:channelID:clip:request` | Pub/Sub | N/A | Bot |
| Completed channel | `twitch:channelID:clip:completed` | Pub/Sub | N/A | Server |

**Bot Side (TypeScript):**

**Functions:**
- `createClip(channelID)` - Create clip using bot token
- `getClip(clipID)` - Get specific clip using app token
- `getChannelClips(channelID, amount, skip_cache)` - Get all clips using app token
- `showClip(channelID, clipData, streamerData, streamerChannelData, sendToQueue)` - Queue and send clip
- `requestClip(channelID, streamerLogin, clipData, autoProcess)` - Add to queue
- `checkClipConnection(channelID)` - Check if OBS connected
- `generateRandomClipID()` - Generate base16 ID (6-8 chars)

**ShowClip Flow:**
1. Validate parameters (clipData, streamerData, streamerChannelData)
2. Get streamer color via `getUserColor()`
3. Select random clip from array
4. Get game info via `searchGameById()`
5. Check if `twitch:channelID:clips:connected` exists
6. If no: Skip entirely, return early
7. If yes:
   - Generate random clip ID (e.g., "3A7F9B")
   - Prepare ClipRequestData object with all info
   - If `sendToQueue=true`: Call `requestClip()` with `autoProcess=true`
   - If `sendToQueue=false`: Call `requestClip()` with `autoProcess=false`

**Queue Management:**
```typescript
// Add to queue
let clipID = generateRandomClipID(); // Base 16, 6-8 chars
await redis.set(`twitch:${channelID}:clips:queue:data:${clipID}`, JSON.stringify(fullData));
await redis.zadd(`twitch:${channelID}:clips:queue`, Date.now(), clipID);
await pubsub.publish(`twitch:${channelID}:clip:request`, fullData);
```

**Connection Check:**
- Before queuing: Check `twitch:channelID:clips:connected`
- If not exists: Skip showClip process entirely (save resources)
- Server sets this on OBS connect, deletes on disconnect (5s delay)

**Server Side (JavaScript/TypeScript - Future Migration):**

**WebSocket Namespaces:**
- `/clip/{channelID}` - Clip display and queue management
- `/speech/{channelID}` - Speech messages (NOT affected by clip migration)

**PubSub Listeners:**
```javascript
pubsub.subscribe(`twitch:${channelID}:clip:request`, async (data) => {
    // data has everything: { clipID, streamerLogin, duration, clipUrl, title, game, streamer, profileImage, description, streamerColor, timestamp }
    
    // 1. Verify ID in queue (defensive)
    let idExists = await redis.zrank(`twitch:${channelID}:clips:queue`, data.clipID);
    if (!idExists) {
        await redis.zadd(`twitch:${channelID}:clips:queue`, data.timestamp, data.clipID);
        await redis.set(`twitch:${channelID}:clips:queue:data:${data.clipID}`, JSON.stringify(data));
    }
    
    // 2. Check if currently processing
    let isProcessing = await redis.exists(`twitch:${channelID}:clip:processing`);
    
    // 3. If not processing, start this one
    if (!isProcessing) {
        await redis.set(`twitch:${channelID}:clip:processing`, "true");
        // Download clip, send to OBS via WebSocket
        await downloadAndSendToOBS(channelID, data);
    }
    // 4. If processing, leave it in queue (already there)
});
```

**OBS "Ended" Handler:**
```javascript
websocket.on('ended', async () => {
    // 1. Cleanup
    await redis.del(`twitch:${channelID}:clip:processing`);
    await redis.del(`twitch:${channelID}:clips:queue:data:${currentClipID}`);
    
    // 2. Get next from queue
    let nextID = await redis.zpopmin(`twitch:${channelID}:clips:queue`);
    
    // 3. Process next if exists
    if (nextID) {
        let nextData = await redis.get(`twitch:${channelID}:clips:queue:data:${nextID}`);
        nextData = JSON.parse(nextData);
        
        await redis.set(`twitch:${channelID}:clip:processing`, "true");
        await downloadAndSendToOBS(channelID, nextData);
    }
});
```

**Connection Tracking (Server):**
```javascript
// When OBS connects
websocket.on('connect', async () => {
    await redis.set(`twitch:${channelID}:clips:connected`, "true");
    // Get timeout from query param (e.g., ?timeout=13)
    let timeoutParam = getTimeoutParamFromUrl();
    await redis.set(`twitch:${channelID}:clips:timeouts:default`, timeoutParam);
});

// When OBS disconnects
websocket.on('disconnect', async () => {
    // Wait 5s for reconnect before deleting
    setTimeout(async () => {
        await redis.del(`twitch:${channelID}:clips:connected`);
        await redis.del(`twitch:${channelID}:clips:timeouts:default`);
    }, 5000);
});
```

**Timeout Handling (Server):**
```javascript
async function processClip(channelID, clipData) {
    await redis.set(`twitch:${channelID}:clip:processing`, "true");
    
    // Read timeout setting from Redis
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

**Startup Cleanup (Server):**
```javascript
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

**Random ID Format:**
- Base 16: Hexadecimal string (0-F)
- Length: 6-8 characters (~16M - 4.3B unique combinations)
- Example: `"3A7F9B"`, `"C2D8E4F"`
- Generated by bot when queuing clip

**Edge Cases:**

1. **Clip Added Twice:**
   - Bot adds ID to sorted set when queuing
   - Server verifies if ID exists when receiving request
   - Server also adds to sorted set (defensive, handles edge cases)

2. **OBS Disconnects During Playback:**
   - Current clip continues to finish (processing flag set)
   - No new clips start (connected flag deleted)
   - On reconnect, queue processing resumes

3. **Server Crash/Restart:**
   - Processing flags persist
   - Data keys persist (>24h cleanup on startup)
   - On restart, cleanup script removes stuck flags
   - Queue remains intact (sorted set)

4. **Bot Queues to Disconnected Channel:**
   - Bot checks `twitch:channelID:clips:connected`
   - If not exists: Skips entire showClip process
   - Saves resources, doesn't fill disconnected queue

5. **Random ID Collision:**
   - Base 16, 6-8 chars = ~16M unique values
   - Probability of collision: Extremely low
   - If collision: Same streamer's data gets overwritten (acceptable)

**Error Handling:**

- On error (timeout, download fail, etc.):
  - Server deletes processing flag
  - Server deletes data key
  - Server processes next clip automatically
  - Bot doesn't need to know (server handles everything)

**Multiple Streamers in Queue:**
- Queue can contain: `["streamer1", "streamer2", "streamer3"]`
- Each has their own data key: `twitch:channelID:clips:queue:data:{clipID}`
- When OBS ends: Server retrieves next streamer's data, sends to OBS
- Sequential processing guaranteed by sorted set timestamps

**Files Involved:**

**Bot Side (TypeScript):**
- `src/functions/clips/create.clip.ts`
- `src/functions/clips/get_clip.clip.ts`
- `src/functions/clips/get_clips.clip.ts`
- `src/functions/clips/show_clip.clip.ts`
- `src/functions/clips/queue.clip.ts`
- `src/classes/pubsub_manager.class.ts`

**Server Side (Current JS - Future TypeScript):**
- `src-js/server/websocket.js` (WebSocket namespaces: `/clip/{channelID}`, `/speech/{channelID}`)
- `src-js/server/routes/clip.routes.js` (HTTP POST endpoint - will be replaced by pub/sub)

**Important Notes:**

- Bot does NOT call `promo()` command in `showClip` - old command-based approach replaced by pub/sub
- `showClip` can operate in two modes: queue only (`sendToQueue=false`) or queue+process (`sendToQueue=true`)
- Connection flag is server-side only, bot just checks it
- Queue persists across OBS reconnections (only empties when streamer goes offline)
- Server owns queue processing logic completely
- Communication is one-way (Bot → Server via pub/sub), server handles everything else

**Architecture Changes:**
```
OLD: Bot → HTTP POST → Server → Queue → WebSocket → OBS
NEW: Bot → PubSub (twitch:channelID:clip:request) → Server → WebSocket → OBS
```

---

## Planning Guidelines

When creating implementation plans:

1. **Save Plan to File**: Always write the plan to a markdown file named `plan_plan_reason.md`
    - This allows viewing on the go with `cat planname.md`
    - Makes plans easily accessible from phone terminal

2. **Overwrite Protection**: If a plan file with the same name already exists:
    - STOP before overwriting
    - ASK the user for confirmation
    - EXPLAIN what will be replaced
    - WAIT for explicit permission before proceeding

**Never overwrite existing plan files without permission.**

## Clip Queue System Plan

**Architecture:** Bot uses pub/sub to send clip requests, server subscribes and manages queue, controls OBS playback

**Plan File:** `.opencode/plans/migrate_clip_functions_final.md`

**Scope:**
- Bot side: `src/functions/clips/` (create, get, getClips, showClip, queue)
- Server side: `src-js/server/websocket.js` and `src-js/server/routes/clip.routes.js` (to be migrated later)

**Communication:**
```
Bot → PubSub (twitch:channelID:clip:request) → Server → WebSocket → OBS
OBS → WebSocket (ended message) → Server → Cleanup → Process next in queue
```

**Redis Keys:**
- `twitch:channelID:clips` - Clip data cache (3h)
- `twitch:channelID:clips:queue` - Sorted set of clip IDs
- `twitch:channelID:clips:queue:data:{clipID}` - Full clip data by ID
- `twitch:channelID:clip:processing` - Currently processing flag
- `twitch:channelID:clips:connected` - OBS connected flag (server-side)
- `twitch:channelID:clips:timeouts:default` - Timeout setting (server-side)

**Key Features:**
- Random clip IDs (base 16, 6-8 chars)
- Connection checking (skip if OBS not connected)
- Server owns queue processing logic
- Timeout handling with 5s buffer
- Automatic next clip processing on completion/error
- Queue persists across OBS reconnections

See detailed plan at: `cat .opencode/plans/migrate_clip_functions_final.md`
