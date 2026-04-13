# Checkpoint System Overhaul — Complete Guide

## Overview

This document describes the new checkpoint parsing system designed to replace corrupted data (1,174 bad entries) with clean, validated checkpoints (160 known).

**Status**: ✅ **Implementation Complete** — All 23 tests passing

## Problem We Solved

The old checkpoint system was too permissive, accepting any text as a checkpoint name. This led to:

- ❌ Greetings parsed as checkpoints: "يعطيك العافيه" (May you be given health)
- ❌ Status words contaminating names: "عين سينيا سالكه" → name="عين سينيا سالكه"
- ❌ Multiple checkpoints split wrong: "رنتيس و عابود" → 2 separate entries
- ❌ Direction words in names: "دير شرف عل الخارج" → name="دير شرف عل الخارج"
- ❌ Duplicates not merged: "عطاره" and "عطارة" treated as separate checkpoints
- ❌ Typos not normalized: "ترمسعيا", "ترمسعيه", "ترمصعيا" all separate entries

**Result**: Frontend map showed 1,174 "checkpoints" instead of 160 real ones.

## New Architecture

### Core Components

#### 1. **CheckpointKnowledgeBase** (`app/checkpoint_knowledge_base.py`)
Whitelist-first approach. Only accepts checkpoints in `data/known_checkpoints.json`.

```python
from app.checkpoint_knowledge_base import load_knowledge_base, get_knowledge_base

# At startup:
kb = await load_knowledge_base()

# To look up a checkpoint:
canonical_key = kb.find_checkpoint("عين سينيا")  # Returns "عين_سينيا"
checkpoint_data = kb.get_checkpoint("عين_سينيا")  # Returns full dict
is_known = kb.is_known("عين_سينيا")  # Returns True/False
```

#### 2. **CheckpointStrictValidator** (`app/checkpoint_strict_validator.py`)
Validates that names don't contain status/direction/filler words.

```python
from app.checkpoint_strict_validator import CheckpointStrictValidator

is_valid, reason = CheckpointStrictValidator.validate_name("عين سينيا")
# Returns (True, "OK") or (False, "contains status word: سالكه")
```

#### 3. **CheckpointWhitelistParser** (`app/checkpoint_whitelist_parser.py`)
Main parsing function — only accepts checkpoints in whitelist.

```python
from app.checkpoint_whitelist_parser import parse_message_whitelist
from app.checkpoint_knowledge_base import get_knowledge_base

kb = get_knowledge_base()
results = parse_message_whitelist("عين سينيا سالكه ✅", kb)
# Returns: [{
#   "canonical_key": "عين_سينيا",
#   "name_raw": "عين سينيا",
#   "status": "open",
#   "status_raw": "سالكه",
#   "direction": None,
#   "raw_line": "عين سينيا سالكه ✅"
# }]
```

## Integration Points

### 1. Application Startup

In `app/main.py` or similar:

```python
from fastapi import FastAPI
from app.checkpoint_knowledge_base import load_knowledge_base

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    # Load the checkpoint whitelist at startup
    await load_knowledge_base()
    # ... other startup code ...
```

### 2. Message Processing

When messages arrive from Telegram channels:

```python
from app.checkpoint_whitelist_parser import parse_message_whitelist
from app.checkpoint_knowledge_base import get_knowledge_base

async def process_checkpoint_message(msg_text: str, msg_id: int, source_channel: str):
    kb = get_knowledge_base()
    
    # Parse with whitelist validation
    results = parse_message_whitelist(msg_text, kb)
    
    # Store results
    for checkpoint_update in results:
        await store_checkpoint_update(
            canonical_key=checkpoint_update["canonical_key"],
            name_raw=checkpoint_update["name_raw"],
            status=checkpoint_update["status"],
            status_raw=checkpoint_update["status_raw"],
            direction=checkpoint_update["direction"],
            source_type="admin",  # or "crowd"
            source_channel=source_channel,
            source_msg_id=msg_id,
            raw_line=checkpoint_update["raw_line"],
            raw_message=msg_text,
            timestamp=datetime.now()
        )
```

### 3. Database Schema

The existing schema is compatible. Key fields:

**checkpoints** table:
- `canonical_key` (PRIMARY KEY) — must exist in whitelist ✓
- `name_ar` — validated name ✓
- `name_en`
- Others (region, type, geo, etc.)

**checkpoint_updates** table:
- `canonical_key` — points to whitelist ✓
- `name_raw` — what user said
- `status` — validated status
- `direction` — inbound/outbound/both
- `source_type` — admin/crowd
- Other metadata

**checkpoint_status** table:
- `canonical_key`, `direction` — primary key for dedup
- `status` — current status
- Others (confidence, crowd_reports, etc.)

## Test Coverage

All 23 tests passing in `test_checkpoint_whitelist.py`:

```bash
pytest test_checkpoint_whitelist.py -v
# 23 passed in 0.08s

# Test categories:
# - Strict validator: 7 tests
# - Knowledge base: 5 tests
# - Whitelist parser: 11 tests
```

Run tests:

```bash
.venv/bin/python -m pytest test_checkpoint_whitelist.py -v
```

