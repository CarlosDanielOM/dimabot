# Plan: Migrate clip.routes.js to TypeScript and Copy HTML Files

## Overview
Migrate the old JavaScript clip routes to TypeScript and ensure HTML files are correctly copied to the new src folder structure.

---

## Analysis of Old System

### Old Routes (`src-js/server/routes/clip.routes.js`):
1. **GET `/:channelID`** - Serves clip.html with custom design support
2. **POST `/test`** - Test endpoint for promo command
3. **POST `/:channelID`** - Old clip download system (HTTP POST) - **DEPRECATED**

### Old HTML Files (`src-js/server/routes/public/`):
- `clip.html` - Main clip overlay
- `furry.html` - Furry overlay
- `speach.html` - Speech overlay
- `sumimetro.html` - Sumimetro overlay
- `trigger.html` - Trigger overlay
- `assets/` - Static assets folder

### ClipDesign Schema (`schema/clipDesign.js`):
- Stores custom clip designs
- Fields: name, channelID, channel, cssUrl, isPublic, isDefault
- Not yet migrated to TypeScript

---

## New System Changes

### Routes to Implement:
1. **GET `/:channelID`** - Serve clip.html (with design parameter)
   - Support `?design=1/2/3` for default designs
   - Support `?design=<custom_id>` for custom designs (skip for now)
   - For now, only support default designs 1, 2, 3

2. **POST `/test`** - Test endpoint for promo command
   - Calls `promo()` function from TypeScript
   - Returns result as JSON
   - Useful for testing

3. **REMOVED** - POST `/:channelID`
   - Old HTTP POST system replaced by pub/sub
   - No longer needed

---

## Files to Create

### 1. `src/server/routes/public/` directory
**Purpose**: Store HTML files for overlays

**Action**: Create directory if doesn't exist

**Files to Copy**:
```
src-js/server/routes/public/clip.html → src/server/routes/public/clip.html
src-js/server/routes/public/furry.html → src/server/routes/public/furry.html
src-js/server/routes/public/speach.html → src/server/routes/public/speach.html
src-js/server/routes/public/sumimetro.html → src/server/routes/public/sumimetro.html
src-js/server/routes/public/trigger.html → src/server/routes/public/trigger.html
src-js/server/routes/public/assets/ → src/server/routes/public/assets/
```

---

### 2. `src/server/routes/clip.route.ts`
**Purpose**: Serve clip overlay HTML and test endpoint

**TypeScript Interface**:
```typescript
import express, { type Request, type Response } from "express";
import { promo } from "../functions/promo/index.js";
import path from "path";
import { getDirname } from "../../utils/pollyfills.js";

export const clipRoute = (app: express.Application): void => {
    const __dirname = getDirname(import.meta.url);
    const htmlPath = path.join(__dirname, 'routes', 'public');

    // GET /clip/:channelID - Serve clip.html
    app.get('/clip/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const designId = req.query.design as string;

            // For now, only support default designs (1, 2, 3)
            // Custom designs will be added when ClipDesign schema is migrated
            if (designId && designId !== '1' && designId !== '2' && designId !== '3') {
                // Serve default design if invalid design ID
                return res.status(200).sendFile(path.join(htmlPath, 'clip.html'));
            }

            res.status(200).sendFile(path.join(htmlPath, 'clip.html'));
        } catch (error) {
            console.error('Error serving clip page:', {
                channelID: req.params.channelID,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
            res.status(500).json({
                error: true,
                message: 'Error loading clip page',
                status: 500
            });
        }
    });

    // POST /clip/test - Test endpoint for promo
    app.post('/clip/test', async (req: Request, res: Response) => {
        try {
            const { channelID, streamer } = req.body;

            if (!channelID || !streamer) {
                return res.status(400).json({
                    error: true,
                    message: 'channelID and streamer are required',
                    status: 400
                });
            }

            const result = await promo(channelID, streamer);

            if (result.error) {
                return res.status(result.status || 500).json(result);
            }

            res.status(200).json(result);
        } catch (error) {
            console.error('Error in clip test:', {
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });
};
```

**Key Features**:
- Serves clip.html with optional design parameter
- Test endpoint uses new `promo()` function
- Custom designs deferred to future migration
- Proper error handling and logging
- File paths use absolute path resolution

---

### 3. Update `src/server/server.ts`
**Purpose**: Register clip routes

**Add import**:
```typescript
import { clipRoute } from "./routes/clip.route.js";
```

**Add to initialization** (after fileRoute):
```typescript
// Setup clip routes
clipRoute(app);
```

---

## Implementation Order

### Step 1: Create Public Directory
1. Create `src/server/routes/public/` directory
2. Create `src/server/routes/public/assets/` directory (if needed)
3. Copy HTML files from old location
4. Copy assets folder

### Step 2: Create Clip Routes
1. Create `src/server/routes/clip.route.ts`
2. Implement GET `/:channelID` route
3. Implement POST `/test` route
4. Run `npm run build` to verify

### Step 3: Register Routes
1. Update `src/server/server.ts` to import clipRoute
2. Call `clipRoute(app)` to register routes
3. Run `npm run build` to verify

### Step 4: Test
1. Test clip.html page loads
2. Test design parameter works (1, 2, 3)
3. Test /clip/test endpoint
4. Verify OBS can connect via WebSocket

---

## File Summary

### Files to Create:
1. `src/server/routes/public/` - Directory for HTML files
2. `src/server/routes/clip.route.ts` - Clip routes

### Files to Copy (HTML):
1. `clip.html` - Main clip overlay
2. `furry.html` - Furry overlay
3. `speach.html` - Speech overlay
4. `sumimetro.html` - Sumimetro overlay
5. `trigger.html` - Trigger overlay
6. `assets/` - Static assets (entire folder)

### Files to Update:
1. `src/server/server.ts` - Import and register clip routes

---

## Notes

### Custom Designs Deferred:
- ClipDesign schema not yet migrated to TypeScript
- For now, only support default designs (1, 2, 3)
- Future task: Migrate ClipDesign schema and enable custom designs

### Old POST Endpoint Removed:
- The `POST /clip/:channelID` route is deprecated
- Replaced by pub/sub system
- No longer needed in new implementation

### HTML Compatibility:
- Existing HTML files work with new WebSocket system
- No changes needed to HTML files
- Just need to be copied to correct location

### Static File Serving:
- Server already configured to serve static files from `src/server/routes/public`
- No additional configuration needed
- HTML files accessible via `/clip/{channelID}`

---

## Dependencies

- `express` - HTTP routing
- `path` - File path handling
- `../functions/promo/index.js` - Promo function
- `../../utils/pollyfills.js` - getDirname utility
