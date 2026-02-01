# Plan: Migrate clip functions to TypeScript with Improved Pub/Sub Queue System

## Overview
Migrate clip functions from `function/clip/` to TypeScript and replace the HTTP-based queue system with a cleaner DragonFlyDB pub/sub solution.

## Current System Analysis

### Existing Functions
1. **createClip** - Creates a clip using bot token
2. **getClip** - Gets a specific clip by ID
3. **getChannelClips** - Gets clips for a channel (with caching)
4. **showClip** - Displays a clip via API call
5. **promo.js** - Command that implements queue system using Redis lists

### Current Queue System Issues
- **Multiple keys**: `channelID:clip:connected`, `channelID:clips:queue`, `channelID:clip:playing`, `channelID:clips:queue:first`
- **Complex logic**: `retryClip` manually manages queue state
- **HTTP-based**: Sends HTTP request to server instead of using pub/sub
- **No heartbeat**: No way to know when clip actually ends (assumes success)
- **Race conditions**: Multiple keys can get out of sync

## Proposed Solution: Pub/Sub Based Queue System

### Architecture
Use DragonFlyDB pub/sub for event-driven clip processing with Redis sorted sets for queue ordering.

### Channel Naming Convention
Following established pattern: `twitch:channelID:category[:subcategory]`

**Queue Channels (Pub/Sub):**
- `twitch:channelID:clip:request` - New clip requests
- `twitch:channelID:clip:processing` - Currently processing clip
- `twitch:channelID:clip:completed` - Clip finished processing

**Queue Storage (Redis Sorted Set):**
- `twitch:channelID:clips:queue` - Sorted set of requests (score = timestamp)
  - Member: streamerLogin
  - Score: request timestamp

**State Flags (Redis Keys):**
- `twitch:channelID:clip:processing` - Boolean: is a clip being processed?

## Files to Migrate

### Phase 1: Basic Clip Functions

#### 1. `create.js` → `create.clip.ts`
**Function:** `createClip(channelID)`
- Creates clip using bot token
- Uses POST to `/clips` endpoint
- Checks for 404 (broadcaster not live)
- Returns clip ID on success (status 202)

#### 2. `getclip.js` → `get_clip.clip.ts`
**Function:** `getClip(clipID)`
- Gets specific clip by ID
- Uses bot token
- Returns clip data or error

#### 3. `getclips.js` → `get_clips.clip.ts`
**Function:** `getChannelClips(channelID, amount, skip_cache)`
- Gets all clips for channel
- Cache key: `twitch:channelID:clips` (update from `channel:clips:channelID`)
- Cache expiration: 3 hours (60 * 60 * 3)
- Update `saveToCache` to `skip_cache` (false = cache, true = fresh API)

### Phase 2: Pub/Sub Manager (NEW)

#### Create `src/classes/pubsub_manager.class.ts`
Migrate `class/pubsub.js` to TypeScript with improvements:

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
}
```

**Enhancements:**
- Strong TypeScript types
- Better error handling
- Convenience methods for clip events:
  - `publishClipRequest(channelID, streamerLogin)`
  - `publishClipProcessing(channelID, streamerLogin)`
  - `publishClipCompleted(channelID, streamerLogin)`

### Phase 3: Clip Queue System (NEW)

#### Create `src/functions/clips/queue.clip.ts`
**Functions:**

##### `requestClip(channelID, streamerLogin)`
- Adds request to sorted set: `twitch:channelID:clips:queue`
- Score: current timestamp
- Publishes to: `twitch:channelID:clip:request`
- Checks if queue is empty and nothing is processing

##### `processNextClip(channelID)`
- Pops earliest item from sorted set
- Sets `twitch:channelID:clip:processing` = true
- Publishes `twitch:channelID:clip:processing`
- Calls `showClip` function

##### `completeClip(channelID, streamerLogin, error)`
- Removes streamer from queue (if still there)
- Clears `twitch:channelID:clip:processing`
- Publishes `twitch:channelID:clip:completed`
- If error, processes next clip
- If success, checks if more items in queue

##### `isClipProcessing(channelID)`
- Checks `twitch:channelID:clip:processing`
- Returns boolean

##### `getQueueLength(channelID)`
- Checks size of sorted set `twitch:channelID:clips:queue`
- Returns number

### Phase 4: Show Clip Function (REFACTORED)

#### Create `src/functions/clips/show_clip.clip.ts`
**Function:** `showClip(channelID, clipData, streamerData, streamerChannelData)`

**Changes from original:**
- Remove `retryClip` (queue logic moved to queue.clip.ts)
- Remove HTTP call to server (use pub/sub or return data)
- Return clip data instead of making API call
- Cache key: `twitch:channelID:clip:last` (optional, for last shown clip)

**Two modes:**
1. **Data mode**: Returns formatted clip data (for chat message)
2. **Notification mode**: Publishes to `twitch:channelID:clip:show` with clip data

### Phase 5: Worker (NEW)

#### Create `src/workers/clip.worker.ts`
**Function:** `startClipWorker(channelID)`

**Logic:**
1. Subscribe to `twitch:channelID:clip:request`
2. When request received:
   - Add to sorted set queue
   - If not processing, start processing
3. Subscribe to `twitch:channelID:clip:completed`
4. When completed:
   - Check if queue has more items
   - If yes, process next item
5. Publish status updates to `twitch:channelID:clip:processing`

**Timeout handling:**
- Set timeout when processing starts (e.g., 60 seconds)
- If timeout reached, call `completeClip(channelID, streamerLogin, true)`
- Prevents hung clips

## Implementation Steps

### Step 1: Migrate PubSub Manager
- Create `src/classes/pubsub_manager.class.ts`
- Migrate all functionality from `class/pubsub.js`
- Add clip-specific convenience methods
- Add proper TypeScript types
- Update any existing usages in TypeScript code

### Step 2: Migrate Basic Clip Functions
- Create `src/functions/clips/` directory
- Migrate `create.clip.ts`
- Migrate `get_clip.clip.ts`
- Migrate `get_clips.clip.ts`
- Update cache key format
- Add proper error handling
- Create `index.ts`

### Step 3: Create Queue System
- Create `src/functions/clips/queue.clip.ts`
- Implement requestClip, processNextClip, completeClip
- Implement helper functions: isClipProcessing, getQueueLength
- Use Redis sorted sets for queue
- Publish pub/sub events

### Step 4: Refactor Show Clip
- Create `src/functions/clips/show_clip.clip.ts`
- Remove queue logic (handled by queue.clip.ts)
- Remove HTTP call (use pub/sub or return data)
- Add two modes: data return or pub/sub notification

### Step 5: Create Clip Worker
- Create `src/workers/clip.worker.ts`
- Subscribe to clip request channel
- Process queue sequentially
- Handle timeouts
- Auto-process next on completion
- Initialize workers for active channels

### Step 6: Create Queue Helper for Commands
- Create `src/functions/clips/queue_helper.clip.ts`
- Function: `enqueueClip(channelID, streamerLogin, autoProcess)`
  - Wraps requestClip + checks if should auto-start

### Step 7: Build Verification
- Run `npm run build`
- Fix any type errors

### Step 8: Commit Changes
- Commit each phase separately for tracking

## Usage Examples

### Old Way (HTTP + Redis Lists)
```javascript
// In command/promo.js
await promo(channelID, streamerName, false); // Queues clip
// showClip called later, makes HTTP request to server
// retryClip manually manages queue
```

### New Way (Pub/Sub + Sorted Sets)
```typescript
import { PubSubManager } from '../classes/pubsub_manager.class.js';
import { enqueueClip } from '../functions/clips/index.js';

