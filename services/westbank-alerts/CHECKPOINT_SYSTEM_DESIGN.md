# New Checkpoint System Design

## Overview
Replace the cascading fallback parser with a **whitelist-first, strict validation** approach that:
1. Loads all known checkpoints from `data/known_checkpoints.json` at startup
2. Matches incoming messages against the whitelist only
3. Validates ruthlessly, rejects unknown names
4. Properly handles direction extraction before name parsing
5. Stores only canonical_keys that exist in the known list

---

## Architecture Components

### 1. CheckpointKnowledgeBase (New)
**File**: `app/checkpoint_knowledge_base.py`

```python
class CheckpointKnowledgeBase:
    """
    Single source of truth for all known checkpoints.
    Loads from known_checkpoints.json and indexes for fast lookup.
    """
    
    def __init__(self):
        self.by_canonical_key: dict[str, dict] = {}  # key → full checkpoint data
        self.by_name_norm: dict[str, str] = {}       # normalised name → canonical key
        self.by_english: dict[str, str] = {}         # english name (lower) → canonical key
        self.aliases: dict[str, str] = {}            # alias → canonical key (from aliases field)
        self.all_names: list[tuple[str, str]] = []   # (normalised, canonical_key), sorted by length DESC
    
    async def load_from_file(self, path: Path) -> None:
        """Load from known_checkpoints.json"""
        # Parse JSON, build indexes
        # All normalisation happens here using checkpoint_parser._normalise()
    
    def find_checkpoint(self, name_ar: str) -> Optional[str]:
        """
        Try to find a known checkpoint by Arabic name.
        Returns canonical_key if found, None otherwise.
        Tries in order: exact normalised match, fuzzy match, alias.
        """
        # 1. Direct lookup (normalised)
        norm = _normalise(name_ar)
        if norm in self.by_name_norm:
            return self.by_name_norm[norm]
        
        # 2. Check aliases
        if norm in self.aliases:
            return self.aliases[norm]
        
        # 3. Fuzzy match via substring (longer names first to avoid false positives)
        for norm_known, key in self.all_names:
            if norm in norm_known or norm_known in norm:
                return key
        
        return None
    
    def get_checkpoint(self, canonical_key: str) -> Optional[dict]:
        """Return full checkpoint object if it exists."""
        return self.by_canonical_key.get(canonical_key)
    
    def is_known(self, canonical_key: str) -> bool:
        """Check if a canonical_key is in the whitelist."""
        return canonical_key in self.by_canonical_key
    
    def all_canonical_keys(self) -> list[str]:
        """Return all known canonical keys."""
        return list(self.by_canonical_key.keys())

# Global instance
_knowledge_base: Optional[CheckpointKnowledgeBase] = None

async def load_knowledge_base() -> CheckpointKnowledgeBase:
    global _knowledge_base
    kb = CheckpointKnowledgeBase()
    await kb.load_from_file(Path(__file__).parent.parent / "data" / "known_checkpoints.json")
    _knowledge_base = kb
    return kb

def get_knowledge_base() -> Optional[CheckpointKnowledgeBase]:
    return _knowledge_base
```

### 2. CheckpointTextPreprocessor (New)
**File**: `app/checkpoint_text_preprocessor.py`

```python
class CheckpointTextPreprocessor:
    """
    Preprocess raw message text before parsing.
    Handles: emoji removal, direction extraction, description cleaning.
    """
    
    @staticmethod
    def extract_directions_and_clean(text: str) -> tuple[str, Optional[str]]:
        """
        Remove direction words from text and return direction.
        Returns (cleaned_text, direction).
        """
        # Remove direction words but track which one(s) found
        # Return cleaned text and detected direction (inbound/outbound/both)
    
    @staticmethod
    def remove_descriptions(text: str, known_checkpoint: str) -> str:
        """
        Given a known checkpoint name and a message, remove descriptive phrases.
        E.g., "عطاره فوق الجسر سالك" → "عطاره سالك"
        """
        # Logic: if checkpoint is known, look for it in text
        # Remove words after it that might be location descriptions
```

### 3. CheckpointStrictValidator (New/Rewritten)
**File**: `app/checkpoint_strict_validator.py`

