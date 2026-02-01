# Plan: Migrate poll functions to TypeScript

## Overview
Migrate three poll functions from `function/poll/` to TypeScript following the established patterns in `src/functions/`.

## Files to Migrate

### 1. `create.js` → `create.poll.ts`
**Location:** `function/poll/create.js`

**Function:** `createPoll(channelID, title, choices, duration, cache)`

**Purpose:** Create a new poll in a channel

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses POST to `/polls` endpoint
- Choices format: `[{ title: "Option 1" }, { title: "Option 2" }]`
- Duration in seconds (converted from string to number)
- Returns poll data with id, title, choices, channelID, channel
- Caches under `${channel}:poll` if cache=true

**Current Cache Behavior:**
- Key: `${channel}:poll`
- No expiration (persistent until deleted or overwritten)
- Caches full poll data

### 2. `end.js` → `end.poll.ts`
**Location:** `function/poll/end.js`

**Function:** `endPoll(channelID, pollID, status)`

**Purpose:** End a poll (TERMINATED or ARCHIVED)

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses PATCH to `/polls` endpoint
- Validates status must be 'TERMINATED' or 'ARCHIVED'
- Deletes cache under `${channel}:poll`

**Current Cache Behavior:**
- Deletes cache key `${channel}:poll`
- Does NOT update cache with final results

### 3. `get.js` → `get.poll.ts`
**Location:** `function/poll/get.js`

**Function:** `getPoll(channelID, pollID, cache)`

**Purpose:** Get poll data (current active poll if pollID not specified)

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses GET to `/polls` endpoint
- If pollID provided: fetch specific poll
- If pollID not provided: fetch current active poll
- Returns poll data with id, title, choices, channelID, channel, status
- Handles 404 and empty results
- Caches under `${channel}:poll` if cache=true

**Current Cache Behavior:**
- Key: `${channel}:poll`
- No expiration (persistent until deleted or overwritten)
- Caches full poll data

## Response Interfaces

### CreatePollResponse
```typescript
interface CreatePollResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    id?: string;
    title?: string;
    choices?: PollChoice[];
    channelID?: string;
    channel?: string;
}
```

### EndPollResponse
```typescript
interface EndPollResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PollData;
}
```

### GetPollResponse
```typescript
interface GetPollResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PollData;
}
```

### Supporting Interfaces
```typescript
interface PollChoice {
    id: string;
    title: string;
    votes: number;
}

interface PollData {
    id: string;
    title: string;
    choices: PollChoice[];
    channelID: string;
    channel: string;
    status?: string;
}
```

## Implementation Steps

### Step 1: Create directory structure
- Create `src/functions/polls/` directory (plural for consistency with channels, chats, moderation)

### Step 2: Migrate `create.poll.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `createPoll()` function with:
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - Body data construction for POST request
  - Response parsing and error handling
  - Cache writing (if cache=true)
  - Convert duration to number

### Step 3: Migrate `end.poll.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `endPoll()` function with:
  - Status validation (TERMINATED or ARCHIVED only)
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - Body data construction for PATCH request
  - Response parsing and error handling
  - Cache deletion

### Step 4: Migrate `get.poll.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `getPoll()` function with:
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - URL params with optional pollID
  - Response parsing and error handling
  - Empty result and 404 handling
  - Cache reading and writing (if cache=true)

### Step 5: Create index.ts
- Export all three functions
- Follow pattern from other function directories

### Step 6: Build verification
- Run `npm run build` to verify TypeScript compilation
- Fix any type errors

### Step 7: Commit changes
- Create commit for migration

## File Structure After Migration

```
src/functions/polls/
├── create.poll.ts
├── end.poll.ts
├── get.poll.ts
└── index.ts
```

## Questions / Decisions Needed

### 1. Cache Expiration
**Current:** No expiration (persistent)
**Options:**
- Keep no expiration (current behavior)
- Add expiration (e.g., 24 hours, 48 hours)
- Use duration as expiration (dynamic)

### 2. Cache Parameter Naming
**Current:** `cache` (true = cache, false = no cache)
**Options:**
- Keep `cache` parameter
- Switch to `skip_cache` (false = cache, true = skip cache)

### 3. Cache Key Format
**Current:** `${channel}:poll` (broadcaster login)
**Options:**
- Keep `${channel}:poll`
- Change to `twitch:channelid:poll` (broadcaster ID)
- Change to `twitch:channelid:poll:active` (for active polls)

### 4. End Poll Cache Behavior
**Current:** Deletes cache entirely
**Options:**
- Delete cache (current)
- Update cache with final results (so users can see completed polls)
- Cache in a different key for completed polls

## Usage Context

From `command/poll.js`:
- Commands format: `!poll CREATE title;option1/option2;duration`
- Commands format: `!poll TERMINATED` or `!poll ARCHIVED`
- Only fetches active poll (no pollID parameter)
- Always uses `cache=true` for getPoll calls
- Always caches createPoll results

## Notes

- Must convert URLSearchParams to string when passing to `getTwitchHelixUrl()`
- Use type casting for headers if needed: `headers: streamerHeader as unknown as Record<string, string>`
- Choices array must be in format `[{ title: "choice1" }, { title: "choice2" }]`
- Duration must be converted to number
- Status validation is critical for endPoll
