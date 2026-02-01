# Plan: Migrate moderation functions to TypeScript

## Overview
Migrate two moderation functions from `function/moderation/` to TypeScript following the established patterns in `src/functions/`.

## Files to Migrate

### 1. `ban.js` → `ban.moderation.ts`
**Location:** `function/moderation/ban.js`

**Function:** `ban(channelID, userID, moderatorID, duration, reason)`

**Purpose:** Ban or timeout a user in a channel

**Dependencies to Update:**
- `getBotHeader()` → `getTwitchBotHeader()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses bot token for the ban operation
- Uses POST to `/moderation/bans` endpoint
- Duration is optional (null = permanent ban)
- Reason is optional
- Returns standard response format

**Response Interface:**
```typescript
interface BanResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchBanData;
}
```

### 2. `getmoderators.js` → `get_moderators.moderation.ts`
**Location:** `function/moderation/getmoderators.js`

**Function:** `getChannelModerators(channelID, userIDs, cache)`

**Purpose:** Get list of channel moderators

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses GET to `/moderation/moderators` endpoint
- Can filter by specific userIDs
- Note: `cache` parameter is obtained but not used (keeping for consistency)
- Returns structured data with IDs, logins, and display names

**Response Interface:**
```typescript
interface GetModeratorsResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: TwitchModeratorData[];
    ids?: string[];
    logins?: string[];
    displayNames?: string[];
}
```

## Implementation Steps

### Step 1: Create directory structure
- Create `src/functions/moderation/` directory

### Step 2: Migrate `ban.moderation.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `ban()` function with:
  - Proper error handling and logging
  - Use `getTwitchBotHeader()` and handle error result
  - URLSearchParams for query params
  - Body data construction for POST request
  - Response parsing and error handling

### Step 3: Migrate `get_moderators.moderation.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `getChannelModerators()` function with:
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - Multiple user_id params handling
  - Data extraction into arrays
  - Empty result handling

### Step 4: Create index.ts
- Export both functions
- Follow alphabetical pattern from `src/functions/channels/index.ts`

### Step 5: Build verification
- Run `npm run build` to verify TypeScript compilation
- Fix any type errors

### Step 6: Commit changes
- Create commit for each phase (optional, but good for progress tracking)

## File Structure After Migration

```
src/functions/moderation/
├── ban.moderation.ts
├── get_moderators.moderation.ts
└── index.ts
```

## Notes

- The `cache` parameter in `getChannelModerators` is not actually used in the original code (getClient() is called but not utilized), but we'll keep it for consistency with the original function signature
- `getTwitchBotHeader()` returns a result object with error checking, unlike `getBotHeader()` which returns directly
- Must convert URLSearchParams to string when passing to `getTwitchHelixUrl()`
- Use type casting for headers if needed: `headers: botHeader as unknown as Record<string, string>`
