# Plan: Migrate prediction functions to TypeScript

## Overview
Migrate three prediction functions from `function/prediction/` to TypeScript following the established patterns in `src/functions/`.

## Files to Migrate

### 1. `create.js` → `create.prediction.ts`
**Location:** `function/prediction/create.js`

**Function:** `createPrediction(channelID, title, outcomes, duration, cache)`

**Purpose:** Create a new channel points prediction

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses POST to `/predictions` endpoint
- Outcomes format: `[{ title: "Option 1" }, { title: "Option 2" }]`
- Duration in seconds (converted from string to number) - called `prediction_window`
- Returns prediction data with id, title, outcomes, channelID, channel, status
- May include winning_outcome_id and winning_outcome if applicable
- Caches under `twitch:channelID:predictions` if cache=true

**Current Cache Behavior:**
- Key: `${channel}:prediction` (will change to `twitch:channelID:predictions`)
- No expiration (persistent until deleted or overwritten)
- Caches full prediction data

### 2. `end.js` → `end.prediction.ts`
**Location:** `function/prediction/end.js`

**Function:** `endPrediction(channelID, predictionID, status, winnerID)`

**Purpose:** End a prediction (RESOLVED, CANCELED, or LOCKED)

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses PATCH to `/predictions` endpoint
- Validates status must be 'RESOLVED', 'CANCELED', or 'LOCKED'
- If status is 'RESOLVED', requires winnerID for winning_outcome_id
- Deletes cache under `twitch:channelID:predictions`

**Current Cache Behavior:**
- Deletes cache key `${channel}:prediction`
- Does NOT update cache with final results

### 3. `get.js` → `get.prediction.ts`
**Location:** `function/prediction/get.js`

**Function:** `getPrediction(channelID, predictionID, cache)`

**Purpose:** Get prediction data (current active prediction if predictionID not specified)

**Dependencies to Update:**
- `getClient()` → `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- `getStreamerHeaderById()` → `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- `getTwitchHelixUrl()` → `getTwitchHelixUrl()` from `src/utils/links.ts`

**Key Implementation Details:**
- Uses streamer token (requires channel permissions)
- Uses GET to `/predictions` endpoint
- If predictionID provided: fetch specific prediction
- If predictionID not provided: fetch current active prediction
- Returns prediction data with id, title, outcomes, channelID, channel, status
- Handles 404 and empty results
- May include winning_outcome_id and winning_outcome if resolved
- Caches under `twitch:channelID:predictions` if cache=true

**Current Cache Behavior:**
- Key: `${channel}:prediction` (will change to `twitch:channelID:predictions`)
- No expiration (persistent until deleted or overwritten)
- Caches full prediction data

## Response Interfaces

### CreatePredictionResponse
```typescript
interface CreatePredictionResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    id?: string;
    title?: string;
    outcomes?: PredictionOutcome[];
    channelID?: string;
    channel?: string;
    status?: string;
    winning_outcome_id?: string;
    winning_outcome?: PredictionOutcome;
}
```

### EndPredictionResponse
```typescript
interface EndPredictionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PredictionData;
}
```

### GetPredictionResponse
```typescript
interface GetPredictionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PredictionData;
}
```

### Supporting Interfaces
```typescript
interface TopPredictor {
    user_id: string;
    user_name: string;
    user_login: string;
    channel_points_won: number | null;
    channel_points_used: number;
}

interface PredictionOutcome {
    id: string;
    title: string;
    users: number;
    channel_points: number;
    top_predictors: TopPredictor[];
    color: string;
}

interface PredictionData {
    id: string;
    title: string;
    outcomes: PredictionOutcome[];
    channelID: string;
    channel: string;
    status: string;
    winning_outcome_id?: string;
    winning_outcome?: PredictionOutcome;
}
```

## Implementation Steps

### Step 1: Create directory structure
- Create `src/functions/predictions/` directory (plural for consistency with polls, channels)

### Step 2: Migrate `create.prediction.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces (including TopPredictor, PredictionOutcome, PredictionData)
- Implement `createPrediction()` function with:
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - Body data construction for POST request (prediction_window not duration)
  - Response parsing and error handling
  - Map outcomes with all fields (users, channel_points, top_predictors, color)
  - Handle winning_outcome_id and winning_outcome if present
  - Cache writing (if cache=true)
  - Convert duration to number

### Step 3: Migrate `end.prediction.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `endPrediction()` function with:
  - Status validation (RESOLVED, CANCELED, or LOCKED only)
  - If RESOLVED, validate winnerID is provided
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - Body data construction for PATCH request
  - If RESOLVED and winnerID, add winning_outcome_id to body
  - Response parsing and error handling
  - Map outcomes with all fields
  - Handle winning_outcome_id and winning_outcome
  - Cache deletion

### Step 4: Migrate `get.prediction.ts`
- Create file with TypeScript implementation
- Import required utilities
- Define interfaces
- Implement `getPrediction()` function with:
  - Proper error handling and logging
  - Use `getTwitchStreamerHeaderById()` and handle error result
  - URL params with optional predictionID
  - Response parsing and error handling
  - Empty result and 404 handling
  - Map outcomes with all fields
  - Handle winning_outcome_id and winning_outcome
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
src/functions/predictions/
├── create.prediction.ts
├── end.prediction.ts
├── get.prediction.ts
└── index.ts
```

## Cache Strategy

### Decisions
- **Cache key format:** `twitch:channelID:predictions` (following established pattern)
- **Cache expiration:** No expiration (persistent, like polls)
- **Cache parameter:** Keep `cache` parameter (true = cache, false = no cache)
- **End behavior:** Delete cache (not update with final results)

### Cache keys per channel:
- `twitch:channelID:predictions` - Full prediction data (String, JSON, no expiration)

## Usage Context

From `command/prediction.js`:
- Commands format: `!prediction CREATE title;option1/option2;duration`
- Commands format: `!prediction RESOLVED outcome_number` (1-indexed)
- Commands format: `!prediction CANCELED` or `!prediction LOCKED`
- Only fetches active prediction (no predictionID parameter for CREATE action)
- Always uses `cache=true` for getPrediction calls
- Always caches createPrediction results
- RESOLVED requires selecting winner by outcome number (1-indexed)

## Key Differences from Polls

| Feature | Polls | Predictions |
|---------|-------|-------------|
| Choices | `choices` array | `outcomes` array |
| Choice data | `{ id, title, votes }` | `{ id, title, users, channel_points, top_predictors, color }` |
| Duration field | `duration` | `prediction_window` |
| End statuses | TERMINATED, ARCHIVED | RESOLVED, CANCELED, LOCKED |
| Winner selection | No winner field | Requires winnerID for RESOLVED |
| Status check | ACTIVE only | ACTIVE or LOCKED |

## Notes

- Must convert URLSearchParams to string when passing to `getTwitchHelixUrl()`
- Use type casting for headers if needed: `headers: streamerHeader as unknown as Record<string, string>`
- Outcomes array must be in format `[{ title: "option1" }, { title: "option2" }]`
- Duration/prediction_window must be converted to number
- Status validation is critical for endPrediction
- RESOLVED status requires winnerID
- top_predictors is an array of TopPredictor objects with user_id, user_name, user_login, channel_points_won, channel_points_used
- Winning outcome handling: both winning_outcome_id and full winning_outcome object if resolved