// Simple enqueue (auto-processes if not busy)
await enqueueClip(channelID, streamerName);

// Or with custom handling
await requestClip(channelID, streamerName);
// Worker automatically processes queue
```

## Advantages of New System

### 1. Decoupled Architecture
- Clip requests are independent events
- Worker processes asynchronously
- No HTTP round trips

### 2. Better Queue Management
- Sorted sets guarantee FIFO order by timestamp
- Single source of truth for queue
- Atomic operations

### 3. Real-time Updates
- Pub/sub provides instant notifications
- Workers react immediately to requests
- Status updates in real-time

### 4. Scalability
- Multiple workers can subscribe to same channel
- Load distribution possible
- Better error isolation

### 5. Timeout Protection
- Automatic timeout prevents hung clips
- Auto-retry on failure
- Queue doesn't stall

### 6. Simpler State
- Fewer keys to manage
- Clear event flow
- Easier debugging

## Cache Key Summary

| Purpose | Old Key | New Key | Type | TTL |
|----------|-----------|-----------|------|-----|
| Clip data | `channel:clips:channelID` | `twitch:channelID:clips` | String | 3 hours |
| Clip queue | `channelID:clips:queue` | `twitch:channelID:clips:queue` | Sorted Set | None |
| Processing flag | `channelID:clip:playing` | `twitch:channelID:clip:processing` | String | None |
| Request channel | N/A | `twitch:channelID:clip:request` | Pub/Sub | N/A |
| Processing channel | N/A | `twitch:channelID:clip:processing` | Pub/Sub | N/A |
| Completed channel | N/A | `twitch:channelID:clip:completed` | Pub/Sub | N/A |

## Migration Path

### Option A: Full Migration (Recommended)
- Migrate everything at once
- Implement new pub/sub system
- Update all callers

### Option B: Incremental Migration
- Migrate basic clip functions first
- Keep old queue system temporarily
- Gradually migrate to pub/sub
- Deprecate old system after transition

### Questions

1. **Clip display mechanism**: Should `showClip`:
   - Return formatted data for chat message?
   - Publish to pub/sub channel for external display service?
   - Do both (dual mode)?

2. **Worker initialization**: Should workers:
   - Be initialized for all active streamers?
   - Be lazy-initialized on first request?
   - Use a single global worker?

3. **Timeout duration**: What should be the clip timeout?
   - 30 seconds (short clips)?
   - 60 seconds (typical clips)?
   - 120 seconds (long clips)?

4. **Auto-retry**: On error, should system:
   - Auto-retry next clip?
   - Wait for manual retry?
   - Have configurable retry policy?

## File Structure After Migration

```
src/
├── classes/
│   ├── pubsub_manager.class.ts (NEW)
│   └── ...
├── functions/
│   └── clips/
│       ├── create.clip.ts
│       ├── get_clip.clip.ts
│       ├── get_clips.clip.ts
│       ├── show_clip.clip.ts
│       ├── queue.clip.ts (NEW)
│       ├── queue_helper.clip.ts (NEW)
│       └── index.ts
└── workers/
    └── clip.worker.ts (NEW)
```
