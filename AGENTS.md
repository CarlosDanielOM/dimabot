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

## Emergency Procedures

If accidental data loss occurs:

1. **IMMEDIATELY** stop all destructive operations
2. **REPORT** the issue clearly to the user
3. **DO NOT** attempt recovery without permission
4. **DOCUMENT** what happened for transparency

---

## Reminder

**READ-ONLY on data stores. WRITE ONLY with permission.**
