# Server Routes Migration Plan

## Overview
Migrate all HTTP routes from `src-js/server/routes/` to TypeScript in `src/server/routes/`. This plan enables parallel work by multiple agents, each focusing on independent files.

## Migration Status

### ✅ Already Migrated
- `file.route.ts` - Video clip serving (with range support)
- `clip.route.ts` - Clip page serving + test endpoint
- `validation.route.ts` - Token validation ✅ (Priority 1)
- `overlay.route.ts` - Overlay HTML serving ✅ (Priority 1)
- `twitch.route.ts` - Twitch API wrappers ✅ (Priority 1)
- `admin.route.ts` - Admin CRUD ✅ (Priority 2)
- `eventsub.route.ts` - EventSub CRUD ✅ (Priority 2)
- `referral.route.ts` - Referral system ✅ (Priority 2)
- `user.route.ts` - User operations + chat control ✅ (Priority 2)
- `command.route.ts` - Command CRUD ✅ (Priority 2)

### ❌ NOT Migrating (User Decision)
- `speach.routes.js` - Speech TTS (skip - now handled by websocket pub/sub)
- `sumimetro.routes.js` - Sumimetro overlay (skip - user said doesn't matter)
- `clipDesign.routes.js` - Skip (different approach now)

### 🔄 To Migrate (6 files) - Priority 3 (Complex)

1. `aiPersonality.route.ts` - AI personality with tier limits
2. `trigger.route.ts` - Trigger CRUD + S3 upload
3. `reward.route.ts` - Channel rewards + Twitch integration
4. `site.route.ts` - Site events (SKIP - verify if TS version exists)
5. `dev.route.ts` - Development utilities
6. `auth.route.ts` - OAuth flow (very complex!)

---

## Dependency Matrix

### Schemas (TypeScript Available ✅)
| JS Schema | TS Schema | Status |
|-----------|------------|--------|
| `admin` | `src/schemas/admin.schema.ts` | ✅ Migrated |
| `channel` | `src/schemas/users.schema.ts` (IChannel) | ✅ Migrated |
| `channelAIPersonality` | `src/schemas/channel_ai_personality.schema.ts` | ✅ Migrated |
| `channelConfig` | `src/schemas/channel_config.schema.ts` | ✅ Migrated |
| `command` | `src/schemas/commands.schema.ts` | ✅ Migrated |
| `eventsub` | `src/schemas/eventsub.schema.ts` | ✅ Migrated |
| `redemptionreward` | `src/schemas/redemption_reward.schema.ts` | ✅ Migrated |
| `event` | `src/schemas/event.schema.ts` | ✅ Migrated |
| `referralCode` | `src/schemas/referral_code.schema.ts` | ✅ Migrated |
| `trigger` | `src/schemas/trigger.schema.ts` | ✅ Migrated |
| `triggerFile` | `src/schemas/trigger_file.schema.ts` | ✅ Migrated |

### Utils (TypeScript Available ✅)
| JS Util | TS Util | Status |
|----------|---------|--------|
| `logger` | `src/utils/logger.ts` | ✅ Migrated |
| `crypto` | `src/utils/crypto.ts` | ✅ Migrated |
| `header` | `src/utils/header.ts` | ✅ Migrated |
| `eventsub` | `src/utils/eventsub.ts` | ✅ Migrated |
| `client` | `src/functions/channels/connect.channel.ts` | ✅ Migrated |
| `referral` | `src/utils/referral.ts` | ✅ Migrated |
| `siteanalytics` | `src/utils/siteanalytics.ts` | ✅ Migrated |
| `s3` | `src/functions/s3/triggers.s3.ts` | ✅ Migrated |

### Functions (TypeScript Available ✅)
| JS Function | TS Function | Status |
|-------------|-------------|--------|
| `getUser` (user/getuser) | `src/functions/users/get_user_by_login.users.ts` | ✅ Migrated |
| `getUserById` | `src/functions/users/get_user_by_id.users.ts` | ✅ Migrated |
| `getscopes` | `src/functions/users/get_scopes.users.ts` | ✅ Migrated |
| `CHANNEL.addModerator` | `src/functions/moderation/add_moderator.moderation.ts` | ✅ Migrated |

### Classes (TypeScript Available ✅)
| JS Class | TS Class | Status |
|-----------|----------|--------|
| `STREAMERS` | `TwitchStreamers` (twitch_streamers.class.ts) | ✅ Migrated |

### Middleware (TypeScript Available ✅)
| JS Middleware | TS Middleware | Status |
|--------------|---------------|--------|
| `auth` | `src/middleware/auth.middleware.ts` | ✅ Migrated |
| `admin` | `src/middleware/admin.middleware.ts` | ✅ Migrated |

---

## Migration Checklist (Track Progress)

Copy this section and update as files are completed:

```
Priority 1 - Simple (3 files):
[x] validation.route.ts     - Agent: ___ ✅ DONE
[x] overlay.route.ts        - Agent: ___ ✅ DONE
[x] twitch.route.ts         - Agent: ___ ✅ DONE

Priority 2 - Medium (5 files):
[x] admin.route.ts          - Agent: ___ ✅ DONE
[x] eventsub.route.ts      - Agent: ___ ✅ DONE
[x] command.route.ts        - Agent: ___ ✅ DONE
[x] referral.route.ts      - Agent: ___ ✅ DONE
[x] user.route.ts           - Agent: ___ ✅ DONE

Priority 3 - Complex (6 files):
[x] aiPersonality.route.ts  - Agent: ___ ✅ DONE
[ ] trigger.route.ts        - Agent: ___
[x] reward.route.ts         - Agent: ___ ✅ DONE
[ ] site.route.ts           - Agent: ___ (SKIP if TS exists)
[ ] dev.route.ts            - Agent: ___
[ ] auth.route.ts           - Agent: ___ ✅ DONE
```

---

## File-by-File Migration Guides

### 1. validation.routes.ts (Priority 1 - Simple)

**Location:** `src/server/routes/validation.route.ts`

**Purpose:** Validate admin access using JWT tokens

**Dependencies:**
- ✅ `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `POST /:channelID` - Validate token + admin status

**Key Changes from JS:**
- TypeScript interfaces for request/response
- Proper error handling with AGENTS.md pattern

**Estimated Time:** 10-15 minutes

**Steps:**
1. Create file with proper imports
2. Implement POST endpoint
3. Validate token from cache
4. Check admin membership in cache
5. Return appropriate response
6. Build and test
7. Commit

---

### 2. overlay.routes.ts (Priority 1 - Simple)

**Location:** `src/server/routes/overlay.route.ts`

**Purpose:** Serve overlay HTML files + simple websocket emit

**Dependencies:**
- ✅ `getIO()` from `src/server/websocket.ts` (add export if needed)

**Endpoints:**
- `GET /overlays/triggers/:channelID` - Serve trigger.html
- `GET /overlays/furry/:channelID` - Serve furry.html
- `POST /overlays/furry/:channelID` - Emit furry event via websocket

**Key Changes from JS:**
- TypeScript types
- Use existing HTML files from `src/server/routes/public/`

**Estimated Time:** 10-15 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET endpoints (serve HTML)
3. Implement POST endpoint (websocket emit)
4. Build and test
5. Commit

---

### 3. twitch.routes.ts (Priority 1 - Simple)

**Location:** `src/server/routes/twitch.route.ts`

**Purpose:** Proxy Twitch API calls with streamer tokens

**Dependencies:**
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- ✅ `getTwitchHelixUrl()` from `src/utils/links.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /twitch/rewards` - Get channel point rewards from Twitch API

**Key Changes from JS:**
- Use TypeScript interfaces
- Fetch rewards via Twitch API
- Support filtering by rewardID/name

**Estimated Time:** 15-20 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET endpoint
3. Get streamer token
4. Call Twitch Helix API
5. Filter results
6. Return data
7. Build and test
8. Commit

---

### 4. admin.routes.ts (Priority 2 - Medium)

**Location:** `src/server/routes/admin.route.ts`

**Purpose:** CRUD operations for channel admins

**Dependencies:**
- ✅ `AdminSchema` from `src/schemas/admin.schema.ts`
- ✅ `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- ✅ `getUserByLogin()` from `src/functions/users/get_user_by_login.users.ts`
- ✅ `logger` from `src/utils/logger.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /:channelID` - List all admins (with pagination: page, limit, sort, order)
- `GET /:channelID/:adminID` - Get specific admin details
- `POST /:channelID` - Add new admin
- `DELETE /:channelID/:adminID` - Remove admin

**Key Changes from JS:**
- TypeScript interfaces for admin data
- Redis operations with TypeScript client
- MongoDB operations with TypeScript schema

**Redis Keys:**
- `{channelID}:admins` - Set of admin names
- `{channelID}:admins:ids` - Set of admin IDs
- `{channelID}:admins:{adminID}` - Hash of admin details

**Estimated Time:** 20-30 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET /:channelID (list with pagination)
3. Implement GET /:channelID/:adminID (get details)
4. Implement POST /:channelID (create admin)
5. Implement DELETE /:channelID/:adminID (remove admin)
6. Update Redis and MongoDB in sync
7. Build and test
8. Commit

---

### 5. eventsub.routes.ts (Priority 2 - Medium)

**Location:** `src/server/routes/eventsub.route.ts`

**Purpose:** Manage Twitch EventSub subscriptions

**Dependencies:**
- ✅ `EventSubSchema` from `src/schemas/eventsub.schema.ts`
- ✅ `subscribeTwitchEvent()` from `src/utils/eventsub.ts`
- ✅ `unsubscribeTwitchEvent()` from `src/utils/eventsub.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /:channelID` - List eventsubs (filter by type or id)
- `POST /:channelID` - Create eventsub
- `DELETE /:channelID/:id` - Delete eventsub
- `PATCH /:channelID/:id` - Update eventsub

**Key Changes from JS:**
- TypeScript interfaces
- EventSub utility calls
- ObjectID validation

**Estimated Time:** 20-25 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET /:channelID (list)
3. Implement POST /:channelID (create)
4. Implement DELETE /:channelID/:id (delete)
5. Implement PATCH /:channelID/:id (update)
6. Build and test
7. Commit

---

### 6. command.routes.ts (Priority 2 - Medium)

**Location:** `src/server/routes/command.route.ts`

**Purpose:** CRUD operations for chat commands

**Dependencies:**
- ✅ `CommandSchema` from `src/schemas/commands.schema.ts`
- ✅ `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /` - List all commands (global, with limit/skip)
- `GET /:channelID` - List channel commands (with limit/skip)
- `POST /:channelID` - Create command
- `PATCH /:channelID/:cmdID` - Update command
- `DELETE /:channelID/:cmdID` - Delete command

**Key Changes from JS:**
- TypeScript interfaces
- Command schema operations
- Pagination support

**Estimated Time:** 25-30 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET / (global list)
3. Implement GET /:channelID (channel list)
4. Implement POST /:channelID (create)
5. Implement PATCH /:channelID/:cmdID (update)
6. Implement DELETE /:channelID/:cmdID (delete)
7. Handle reserved commands (prevent deletion)
8. Build and test
9. Commit

---

### 7. referral.routes.ts (Priority 2 - Medium)

**Location:** `src/server/routes/referral.route.ts`

**Purpose:** Referral code management system

**Dependencies:**
- ✅ `UsersSchema` from `src/schemas/users.schema.ts`
- ✅ `getDragonflyClient()` from `src/utils/databases/dragonfly.database.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`
- ✅ `referral` utils from `src/utils/referral.ts`

**Functions Needed:**
- `createCampaignCode()`
- `getUserCodes()`
- `deleteCampaignCode()`
- `applyReferralCode()`
- `getReferralStats()`
- `getUserPlanType()`
- `REFERRAL_CODE_LIMITS` constant

**Endpoints:**
- `GET /referral/stats` - Get referral statistics
- `GET /referral/codes` - Get user's referral codes
- `POST /referral/codes` - Create referral code
- `POST /referral/apply` - Apply referral code
- `DELETE /referral/codes/:codeID` - Delete referral code

**Key Changes from JS:**
- TypeScript interfaces
- Referral utility integration
- Plan type validation

**Estimated Time:** 25-35 minutes

**Steps:**
1. Create helper function `getUserFromToken()`
2. Implement GET /referral/stats
3. Implement GET /referral/codes
4. Implement POST /referral/codes (with limit check)
5. Implement POST /referral/apply (with validation)
6. Implement DELETE /referral/codes/:codeID
7. Build and test
8. Commit

---

### 8. user.routes.ts (Priority 2 - Medium)

**Location:** `src/server/routes/user.route.ts`

**Purpose:** User information and operations

**Dependencies:**
- ✅ `UsersSchema` from `src/schemas/users.schema.ts`
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `getUserByLogin()` from `src/functions/users/get_user_by_login.users.ts`
- ✅ `getUserById()` from `src/functions/users/get_user_by_id.users.ts`
- ✅ `getscopes()` from `src/functions/users/get_scopes.users.ts`
- ✅ `logger` from `src/utils/logger.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`
- ✅ `incrementSiteAnalytics()` from `src/utils/siteanalytics.ts`
- ✅ `decrementSiteAnalytics()` from `src/utils/siteanalytics.ts`

**Endpoints:**
- `GET /` - Get user info by username (public)
- `GET /:channelID` - Get streamer details
- `GET /scopes/:userID` - Get user scopes
- `POST /premium` - Update premium status

**Key Changes from JS:**
- TypeScript interfaces for user data
- Site analytics updates

**Estimated Time:** 20-30 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET / (public user info)
3. Implement GET /:channelID (streamer details)
4. Implement GET /scopes/:userID
5. Implement POST /premium
6. Handle analytics updates
7. Build and test
8. Commit

---

### 9. aiPersonality.routes.ts (Priority 3 - Complex)

**Location:** `src/server/routes/aiPersonality.route.ts`

**Purpose:** Manage channel AI personality with tier-based limits

**Dependencies:**
- ✅ `ChannelAIPersonalitySchema` from `src/schemas/channel_ai_personality.schema.ts`
- ✅ `UsersSchema` from `src/schemas/users.schema.ts` (for tier info)
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /:channelID` - Get personality + tier limits
- `PUT /:channelID` - Update personality (with limit validation)
- `POST /:channelID/known-users` - Add/update known user

**Key Changes from JS:**
- TypeScript interfaces
- Tier limit enforcement logic
- Known user management

**Tier Limits:**
- Free: 3 rules, 5 known users, 3 context window
- Premium: 5 rules, 10 known users, 7 context window
- Premium+: Unlimited rules, unlimited known users, 15 context window

**Estimated Time:** 30-40 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET /:channelID (get + tier info)
3. Implement PUT /:channelID (update with validation)
4. Implement POST /:channelID/known-users (add user)
5. Add tier limit checks
6. Build and test
7. Commit

---

### 10. reward.routes.ts (Priority 3 - Complex)

**Location:** `src/server/routes/trigger.route.ts`

**Purpose:** Trigger CRUD + S3 file upload/download/delete

**Dependencies:**
- ✅ `TriggerSchema` from `src/schemas/trigger.schema.ts`
- ✅ `TriggerFileSchema` from `src/schemas/trigger_file.schema.ts`
- ✅ `RedemptionRewardSchema` from `src/schemas/redemption_reward.schema.ts`
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `uploadTriggerFileToS3()` from `src/functions/s3/triggers.s3.ts`
- ✅ `deleteTriggerFileFromS3()` from `src/functions/s3/triggers.s3.ts`
- ✅ `getUrl()` from `src/utils/dev.ts`
- ✅ `getIO()` from `src/server/websocket.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`
- ✅ `logger` from `src/utils/logger.ts`

**Acceptable MIME Types:**
- Video: mp4, mov, avi, flv, wmv, webm, mkv
- Image: gif, jpg, jpeg, png, bmp, tiff, svg, webp
- Audio: mp3, flac, wav, ogg, aac, wma, m4a

**Endpoints:**
- `GET /triggers/:channelID` - List triggers (filter by id or name)
- `POST /triggers/:channelID` - Create trigger (with Twitch reward)
- `PATCH /triggers/:channelID/:triggerID` - Update trigger
- `DELETE /triggers/:channelID/:triggerID` - Delete trigger
- `POST /triggers/:channelID/send` - Emit via websocket (for overlay)
- `POST /triggers/:channelID/upload` - Upload file (multipart/form-data)
- `GET /triggers/files/:channelID` - List uploaded files
- `DELETE /triggers/files/:channelID/:fileID` - Delete file

**File Upload Features:**
- Multer memory storage
- File size limits by tier: Free 5MB, Premium 10MB, Premium+ 20MB
- MIME type validation
- S3 upload (async)
- File name validation (a-z, A-Z, 0-9, spaces only)

**Estimated Time:** 45-60 minutes

**Steps:**
1. Create file with proper imports
2. Define acceptable MIME types array
3. Implement GET /triggers/:channelID
4. Implement POST /triggers/:channelID (create)
5. Implement PATCH /triggers/:channelID/:triggerID
6. Implement DELETE /triggers/:channelID/:triggerID
7. Implement POST /triggers/:channelID/send (websocket emit)
8. Implement POST /triggers/:channelID/upload (multipart)
9. Implement GET /triggers/files/:channelID
10. Implement DELETE /triggers/files/:channelID/:fileID
11. Add tier-based file size limits
12. Add S3 integration
13. Build and test (test file upload especially!)
14. Commit

---

### 11. reward.routes.ts (Priority 3 - Complex)

**Location:** `src/server/routes/reward.route.ts`

**Purpose:** Channel point reward management with Twitch integration

**Dependencies:**
- ✅ `RedemptionRewardSchema` from `src/schemas/redemption_reward.schema.ts`
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- ✅ `getTwitchHelixUrl()` from `src/utils/links.ts`
- ✅ `subscribeTwitchEvent()` from `src/utils/eventsub.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /:channelID` - List rewards (filter by type or id)
- `GET /twitch/:channelID` - Get rewards from Twitch API
- `POST /:channelID` - Create reward
- `PATCH /:channelID/:rewardID` - Update reward
- `DELETE /:channelID/:rewardID` - Delete reward

**Key Changes from JS:**
- TypeScript interfaces
- Twitch API integration for rewards
- EventSub subscription (channel-points:redemption-add)
- ObjectID validation

**Estimated Time:** 35-45 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET /:channelID (list from DB)
3. Implement GET /twitch/:channelID (from Twitch API)
4. Implement POST /:channelID (create + subscribe event)
5. Implement PATCH /:channelID/:rewardID
6. Implement DELETE /:channelID/:rewardID
7. Add EventSub integration
8. Build and test
9. Commit

---

### 13. site.routes.ts (Priority 3 - Complex - CHECK FIRST)

**Location:** `src/server/routes/site.route.ts`

**⚠️ ACTION REQUIRED:** Check if TypeScript version already exists!

**Check:**
```bash
ls -la /home/cdom/saas/dimabot/src-js/server/routes/site.routes.js
# Compare with existing TypeScript routes
```

**If already migrated:** SKIP and mark as done ✅

**If not migrated:**

**Purpose:** Site-wide events management

**Dependencies:**
- ✅ `EventSchema` from `src/schemas/event.schema.ts`
- ✅ `auth` from `src/middleware/auth.middleware.ts`

**Endpoints:**
- `GET /` - Empty endpoint (future use)
- `POST /events` - Create site event
- `GET /events` - List all events
- `GET /events/:type` - Get event by type
- `PATCH /events/:id` - Update event

**Estimated Time:** 20-30 minutes (if needed)

**Steps:**
1. Check if TS version exists
2. If not, create file with proper imports
3. Implement all endpoints
4. Add validation (required fields, config structure)
5. Build and test
6. Commit

---

### 14. dev.routes.ts (Priority 3 - Complex)

**Location:** `src/server/routes/dev.route.ts`

**Purpose:** Development utilities and migration tools

**Dependencies:**
- ✅ `CommandSchema` from `src/schemas/commands.schema.ts`
- ✅ `EventSubSchema` from `src/schemas/eventsub.schema.ts`
- ✅ `ChannelSchema` from `src/schemas/users.schema.ts`
- ✅ `RedemptionRewardSchema` from `src/schemas/redemption_reward.schema.ts`
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `JSONCOMMANDS` from `src/config/commands/reservedcommands.json`
- ✅ `getUrl()` from `src/utils/dev.ts`
- ✅ `getEventsubs()` from `src/utils/eventsub.ts`
- ✅ `getUserById()` from `src/functions/users/get_user_by_id.users.ts`
- ✅ `getTwitchStreamerHeaderById()` from `src/utils/header.ts`
- ✅ `getTwitchHelixUrl()` from `src/utils/links.ts`

**Endpoints:**
- `PATCH /dev/rewards/:id` - Update Twitch reward (utility endpoint)
- `GET /dev/:userId` - Get user info
- `GET /dev/eventsubs` - Get all eventsubs
- `POST /dev/rewards` - Migrate redemption rewards to all channels

**Estimated Time:** 20-25 minutes

**Steps:**
1. Create file with proper imports
2. Implement PATCH /dev/rewards/:id
3. Implement GET /dev/:userId
4. Implement GET /dev/eventsubs
5. Implement POST /dev/rewards
6. Build and test
7. Commit

---

### 15. auth.routes.ts (Priority 3 - Very Complex)

**Location:** `src/server/routes/auth.route.ts`

**Purpose:** OAuth flow, account creation/activation, EventSub subscriptions, reserved commands setup

**Dependencies:**
- ✅ `UsersSchema` from `src/schemas/users.schema.ts`
- ✅ `CommandSchema` from `src/schemas/commands.schema.ts`
- ✅ `TwitchStreamers` from `src/classes/twitch_streamers.class.ts`
- ✅ `CHANNEL.addModerator()` from `src/functions/moderation/add_moderator.moderation.ts`
- ✅ `logger` from `src/utils/logger.ts`
- ✅ `encrypt()`, `decrypt()` from `src/utils/crypto.ts`
- ✅ `subcriptionsTypes` from `src/utils/eventsub.ts`
- ✅ `subscribeTwitchEvent()` from `src/utils/eventsub.ts`
- ✅ `JSONCOMMANDS` from `src/config/commands/reservedcommands.json`
- ✅ `incrementSiteAnalytics()` from `src/utils/siteanalytics.ts`
- ✅ `ingestPolarSHEvent()`, `getPolarShClient()` from `src/utils/polarsh.ts`

**Endpoints:**
- `GET /auth/register` - OAuth callback for new accounts
- `GET /auth/reauthenticate` - OAuth callback for existing accounts
- `POST /auth/login` - Login endpoint (create account if not exists)
- `POST /auth/mock-register` - Mock OAuth flow for development

**Key Changes from JS:**
- TypeScript interfaces
- OAuth flow with token encryption
- PolarSH integration (free benefits)
- EventSub subscription batch
- Reserved commands setup
- Moderator addition
- Bot connection
- Site analytics updates

**Complex Features:**
1. OAuth token exchange with Twitch
2. Token encryption with crypto utils
3. Account activation flow
4. PolarSH free benefits credit
5. Batch EventSub subscriptions (multiple event types)
6. Reserved commands injection
7. Analytics counter updates

**Estimated Time:** 50-75 minutes

**Steps:**
1. Create file with proper imports
2. Implement GET /auth/register (OAuth flow)
3. Implement GET /auth/reauthenticate (re-auth flow)
4. Implement POST /auth/login (user creation/login)
5. Implement POST /auth/mock-register (dev mode)
6. Add token encryption
7. Add PolarSH integration
8. Add EventSub batch subscriptions
9. Add reserved commands setup
10. Add moderator addition
11. Add analytics updates
12. Build and test (test OAuth flow especially!)
13. Commit

---

## Server.ts Registration

After creating each route file, register it in `src/server/server.ts`:

```typescript
import { validationRoute } from './routes/validation.route.js';
import { overlayRoute } from './routes/overlay.route.js';
import { twitchRoute } from './routes/twitch.route.js';
import { adminRoute } from './routes/admin.route.js';
import { eventsubRoute } from './routes/eventsub.route.js';
import { commandRoute } from './routes/command.route.js';
import { referralRoute } from './routes/referral.route.js';
import { userRoute } from './routes/user.route.js';
import { aiPersonalityRoute } from './routes/aiPersonality.route.js';
import { triggerRoute } from './routes/trigger.route.js';
import { rewardRoute } from './routes/reward.route.js';
// import { siteRoute } from './routes/site.route.js'; // Check if exists
import { devRoute } from './routes/dev.route.js';
import { authRoute } from './routes/auth.route.js';

// Inside server() function, after existing routes:
validationRoute(app);
overlayRoute(app);
twitchRoute(app);
adminRoute(app);
eventsubRoute(app);
commandRoute(app);
referralRoute(app);
userRoute(app);
aiPersonalityRoute(app);
triggerRoute(app);
rewardRoute(app);
// siteRoute(app); // Check if exists
devRoute(app);
authRoute(app);
```

---

## Common Patterns to Follow

### File Structure
```typescript
import express, { type Request, type Response } from "express";
import { getDirname } from "../../utils/pollyfills.js";

const __dirname = getDirname(import.meta.url);

export const routeName = (app: express.Application): void => {
    // Implement routes
};
```

### Error Handling (AGENTS.md Pattern)
```typescript
try {
    // implementation
} catch (error) {
    console.error('Error in routeName:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        // Additional context...
    });

    res.status(500).json({
        error: true,
        message: 'Internal server error',
        status: 500
    });
}
```

### Response Format
```typescript
interface StandardResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: any;
}
```

### Import Style
```typescript
// Use .js extension for all imports
import { something } from '../utils/utilities.js';
import { SomeSchema } from '../../schemas/something.schema.js';
```

---

## Testing Guidelines

For each migrated route:

1. **Build Test:**
   ```bash
   npm run build
   ```
   Must pass without errors.

2. **Endpoint Testing:**
   - Test GET endpoints
   - Test POST endpoints
   - Test PUT/PATCH endpoints
   - Test DELETE endpoints
   - Test error handling (invalid data, missing fields)

3. **Commit Message Format:**
   ```
   Add [route name] routes

   - Implement [endpoints]
   - Use [dependencies]
   - Add [features]
   - Build verified successfully

   [Priority X] of server routes migration complete
   ```

---

## Parallel Work Strategy

### Recommended Assignment (3-4 agents):

**Agent 1: Simple Routes (Priority 1)**
- [ ] validation.routes.ts
- [ ] overlay.routes.ts
- [ ] twitch.routes.ts

**Agent 2: Medium Routes (Priority 2)**
- [ ] admin.routes.ts
- [ ] eventsub.routes.ts
- [ ] command.routes.ts

**Agent 3: Medium/Complex Routes (Priority 2-3)**
- [ ] referral.routes.ts
- [ ] user.routes.ts
- [ ] aiPersonality.routes.ts

**Agent 4: Complex Routes (Priority 3)**
- [ ] trigger.routes.ts
- [ ] reward.routes.ts
- [ ] site.routes.ts (check first)
- [ ] dev.routes.ts
- [ ] auth.routes.ts

### Coordination:
- Update checklist after each completion
- Build server.ts after all routes done
- Final test of all endpoints
- Final commit

---

## Total Estimated Time

- Priority 1: 35-50 minutes (1 agent)
- Priority 2: 90-120 minutes (1-2 agents)
- Priority 3: 5-6.5 hours (2-4 agents)

**Total: 5-9 hours** (with 3-4 agents working in parallel)

---

## Next Steps

1. **Choose your assignment** from the parallel work strategy above
2. **Check dependencies** (ensure all required schemas/utils are available)
3. **Start with Priority 1 files** (simpler, faster wins)
4. **Update checklist** after each completion
5. **Build and test** before committing
6. **Register routes** in server.ts when all done

**Remember:** Build early, build often! Catch errors before they compound.
