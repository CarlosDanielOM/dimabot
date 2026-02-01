# AI Agent Safety Guidelines

## Project Structure

### New TypeScript Project
- **Location:** `src/`
- **Status:** Active rebuild from old JS project
- **Language:** TypeScript

### Old JavaScript Project
- **Location:** Root directory (excluding `src/`)
- **Status:** Legacy code being replaced
- **Language:** JavaScript

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
- Target of the migration effort
- Use proper TypeScript types
- Follow existing patterns in `src/classes/`, `src/handlers/`, etc.

### JavaScript (outside src/)
- Read only
- Do not modify legacy code unless explicitly requested
- These files are being replaced by TypeScript versions
- May be deleted during migration process

---

## Migration Conventions

### File Naming Convention
- **Pattern:** `what_the_file_is.parent_folder.ts`
- **Examples:**
  - `add_vip.channel.ts` (for VIP management)
  - `get_editors.channel.ts` (for channel editors)
  - `send_message.chat.ts` (for chat messages)

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
