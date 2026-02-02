# Plan: Fix WebSocket Client Disconnection Issue

## Problem Analysis

### Observed Behavior
From server logs, the clip WebSocket client (OBS browser source) is experiencing a frequent disconnect/reconnect cycle:

```
533538623 (cdom201) connected to clip
533538623 (cdom201) disconnected from clip
533538623 (cdom201) connected to clip
533538623 (cdom201) disconnected from clip
533538623 (cdom201) connected to clip
533538623 (cdom201) disconnected from clip
```

### User Report
- Client connects to WebSocket (`/clip/533538623`)
- **2 seconds later**, client gets killed/disconnected
- OBS still shows the link as active
- This cycle repeats continuously

### Root Cause

The issue is in the **disconnect timeout logic** in `src/server/websocket.ts` (lines 159-86):

```typescript
let disconnectTimeout: NodeJS.Timeout | null = null;

socket.on('disconnect', () => {
    console.log(`${channelID} (${account.name}) disconnected from clip`);
    
    // Wait 5s for reconnect before deleting
    disconnectTimeout = setTimeout(async () => {
        await cacheClient.del(`twitch:${channelID}:clips:connected`);
        await cacheClient.del(`twitch:${channelID}:clips:timeouts:default`);
        console.log(`${channelID} OBS connection fully removed`);
    }, 5000);
});
```

**Problem:**
1. The 5-second timeout is too aggressive
2. When client disconnects (even temporarily due to network glitch), timeout starts
3. Within 5 seconds, connection flag is deleted
4. If OBS hasn't reconnected yet, the flag remains deleted
5. When OBS reconnects, it creates a new connection
6. But during those 5 seconds, `checkClipConnection()` in bot sees flag as deleted
7. Bot skips queuing clips to OBS

### Why 2 Seconds?

The "2 seconds" timing suggests:
- Network latency or instability
- OBS WebSocket client reconnection attempt timing
- Possible browser/OBS connection refresh interval
- The actual disconnect might be momentary (< 2s)
- But timeout fires at 5s, which is close enough to trigger the issue

### Why Client Gets Killed?

The "client gets killed" behavior could be due to:
1. **Connection Flag Deleted**: Bot sees `twitch:{channelID}:clips:connected` as deleted
2. **No New Clips Arriving**: Since bot thinks OBS is disconnected, it stops sending clips
3. **OBS Client Times Out**: Waiting indefinitely for a clip that never comes
4. **OBS Auto-Disconnects**: Some WebSocket clients disconnect on inactivity

## Proposed Solutions

### Solution 1: Increase Disconnect Timeout (Recommended)
**File:** `src/server/websocket.ts`

**Change:**
```typescript
// Change from 5000ms (5s) to 30000ms (30s)
disconnectTimeout = setTimeout(async () => {
    await cacheClient.del(`twitch:${channelID}:clips:connected`);
    await cacheClient.del(`twitch:${channelID}:clips:timeouts:default`);
    console.log(`${channelID} OBS connection fully removed`);
}, 30000); // 30 seconds instead of 5
```

**Rationale:**
- 30 seconds gives OBS plenty of time to reconnect
- Network hiccups won't trigger premature flag deletion
- Still cleans up truly disconnected clients
- Reduces false disconnection events

### Solution 2: Remove Timeout Entirely (Alternative)
**File:** `src/server/websocket.ts`

**Change:**
```typescript
// Delete connection flag immediately on disconnect
socket.on('disconnect', () => {
    console.log(`${channelID} (${account.name}) disconnected from clip`);
    
    // Delete immediately, no timeout
    await cacheClient.del(`twitch:${channelID}:clips:connected`);
    await cacheClient.del(`twitch:${channelID}:clips:timeouts:default`);
    console.log(`${channelID} OBS connection removed immediately`);
});

// Keep the reconnection clear logic
socket.on('connect', () => {
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
});
```

**Rationale:**
- Simpler, no delayed cleanup
- Connection reflects actual state (if client is disconnected, flag is deleted)
- If OBS reconnects quickly, it will just reset the flag
- No artificial delay that causes race conditions

### Solution 3: Add Heartbeat/Ping Mechanism (Advanced)
**Implementation:**
```typescript
// Add heartbeat from OBS
socket.on('ping', () => {
    // OBS sends ping every 30s
    // Update last activity timestamp
    await cacheClient.set(`twitch:${channelID}:clips:last_activity`, Date.now());
});

// Check for stale connections (cleanup job)
setInterval(async () => {
    const lastActivity = await cacheClient.get(`twitch:${channelID}:clips:last_activity`);
    if (lastActivity && (Date.now() - parseInt(lastActivity) > 60000)) {
        // No activity for 60s, mark as disconnected
        await cacheClient.del(`twitch:${channelID}:clips:connected`);
        console.log(`${channelID} OBS marked as inactive (no heartbeat)`);
    }
}, 30000); // Check every 30s
```

**Rationale:**
- More robust connection tracking
- Distinguishes temporary hiccups from true disconnects
- OBS can implement simple ping/keepalive
- Better long-term reliability

### Solution 4: Improve OBS Client Reconnection (Client-Side)
**File:** `src/server/routes/public/clip.html`

**Add:**
```javascript
// Add reconnection delay logic
let reconnectAttempts = 0;
let maxReconnectDelay = 30000; // 30 seconds max

socket.on('disconnect', () => {
    reconnectAttempts++;
    
    // Calculate exponential backoff
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
    
    console.log(`Disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    
    setTimeout(() => {
        socket.connect();
    }, delay);
});

socket.on('connect', () => {
    reconnectAttempts = 0; // Reset on successful connection
    console.log('Reconnected successfully');
});
```

**Rationale:**
- Prevents rapid reconnection attempts
- Exponential backoff reduces server load
- Prevents connection spam
- More stable connection handling

## Implementation Order

### Phase 1: Quick Fix (Recommended)
1. Edit `src/server/websocket.ts`
2. Change disconnect timeout from 5000ms to 30000ms
3. Test with OBS
4. Monitor logs for improvement

### Phase 2: Alternative Fix (If Phase 1 doesn't work)
1. Remove timeout entirely, delete immediately on disconnect
2. Test for stability
3. Compare with Phase 1 results

### Phase 3: Advanced Fix (If needed)
1. Implement heartbeat mechanism
2. Add stale connection cleanup
3. Update OBS client to send pings
4. Implement client-side reconnection logic

## Expected Outcome

After implementing Solution 1 (Increased Timeout):
- **5-second timeout** becomes **30-second timeout**
- OBS has more time to reconnect
- Temporary disconnects won't trigger premature flag deletion
- Bot continues to queue clips correctly
- Fewer "client killed" events

## Additional Considerations

### Bot-Side Connection Check
The bot's `checkClipConnection()` function checks:
```typescript
const connected = await cacheClient.exists(`twitch:${channelID}:clips:connected`);
return { connected: connected === 1 };
```

**Issue:** If flag is deleted by timeout, bot won't queue clips until OBS reconnects and re-sets the flag.

### Current State
- ✅ WebSocket connection established
- ✅ Clip queue system working
- ✅ Game data fallback implemented
- ❌ Connection flag management too aggressive (5s timeout)

## Recommendations

**Immediate:** Increase timeout to 30 seconds (Solution 1)
**If persists:** Consider removing timeout entirely (Solution 2)
**Long-term:** Implement heartbeat mechanism (Solution 3)

The 5-second timeout appears to be the root cause of the "client gets killed" issue. Increasing it to 30 seconds should resolve most false disconnection problems while still maintaining cleanup of truly dead connections.
