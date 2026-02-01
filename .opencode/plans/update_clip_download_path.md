# Plan: Update Clip Download Path and Disable Startup Cleanup

## Overview
Update the clip download directory path to point to the new TypeScript location and disable startup cleanup temporarily during testing phase.

---

## Changes Required

### 1. Update `src/utils/video.ts`
**Purpose**: Update download directory path and ensure it exists

**Change**: Modify the `downloadClip` function to use absolute path to `./src/server/routes/public/downloads`

**Current Code**:
```typescript
const downloadDir = `${process.cwd()}/server/routes/public/downloads`;
```

**New Code**:
```typescript
const absoluteDownloadDir = `${process.cwd()}/src/server/routes/public/downloads`;
```

**Implementation**:
1. Create absolute path to new location
2. Check if directory exists
3. Create directory if it doesn't exist (already done in current code)
4. Use this absolute path for file operations

**Note**: The current code already has directory creation logic (`fs.mkdirSync(downloadDir, { recursive: true })`), just needs path update.

---

### 2. Update `src/server/index.ts`
**Purpose**: Comment out startup cleanup during testing phase

**Change**: Comment out the `startupCleanup()` call and add TODO comment

**Current Code**:
```typescript
// Initialize clip queue handler
await clipQueueHandler.init();

// Run startup cleanup for clip queue
await clipQueueHandler.startupCleanup();
```

**New Code**:
```typescript
// Initialize clip queue handler
await clipQueueHandler.init();

// Run startup cleanup for clip queue
// TODO: Reactivate startup cleanup when testing is complete
// await clipQueueHandler.startupCleanup();
```

**Reason**: Multiple restarts during testing phase, don't want to clear queue data prematurely.

---

### 3. Update `src-js/server/routes/public/clip.html` (Optional)
**Purpose**: Verify HTML is compatible with new system

**Current Behavior**:
- Uses `socket.on('play-clip', ...)` to receive clip data ✅ (compatible)
- Downloads from: `https://api.domdimabot.com/video/clip/${channelID}` or `http://localhost:3000/video/clip/${channelID}`

**Analysis**:
- HTML is already compatible with WebSocket pub/sub system ✅
- The `play-clip` event is correctly handled ✅
- The `clip-ended` event is correctly emitted back ✅
- Video URL might need verification with new download path

**Potential Issue**:
The old system served videos via HTTP endpoint `/video/clip/:channelID`. The new system downloads clips locally and serves them via static file serving.

**Options**:
1. **Option A**: Serve clips via static file (recommended)
   - Videos are downloaded to `src/server/routes/public/downloads/{channelID}-clip.mp4`
   - Configure Express to serve static files from `src/server/routes/public`
   - HTML uses `/downloads/{channelID}-clip.mp4` path

2. **Option B**: Keep using video endpoint
   - Need to create `/video/clip/:channelID` route in new system
   - Route reads file from `src/server/routes/public/downloads/{channelID}-clip.mp4`
   - Streams file as response

**Recommended**: Option B - Create a new video route that serves from the new download location. This maintains compatibility with existing HTML and OBS browser sources.

---

## Implementation Order

### Step 1: Update Video Utility
1. Edit `src/utils/video.ts`
2. Update download directory path to `src/server/routes/public/downloads`
3. Ensure directory creation logic uses correct path
4. Run `npm run build` to verify

### Step 2: Comment Out Startup Cleanup
1. Edit `src/server/index.ts`
2. Comment out `startupCleanup()` call
3. Add TODO comment for future reactivation
4. Run `npm run build` to verify

### Step 3: (Optional) Create Video Route
1. Create new route `/video/clip/:channelID` in `src/server/server.ts` or `src/server/routes/`
2. Route reads file from `src/server/routes/public/downloads/{channelID}-clip.mp4`
3. Stream file as video/mp4 response
4. Run `npm run build` to verify

---

## Files to Modify

1. **`src/utils/video.ts`** - Update download path
2. **`src/server/index.ts`** - Comment out startup cleanup
3. **(Optional)** `src/server/server.ts` or new route file - Create video serving route

---

## Notes

- Download directory will be created automatically if it doesn't exist
- Startup cleanup is temporary disabled for testing purposes
- HTML file should work with new WebSocket system without changes
- Video serving may need a new route or static file configuration