```python
class CheckpointStrictValidator:
    """
    Validate that a parsed checkpoint is legitimate.
    Returns (is_valid, reason).
    """
    
    @staticmethod
    def validate(name_ar: str, status: str, direction: Optional[str]) -> tuple[bool, str]:
        """
        Reject if any of these are true:
        1. name_ar is empty or < 2 chars after normalisation
        2. name_ar contains any status word (سالك, مغلق, ازمه, etc.)
        3. name_ar is pure direction word
        4. name_ar is pure filler/greeting
        5. name_ar has > 4 words
        6. status is unknown (not in STATUS_MAP or EMOJI_STATUS)
        7. name_ar matches known "bad patterns" (sentences, numbers-only, etc.)
        """
        # Implement all checks
        return True, "OK" if valid else (False, reason)
```

### 4. CheckpointWhitelistParser (Rewritten)
**File**: `app/checkpoint_whitelist_parser.py`

```python
async def parse_message_whitelist(text: str, knowledge_base: CheckpointKnowledgeBase) -> list[dict]:
    """
    Main entry point for parsing messages with whitelist approach.
    
    Flow:
    1. For each line in the message:
       a. Try colon-format parsing first (admin messages)
       b. Extract direction words and clean text
       c. Extract status (emoji or word-based)
       d. Extract name from remaining text
       e. Validate name (strict rules)
       f. Query whitelist: does this checkpoint exist?
       g. If yes, store result with canonical_key from whitelist
       h. If no, reject (optionally log for review)
    2. Deduplicate results by (canonical_key, direction)
    3. Return list of validated updates
    """
    
    results = []
    seen_keys: set[str] = set()
    
    for line in text.split("\n"):
        line_stripped = line.strip()
        if not line_stripped or _is_skippable(line_stripped):
            continue
        
        # 1. Try colon format (for admin lists)
        if ":" in line_stripped:
            parsed = parse_colon_line_strict(line_stripped, knowledge_base)
            if parsed is not None:
                items = parsed if isinstance(parsed, list) else [parsed]
                for item in items:
                    if item is not None:
                        dedup_key = (item["canonical_key"], item.get("direction", ""))
                        if dedup_key not in seen_keys:
                            results.append(item)
                            seen_keys.add(dedup_key)
                continue
        
        # 2. Try word-based parsing with whitelist lookup
        parsed = parse_line_whitelist(line_stripped, knowledge_base)
        if parsed is not None:
            dedup_key = (parsed["canonical_key"], parsed.get("direction", ""))
            if dedup_key not in seen_keys:
                results.append(parsed)
                seen_keys.add(dedup_key)
    
    return results


def parse_colon_line_strict(line: str, knowledge_base: CheckpointKnowledgeBase) -> Optional[dict | list[dict]]:
    """
    Strict version of colon-line parser that validates against whitelist.
    
    Returns parsed dict(s) only if checkpoint name matches whitelist.
    """
    # Parse as before, but before returning, validate:
    # - Query whitelist with extracted checkpoint name
    # - If found, return canonical_key from whitelist
    # - If not found, return None (reject)


def parse_line_whitelist(line: str, knowledge_base: CheckpointKnowledgeBase) -> Optional[dict]:
    """
    Strict version of word-based parser with whitelist validation.
    """
    # 1. Preprocess: extract directions, clean emojis
    # 2. Extract status (emoji or word-based)
    # 3. Extract candidate name from remaining tokens
    # 4. Validate name (strict rules)
    # 5. Query whitelist: does this checkpoint exist?
    # 6. If yes, return parsed dict with canonical_key from whitelist
    # 7. If no, return None (reject with optional logging)
```

### 5. Integration Points

**Update `app/main.py`**:
- Load `CheckpointKnowledgeBase` at startup (async init)
- Pass knowledge_base to all checkpoint parsing functions
- Log rejected names (for later review/whitelist expansion)

**Update message handlers** (wherever Telegram messages are processed):
- Call `parse_message_whitelist()` instead of old `parse_message()`
- Store results immediately with canonical_key validation

---

## Data Flow (New)

```
Raw Telegram Message
        ↓
    [Preprocess]
    • Remove greetings
    • Extract direction words
    • Clean emojis
    • Remove obvious filler
        ↓
    [Split by line]
        ↓
    For each line:
        ├→ [Try colon format]
        │  ├→ Extract name, status, direction
        │  ├→ Query whitelist
        │  └→ If found: return with canonical_key
        │
        ├→ [Try word-based format]
        │  ├→ Extract status (emoji or word)
        │  ├→ Extract name from remaining
        │  ├→ Query whitelist
        │  └→ If found: return with canonical_key
        │
        └→ [Reject if not in whitelist]
        
        ↓
    [Validate strictly]
    • No status words in name ✗
    • No direction words in name ✗
    • No filler words in name ✗
    • Proper word count ✓
        ↓
    [Deduplicate by (canonical_key, direction)]
        ↓
    [Store to DB with validated canonical_key]
```

