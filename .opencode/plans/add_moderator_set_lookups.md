# Plan: Add Redis Sets for Fast Moderator Lookups

## Overview
Enhance moderator caching by adding Redis SETs for O(1) lookups while keeping the current full data JSON cache.

## Changes Required

### 1. Modify `get_moderators.moderation.ts`
**Keep existing functionality** - `getChannelModerators()` unchanged for full data retrieval

**Add new cache keys:**
- `twitch:channelid:moderators:ids` (SET) - all moderator user IDs
- `twitch:channelid:moderators:logins` (SET) - all moderator logins

**When caching moderators (after API call):**
```typescript
// Existing JSON cache
await cacheClient.set(cacheKey, JSON.stringify(result), { EX: 7200 });

// NEW: Populate SETs
await cacheClient.del(idsCacheKey, loginsCacheKey); // Clear old sets
await cacheClient.sAdd(idsCacheKey, ...ids); // Add new IDs
await cacheClient.sAdd(loginsCacheKey, ...logins); // Add new logins
await cacheClient.expire(idsCacheKey, 7200);
await cacheClient.expire(loginsCacheKey, 7200);
```

### 2. Create new function file: `moderator_helpers.moderation.ts`
**New functions:**

#### `getTwitchModeratorsIds(channelID: string, cache: boolean = false)`
- Returns all moderator IDs as string array
- If cache=true: reads from `twitch:channelid:moderators:ids` SET (O(n) to get all)
- If cache=false or empty: calls `getChannelModerators()` and extracts IDs
- Response: `{ error: boolean, ids: string[] }`

#### `isTwitchModeratorById(channelID: string, userID: string, cache: boolean = true)`
- O(1) lookup using `SISMEMBER` on `twitch:channelid:moderators:ids`
- If cache=true and SET exists: fast check
- If cache=false or SET missing: calls `getChannelModerators()` and checks array
- Response: `{ error: boolean, isModerator: boolean }`

#### `isTwitchModeratorByLogin(channelID: string, userLogin: string, cache: boolean = true)`
- O(1) lookup using `SISMEMBER` on `twitch:channelid:moderators:logins`
- If cache=true and SET exists: fast check
- If cache=false or SET missing: calls `getChannelModerators()` and checks array
- Response: `{ error: boolean, isModerator: boolean }`

### 3. Update `index.ts`
Export all new functions:
```typescript
export { ban } from './ban.moderation.js';
export { getChannelModerators } from './get_moderators.moderation.js';
export { getTwitchModeratorsIds, isTwitchModeratorById, isTwitchModeratorByLogin } from './moderator_helpers.moderation.js';
```

## Cache Strategy

### Three cache keys per channel:
1. `twitch:channelid:moderators` (String, JSON) - Full data (7200s)
2. `twitch:channelid:moderators:ids` (SET) - User IDs (7200s)
3. `twitch:channelid:moderators:logins` (SET) - User logins (7200s)

### Cache invalidation:
- All keys expire together after 2 hours
- On next API call, all keys are refreshed atomically

## Questions Before Implementation

1. **Cache parameter behavior for new functions:**
   - Should `isTwitchModeratorById/ByLogin` default to `cache=true` (fast, O(1)) or `cache=false` (always fresh)?
   - If SET is missing and `cache=true`, should it auto-fetch from API or return `isModerator: false`?

2. **Cache synchronization:**
   - Should we invalidate/update the cache when moderators change (e.g., after ban, add_moderator, etc.)?
   - Or rely on 2-hour expiration for simplicity?

## Benefits

- **Performance:** O(1) lookups for "is this user a moderator?" checks
- **Simplicity:** Full data retrieval unchanged, existing code unaffected
- **Flexibility:** Choose fast or fresh data based on use case

## Use Cases

| Function | Use Case | Performance |
|----------|----------|-------------|
| `getChannelModerators()` | Get all moderator details | O(n) from cache, O(n) from API |
| `getTwitchModeratorsIds()` | Get list of moderator IDs | O(n) from SET or JSON |
| `isTwitchModeratorById()` | Check if user is moderator | O(1) from SET |
| `isTwitchModeratorByLogin()` | Check if login is moderator | O(1) from SET |