## Migration & Cleanup

### Step 1: Dry Run (see what will change)

```bash
python checkpoint_migration.py --dry-run --verbose
```

Output shows:
- How many checkpoints will be merged
- Which unknown checkpoints could be fuzzy-matched
- Which will remain unmatched (for review)

### Step 2: Backup Database

```bash
cp data/checkpoints.db data/checkpoints.db.backup
```

### Step 3: Run Migration

```bash
python checkpoint_migration.py
```

This will:
- ✅ Merge updates from 1,014 unknown keys → 160 known keys
- ✅ Remove duplicate (canonical_key, direction) pairs
- ✅ Delete orphaned checkpoint entries
- ✅ Generate final report

### Step 4: Verify

```bash
sqlite3 data/checkpoints.db "SELECT COUNT(DISTINCT canonical_key) FROM checkpoints;"
# Should show: 160 (or close to it)
```

## Configuration

### Valid Statuses

```python
CheckpointStatus = {
    "open": "سالك, مفتوح",
    "closed": "مغلق, مقفل, موقوف",
    "congested": "زحمه, ازمة, مزدحم",
    "slow": "بطيء",
    "military": "جيش, عسكر, مداهمة",
    "unknown": "?"
}
```

### Valid Directions

```python
Direction = {
    "inbound": "الداخل, للداخل, دخول",
    "outbound": "الخارج, للخارج, خروج",
    "both": "بالاتجاهين"
}
```

### Emoji Status Map

```
✅ 🟢 → open
❌ 🚫 ⛔ 🔴 → closed
🟠 → congested
🟡 → slow
🟣 → military
```

## Data Quality Metrics

**Before Migration**:
- Checkpoints: 1,174 (many corrupted)
- Status contamination: >300 entries
- Duplicates: ~100+
- Frontend map: ❌ Shows wrong number

**After Migration**:
- Checkpoints: ~160 (all valid)
- Status contamination: ✅ 0
- Duplicates: ✅ 0
- Frontend map: ✅ Accurate count

## Rejection Patterns

The parser rejects lines that:

1. ❌ No status found: "عين سينيا" (needs status emoji or word)
2. ❌ Unknown checkpoint: "checkpoint_that_doesnt_exist سالك"
3. ❌ Status-contaminated name: validator prevents this
4. ❌ Too many words: "a b c d e f" (>4 words)
5. ❌ Pure direction: "الداخل" (only direction, no name)
6. ❌ Pure filler: "الحمدلله" (greeting, not name)

**These are intentional rejections** to ensure data quality.

## Logging & Debugging

Enable debug logging to see what's happening:

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Then see messages like:
# DEBUG:checkpoint_whitelist_parser:Rejected name 'عين سينيا سالكه': contains status word: سالكه
# DEBUG:checkpoint_whitelist_parser:Unknown checkpoint: 'fake_name'
```

## Frontend Integration

The frontend should:

1. ✅ Still query `/api/checkpoints` as before
2. ✅ Receive ~160 checkpoints instead of 1,174
3. ✅ Show accurate status counts per region
4. ✅ No more duplicate entries on the map
5. ✅ Better real-time updates (less noise)

## Known Limitations

1. **New valid checkpoints**: If a new checkpoint becomes active but isn't in `known_checkpoints.json`, it will be rejected with `Unknown checkpoint` in logs. Review logs and add to whitelist if legitimate.

2. **Typos in whitelist**: If `known_checkpoints.json` has typos, fuzzy matching might not find them. Review unmatched entries post-migration.

3. **Aliases**: The whitelist supports aliases (variant spellings). Keep aliases updated in `known_checkpoints.json`.

## Maintenance

### Adding New Checkpoints

Edit `data/known_checkpoints.json`:

```json
{
  "canonical_key": "new_checkpoint",
  "name_ar": "الاسم بالعربية",
  "name_en": "English Name",
  "region": "region_code",
  "checkpoint_type": "checkpoint",
  "latitude": 31.9830,
  "longitude": 35.2240,
  "aliases": ["variant1", "variant2"]
}
```

Reload knowledge base: Restart the application.

### Updating Status Vocabulary

If new status words appear (e.g., نيه, لاسالك), add to:
- `app/checkpoint_parser.py` → `STATUS_MAP`
- `app/checkpoint_strict_validator.py` → `INVALID_STATUS_WORDS`

### Debugging Unknown Messages

Check logs:

```bash
tail -f logs/checkpoint_whitelist_parser.log | grep "Unknown checkpoint"
```

This shows what's being rejected and why.

## Rollback Plan

If something breaks:

```bash
# Restore from backup
cp data/checkpoints.db.backup data/checkpoints.db

# Switch back to old parser (if not deleted):
# Revert commits, restart app
```

The old parser code is still in git history if needed.

## Questions & Support

See:
- `CHECKPOINT_ANALYSIS.md` — Problem diagnosis
- `CHECKPOINT_SYSTEM_DESIGN.md` — Architecture details
- `test_checkpoint_whitelist.py` — Working examples
- `checkpoint_migration.py` — Cleanup tool

---

**Status**: ✅ Ready for production deployment