---

## Configuration

### Status Words Rejection List
From checkpoint_parser.py, define what words invalidate a name:

```python
INVALID_IN_NAME = {
    # From STATUS_MAP
    "سالك", "سالكه", "مفتوح", "مغلق", "مقفل", "زحمه", 
    "بطيء", "جيش", "عسكر", "مداهمه",
    # From DIRECTION_WORDS
    "الداخل", "الخارج", "داخل", "خارج", "دخول", "خروج", "بالاتجاهين",
    # From FILLER_WORDS
    "الحمدلله", "يعينكم", "شباب", "اخوان", "الله", "في", "على", "من",
}
```

### Soft Reject (Log for Review)
- Unknown checkpoint name (not in whitelist)
- Fuzzy match confidence < threshold
- Could be valid but new checkpoint

---

## Testing Strategy

### Unit Tests
1. `test_checkpoint_knowledge_base.py`
   - Loading from known_checkpoints.json
   - Lookup by different methods
   - Whitelist queries

2. `test_checkpoint_strict_validator.py`
   - Reject status-contaminated names
   - Reject direction-only names
   - Reject filler words
   - Accept valid names

3. `test_checkpoint_whitelist_parser.py`
   - Colon format with whitelist validation
   - Word-based with whitelist validation
   - Direction extraction before name parsing
   - Deduplication

### Integration Tests
1. Parse real messages from DB (checkpoint_updates.raw_message)
2. Verify all results have canonical_key in whitelist
3. Verify deduplication works (no (key, direction) duplicates)
4. Compare output: old parser vs new parser
5. Measure: % of messages correctly parsed before and after

### Regression Tests
1. All 160 known checkpoints should still be parseable
2. Fuzzy matching should handle common spelling variations
3. Aliases should work as configured in known_checkpoints.json

---

## Migration & Rollout

### Phase 1: Silent Parallel Run (2-3 days)
- Deploy new parser code
- Parse incoming messages with BOTH old and new
- Log differences (what did old parse that new rejected?)
- Identify false negatives and adjust whitelist/fuzzy matching

### Phase 2: Gradual Transition (1-2 days)
- Switch new messages to use new parser
- Keep old parser as fallback for unknown checkpoints
- Track reject rate (should be low if whitelist is good)

### Phase 3: Database Cleanup
- Once confident with new parser:
  - Identify all canonical_keys not in whitelist
  - For each, try to match to known checkpoints (fuzzy)
  - Merge status updates
  - Delete orphaned entries
  - Verify checkpoint count drops from 1,174 → ~160

### Phase 4: Full Cutover
- Remove old parser code
- Archive old parser for reference

---

## Rollback Plan
- If new parser is rejecting too many valid messages:
  - Expand whitelist (add new legitimate checkpoints to known_checkpoints.json)
  - Adjust fuzzy matching threshold
  - Improve alias definitions
- If wrong canonical_keys are being assigned:
  - Check whitelist lookup logic
  - Verify deduplication key generation
  - Review test cases

---

## Monitoring & Observability

### Metrics to Track
1. % of messages with at least one parsed checkpoint
2. % of messages completely rejected (no valid checkpoints)
3. Distribution of parsed statuses (open, closed, congested, military)
4. Top 10 most frequently seen checkpoint names in raw messages
5. Number of unique canonical_keys stored per day

### Logging
- Log every rejected message with reason
- Log fuzzy matches and confidence scores
- Log new checkpoints that don't match whitelist (for review)
- Track parsing errors/exceptions

### Frontend Impact
- Monitor checkpoint count in map (should stabilize around 160)
- Monitor deduplication effectiveness
- Check for missing updates on known checkpoints

---

## Success Criteria
1. ✓ Checkpoint count in DB: 1,174 → ~160 (within 10%)
2. ✓ All stored canonical_keys exist in known_checkpoints.json
3. ✓ Zero status-word-contaminated names
4. ✓ Zero direction-word-contaminated names
5. ✓ Frontend map shows correct number of checkpoints
6. ✓ No false negatives (all valid messages are parsed)
7. ✓ Parsing accuracy > 95% vs manual review
