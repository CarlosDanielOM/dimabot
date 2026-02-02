# Plan: Fix "Game Data is Missing" Error in Promo Command

## Problem Analysis

### Error Location
The error is originating from `showClip` function in `src/functions/clips/show_clip.clip.ts`:

**Error in logs:**
```
Error in showClip: Game data missing { channelID: '533538623', gameID: '65955' }
Error in showClip: Game data missing { channelID: '533538623', gameID: '513181' }
Error in promo: Failed to show clip {
    message: 'Game data missing',
    type: 'game_data_missing'
}
```

### Root Cause
1. `showClip` calls `searchGameById(randomClip.game_id)` (line 101)
2. `searchGameById` is returning an error (function exists in `src/functions/search/search_games.search.ts`)
3. The error type is `'game_data_missing'` (returned by showClip)
4. This error propagates to `promo` function, which returns it to message handler
5. Message handler transforms the error message, resulting in "Game Data is Missing" in chat

### Investigation Needed
The `searchGameById` function exists and is exported from `src/functions/search/index.ts`. However, it's failing to retrieve game data for the provided `game_id`.

## Possible Causes

### 1. Search Function Issue
The `searchGameById` function in `src/functions/search/search_games.search.ts` might have:
- Incorrect API endpoint
- Error in parsing response
- Invalid game_id format
- Authentication issues with Twitch API

### 2. Cache/Data Consistency
- Clip game_id might not match any games in database
- Game information might not be cached properly
- API might be returning empty results

### 3. Parameter Mismatch
- The `game_id` from clip data might be in different format than expected
- Search function might expect a different identifier format

## Proposed Solutions

### Solution 1: Debug searchGameById Function
**File to investigate:** `src/functions/search/search_games.search.ts`

**Action:**
1. Check the function implementation
2. Verify it's using correct Twitch API endpoint
3. Add detailed logging for input/output
4. Handle case where game is not found gracefully
5. Return meaningful error messages

**Current implementation pattern:**
```typescript
// Likely current implementation
export async function searchGameById(gameID: string): Promise<SearchGameResponse> {
    // Call Twitch API
    // Parse response
    // Return data or error
}
```

**Expected behavior:**
- If game exists: return game data
- If game doesn't exist: return error with meaningful message
- If API fails: return error with details

### Solution 2: Handle Missing Game Data Gracefully
**File to modify:** `src/functions/clips/show_clip.clip.ts`

**Action:**
When `searchGameById` returns an error, the system should:
1. Log the error for debugging
2. Still show the clip but with a placeholder or default game
3. Allow the promo to complete successfully even without game data

**Rationale:**
- Clips can still be shown without game information
- The overlay HTML might display "Unknown Game" or similar
- Better UX than completely failing the promo

### Solution 3: Add Validation Before Processing
**File to modify:** `src/functions/clips/show_clip.clip.ts`

**Action:**
Before calling `searchGameById`, validate that:
1. The clip object has a valid game_id
2. The game_id is not null/undefined
3. The game_id format is correct

### Solution 4: Implement Fallback for Missing Games
**File to modify:** `src/functions/clips/show_clip.clip.ts`

**Action:**
If `searchGameById` fails:
1. Set `game: 'Unknown Game'` or similar default
2. Set `game: ''` (empty string)
3. Log warning but don't fail the entire operation

## Implementation Order

### Phase 1: Investigate Search Function
1. Read `src/functions/search/search_games.search.ts`
2. Analyze the implementation
3. Identify why it's failing
4. Add detailed logging

### Phase 2: Fix Search Function (if needed)
1. Update function to handle errors gracefully
2. Add better error messages
3. Test with known game IDs

### Phase 3: Update showClip to Handle Missing Games
1. Add fallback logic for missing game data
2. Allow clips to proceed without game information
3. Update error handling to be less disruptive

### Phase 4: Test and Verify
1. Test promo command with different streamers
2. Verify clips are shown even when game data is missing
3. Check error messages are helpful and accurate

## Files to Investigate/Modify

1. **`src/functions/search/search_games.search.ts`** - Search game by ID function
2. **`src/functions/clips/show_clip.clip.ts`** - Show clip function (add fallback)

## Expected Outcome

After implementing these fixes:
- Promo command should work even when game data is missing
- Clips should display with "Unknown Game" or no game info
- Error messages should be clear and actionable
- Better user experience during testing

## Notes

The "Game Data is Missing" error is blocking users from using the !promo command. By investigating the `searchGameById` function and adding fallback logic in `showClip`, we can make the system more robust and continue to work even when game data is unavailable.
