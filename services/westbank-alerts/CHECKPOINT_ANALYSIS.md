# Checkpoint System Analysis & Corruption Report

## Current State
- **Total checkpoints in DB**: 1,174 (bloated with corrupted data)
- **Curated known checkpoints**: ~160 (source of truth)
- **Problem**: Database has 1,000+ bad canonical_key entries that shouldn't exist

## Root Causes of Corruption

### 1. **Greetings & Filler Words Being Parsed as Checkpoints**
Examples from database:
- `يعطيك_العافيه` — "May you be given health" (greeting)
- `صباح_الخير` — "Good morning"
- `اخي_...` — "Brother/my friend" (filler prefix)

**Source**: Parser doesn't properly filter greeting prefixes before attempting to extract names.

### 2. **Status Words Contaminating Checkpoint Names**
Examples:
- `نظيفه_عالاخر` — "clean at the end" (description, not a name)
- `ازمه` — "congested" (status word!)
- `اشارات_الفندق_ونظيفه` — "intersection and clean" (status mixed in)
- `مغلق_بالاتجاهين` — "closed both directions" (pure status!)

**Source**: Parser isn't validating that extracted names don't contain status words.

### 3. **Multiple Checkpoints in One Line → False Splits**
Raw message: `"مفرق رنتيس و عابود ودير ابو مشعل ✅✅✅"`
Parsed as 3 separate entries:
- `رنتيس` ✅
- `عابود` ✅
- `دير_ابو_مشعل` ✅

**Problem**: This is a junction of 3 checkpoints, should be recognized as such or consolidated.

### 4. **Direction Words Mixed Into Names**
Raw: `"دير شرف عل الخارج ازمه"`
Some parsers extract: `"دير_شرف_عل_الخارج"` instead of:
- Name: `دير شرف`
- Direction: `الخارج`
- Status: `ازمه`

**Source**: Direction extraction happens after name parsing, so direction words contaminate the name.

### 5. **Typos & Spelling Variations**
- `ترمسعيا` vs `ترمسعيه` vs `ترمصعيا`
- `عطاره` vs `عطارة` vs `عطارة فوق الجسر` vs `عطاره بيرزيت`
- `ديرستيا` vs `دير_استيا` vs `دير استيا`
- `جباره` vs `جبارة`

**Source**: No canonical normalization before storing to DB.

### 6. **Descriptions Appended to Names**
Raw: `"عطاره فوق الجسر سالك"` → parsed name: `عطاره فوق الجسر`
But the checkpoint is just `عطاره`, location description shouldn't be part of the canonical name.

**Source**: Parser treats multi-word strings as single names without validating against known list.

### 7. **Duplicate Entries for Same Checkpoint**
Example: عطاره (عطارة)
- Stored with 2 different `name_ar` variations
- Each gets a separate canonical_key entry (but shouldn't!)
- Frontend aggregates by canonical_key, so if there's a mismatch, duplicates appear

**Source**: No pre-lookup against known_checkpoints.json before creating new canonical keys.

---

## Frontend Impact
The increasing checkpoint count on the map is due to:
1. Each corrupted canonical_key is treated as a separate checkpoint
2. The frontend fetches all checkpoints from the DB
3. No deduplication happens at the frontend level
4. Result: 1,174 "checkpoints" instead of ~160 real ones

---

## Solution Strategy

### Phase 1: Whitelist-First Parsing
- **Only accept** checkpoint names that match known_checkpoints.json (with fuzzy/variant matching)
- **Reject** anything that doesn't match the whitelist
- Build a proper **alias system** from known checkpoints' variants

### Phase 2: Strict Validation
For each parsed checkpoint:
1. **Reject if**: name contains any status word (سالك, مغلق, زحمه, etc.)
2. **Reject if**: name is pure direction word (الداخل, الخارج)
3. **Reject if**: name is filler/greeting (يعطيك, صباح, اخي, etc.)
4. **Reject if**: name is too short (<3 chars) or too long (>4 words)
5. **Reject if**: name doesn't match known checkpoint after normalization

### Phase 3: Better Deduplication
- Index all known checkpoints by:
  - Normalized name (normalise() function output)
  - English name
  - Aliases (from known_checkpoints.json)
- When parsing a message, **match against index first**
- Return only the canonical_key from known list, not a new made-up key

### Phase 4: Direction Extraction
- Extract direction words **before** attempting name parsing
- Remove direction words from the text being parsed for checkpoint name
- Direction should be in a separate field, not part of the name

### Phase 5: Database Cleanup & Migration
- Identify all canonical_keys in DB that don't exist in known_checkpoints.json
- Merge their status updates into the correct canonical_key (via fuzzy matching if needed)
- Delete orphaned entries
- Rebuild checkpoint table with proper aggregation

---

## Example: How It Should Work

**Raw message**: `"عين سينيا سالكه بالاتجاهين ✅️✅️"`

### Current (Broken) Flow:
1. Extract all words: [عين, سينيا, سالكه, بالاتجاهين]
2. Try to find status word at end: `بالاتجاهين` → not a status word
3. Backtrack, find `سالكه` → status: "open"
4. Name = everything before status = "عين سينيا بالاتجاهين"
5. Create canonical_key = "عين_سينيا_بالاتجاهين" ← **WRONG!**

### New (Fixed) Flow:
1. **Preprocess**: Extract direction words from context (بالاتجاهين)
2. Remove direction from text: "عين سينيا سالكه"
3. Extract status: سالكه → "open"
4. Extract name: "عين سينيا"
5. **Query whitelist**: Does "عين_سينيا" exist in known_checkpoints.json?
   - YES! Canonical key = "عين_سينيا" ✓
6. Store: 
   - canonical_key: "عين_سينيا" ✓
   - name_raw: "عين سينيا" (what user said)
   - status: "open"
   - direction: "both" (from بالاتجاهين)
   - status_raw: "سالكه ✅"

---

## Data Quality Targets
- Reduce checkpoints in DB from 1,174 → ~160
- Ensure 100% of stored checkpoints match known_checkpoints.json
- Eliminate all status-word contaminated names
- Proper direction/description extraction
- Frontend map shows exactly 160 checkpoints (or fewer if not all receive updates)
