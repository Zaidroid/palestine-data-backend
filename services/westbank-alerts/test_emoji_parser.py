#!/usr/bin/env python3
"""
Test the checkpoint parser — word-based, emoji-based, and edge cases.
Run: python test_emoji_parser.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.checkpoint_parser import (
    parse_line, parse_emoji_line, parse_message,
    is_admin_message, make_canonical_key,
    _has_status_emoji, _clean_checkpoint_name, _strip_emojis,
)

passed = 0
failed = 0

def test(name, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  \u2705 {name}")
    else:
        failed += 1
        print(f"  \u274c {name}")
        print(f"     Expected: {expected}")
        print(f"     Got:      {actual}")

# ── Word-based parsing (existing, should still work) ──────────────────────

print("\n\u2500\u2500 Word-based parsing \u2500\u2500")

r = parse_line("\u0627\u0646\u0634\u064a\u0647 \u0633\u0627\u0644\u0643\u0647")
test("Admin line: \u0627\u0646\u0634\u064a\u0647 \u0633\u0627\u0644\u0643\u0647 \u2192 open", r["status"], "open")
test("Admin line: name extraction", r["name_raw"], "\u0627\u0646\u0634\u064a\u0647")

r = parse_line("\u0645\u0631\u0627\u062d \u0631\u064a\u0627\u062d \u0645\u063a\u0644\u0642")
test("Admin line: \u0645\u0631\u0627\u062d \u0631\u064a\u0627\u062d \u0645\u063a\u0644\u0642 \u2192 closed", r["status"], "closed")
test("Admin line: multi-word name", r["name_raw"], "\u0645\u0631\u0627\u062d \u0631\u064a\u0627\u062d")

r = parse_line("\u062c\u0646\u0627\u062a\u0627 \u062a\u0644 \u0627\u0644\u0631\u0628\u064a\u0639 \u0633\u0627\u0644\u0643\u0647")
test("Admin line: 3-word name \u2192 open", r["status"], "open")
test("Admin line: full name", r["name_raw"], "\u062c\u0646\u0627\u062a\u0627 \u062a\u0644 \u0627\u0644\u0631\u0628\u064a\u0639")

# ── Emoji-based parsing ──────────────────────────────────────────────────

print("\n\u2500\u2500 Emoji-based parsing \u2500\u2500")

r = parse_emoji_line("\u062d\u0648\u0627\u0631\u0629 \u2705")
test("Emoji: \u062d\u0648\u0627\u0631\u0629 \u2705 \u2192 open", r["status"], "open")
test("Emoji: name = \u062d\u0648\u0627\u0631\u0629", r["name_raw"], "\u062d\u0648\u0627\u0631\u0629")

r = parse_emoji_line("\u2705 \u062d\u0648\u0627\u0631\u0629")
test("Emoji: \u2705 \u062d\u0648\u0627\u0631\u0629 \u2192 open", r["status"], "open")
test("Emoji: name = \u062d\u0648\u0627\u0631\u0629", r["name_raw"], "\u062d\u0648\u0627\u0631\u0629")

r = parse_emoji_line("\U0001f534 \u062d\u0648\u0627\u0631\u0629")
test("Emoji: \U0001f534 \u062d\u0648\u0627\u0631\u0629 \u2192 closed", r["status"], "closed")

r = parse_emoji_line("\u062d\u0648\u0627\u0631\u0629 \U0001f534")
test("Emoji: \u062d\u0648\u0627\u0631\u0629 \U0001f534 \u2192 closed", r["status"], "closed")

r = parse_emoji_line("\u062d\u0648\u0627\u0631\u0629 \u0633\u0627\u0644\u0643\u0647 \u2705")
test("Emoji+word: strips status word", r["name_raw"], "\u062d\u0648\u0627\u0631\u0629")
test("Emoji+word: status = open", r["status"], "open")

r = parse_emoji_line("\u2705 \u062d\u0627\u062c\u0632 \u062d\u0648\u0627\u0631\u0629 \u0627\u0644\u062d\u0645\u062f\u0644\u0644\u0647")
test("Emoji: strips filler \u062d\u0627\u062c\u0632+\u0627\u0644\u062d\u0645\u062f\u0644\u0644\u0647", r["name_raw"], "\u062d\u0648\u0627\u0631\u0629")
test("Emoji: status = open", r["status"], "open")

r = parse_emoji_line("\u0628\u064a\u062a\u0627 \u2705 \u0627\u0644\u062d\u0645\u062f\u0644\u0644\u0647 \u064a\u0627 \u0634\u0628\u0627\u0628")
test("Emoji: strips trailing filler", r["name_raw"], "\u0628\u064a\u062a\u0627")
test("Emoji: status = open", r["status"], "open")

r = parse_emoji_line("\U0001f7e3 \u062d\u0648\u0627\u0631\u0629")
test("Emoji: \U0001f7e3 \u2192 military", r["status"], "military")

r = parse_emoji_line("\U0001f7e0 \u062d\u0648\u0627\u0631\u0629")
test("Emoji: \U0001f7e0 \u2192 congested", r["status"], "congested")

# ── Edge cases ───────────────────────────────────────────────────────────

print("\n\u2500\u2500 Edge cases \u2500\u2500")

r = parse_emoji_line("\u2705")
test("Emoji-only: \u2705 \u2192 None (no name)", r, None)

r = parse_emoji_line("")
test("Empty line \u2192 None", r, None)

r = parse_emoji_line("hello world")
test("No emoji, no status \u2192 None", r, None)

r = parse_line("\u062d\u0648\u0627\u0631\u0629 \u2705")
test("Word parser on emoji line \u2192 None (no word status)", r, None)

# ── parse_message integration ────────────────────────────────────────────

print("\n\u2500\u2500 parse_message integration \u2500\u2500")

# Crowd single message with emoji
r = parse_message("\u062d\u0648\u0627\u0631\u0629 \u2705", is_admin=False)
test("Crowd emoji msg: finds 1 update", len(r), 1)
test("Crowd emoji msg: status = open", r[0]["status"], "open")

# Crowd message with word status (should still work)
r = parse_message("\u062d\u0648\u0627\u0631\u0629 \u0633\u0627\u0644\u0643\u0647", is_admin=False)
test("Crowd word msg: finds 1 update", len(r), 1)
test("Crowd word msg: status = open", r[0]["status"], "open")

# Multi-line emoji message from crowd
multi = "\u062d\u0648\u0627\u0631\u0629 \u2705\n\u0628\u064a\u062a\u0627 \U0001f534\n\u0639\u0642\u0631\u0628\u0627 \u2705"
r = parse_message(multi, is_admin=False)
test("Multi-line emoji: finds 3 updates", len(r), 3)
statuses = {u["name_raw"]: u["status"] for u in r}
test("Multi-line emoji: \u062d\u0648\u0627\u0631\u0629 = open", statuses.get("\u062d\u0648\u0627\u0631\u0629"), "open")
test("Multi-line emoji: \u0628\u064a\u062a\u0627 = closed", statuses.get("\u0628\u064a\u062a\u0627"), "closed")
test("Multi-line emoji: \u0639\u0642\u0631\u0628\u0627 = open", statuses.get("\u0639\u0642\u0631\u0628\u0627"), "open")

# Admin structured message (should still use word parser)
admin_msg = "\u0627\u0646\u0634\u064a\u0647 \u0633\u0627\u0644\u0643\u0647\n\u0645\u0631\u0627\u062d \u0631\u064a\u0627\u062d \u0645\u063a\u0644\u0642\n\u062c\u0646\u0627\u062a\u0627 \u062a\u0644 \u0627\u0644\u0631\u0628\u064a\u0639 \u0633\u0627\u0644\u0643\u0647"
r = parse_message(admin_msg, is_admin=True)
test("Admin msg: finds 3 updates", len(r), 3)

# Message with no relevant content
r = parse_message("\u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631 \u064a\u0627 \u0634\u0628\u0627\u0628", is_admin=False)
test("Irrelevant msg: empty results", len(r), 0)

# ── Canonical key stability ──────────────────────────────────────────────

print("\n\u2500\u2500 Canonical key stability \u2500\u2500")

k1 = make_canonical_key("\u062d\u0648\u0627\u0631\u0629")
k2 = make_canonical_key("\u062d\u0648\u0627\u0631\u0647")  # ta marbuta variant
test("Key normalisation: \u0629\u2192\u0647", k1, k2)

# ══════════════════════════════════════════════════════════════════════════
# NEW TESTS: Parser fixes
# ══════════════════════════════════════════════════════════════════════════

# ── Emoji stripping in word parser ───────────────────────────────────────

print("\n\u2500\u2500 Emoji stripping (Phase 1A) \u2500\u2500")

r = parse_line("\u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649 \u0633\u0627\u0644\u0643")
test("Emoji prefix: \u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649 \u0633\u0627\u0644\u0643 \u2192 open", r is not None and r["status"], "open")
test("Emoji prefix: name = \u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649", r["name_raw"], "\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649")

r = parse_line("\u274c\u274c\u0627\u0644\u0639\u0631\u0648\u0628 \u0645\u063a\u0644\u0642")
test("Emoji prefix \u274c\u274c: name = \u0627\u0644\u0639\u0631\u0648\u0628", r["name_raw"], "\u0627\u0644\u0639\u0631\u0648\u0628")
test("Emoji prefix \u274c\u274c: status = closed", r["status"], "closed")

r = parse_line("\u2705\u2705\u0628\u0646\u064a \u0646\u0639\u064a\u0645 \u0633\u0627\u0644\u0643")
test("Emoji prefix: \u0628\u0646\u064a \u0646\u0639\u064a\u0645 name", r["name_raw"], "\u0628\u0646\u064a \u0646\u0639\u064a\u0645")

# Test _strip_emojis helper
test("_strip_emojis: removes all emojis", _strip_emojis("\u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649"), "\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649")
test("_strip_emojis: preserves Arabic", _strip_emojis("\u062d\u0648\u0627\u0631\u0629"), "\u062d\u0648\u0627\u0631\u0629")

# ── Split-direction lines (Phase 1B) ────────────────────────────────────

print("\n\u2500\u2500 Split-direction lines (Phase 1B) \u2500\u2500")

r = parse_line("\u064a\u062a\u0645\u0627 \u0627\u0644\u062f\u0627\u062e\u0644 \u0645\u0633\u0643\u0631 \u0627\u0644\u062e\u0627\u0631\u062c \u0633\u0627\u0644\u0643")
test("Split dir: \u064a\u062a\u0645\u0627 name", r is not None and r["name_raw"], "\u064a\u062a\u0645\u0627")
test("Split dir: status = open (last)", r["status"], "open")

r = parse_line("\u0639\u0646\u0627\u0628 \u0644\u0644\u062f\u0627\u062e\u0644 \u0633\u0627\u0644\u0643 \u0644\u0644\u062e\u0627\u0631\u062c \u0645\u063a\u0644\u0642")
test("Split dir 2: \u0639\u0646\u0627\u0628 name", r is not None and r["name_raw"], "\u0639\u0646\u0627\u0628")
test("Split dir 2: status = closed (last)", r["status"], "closed")

r = parse_line("\u0628\u064a\u062a \u0641\u0648\u0631\u064a\u0643 \u0633\u0627\u0644\u0643 \u0628\u0627\u0644\u0627\u062a\u062c\u0627\u0647\u064a\u0646")
test("Bidirectional: \u0628\u064a\u062a \u0641\u0648\u0631\u064a\u0643 name", r is not None and r["name_raw"], "\u0628\u064a\u062a \u0641\u0648\u0631\u064a\u0643")

# ── Section header skipping (Phase 1C) ──────────────────────────────────

print("\n\u2500\u2500 Section header skipping (Phase 1C) \u2500\u2500")

r = parse_line("\u0643\u0627\u0641\u0647 \u062d\u0648\u0627\u062c\u0632 \u0627\u0631\u064a\u062d\u0627 \u0645\u063a\u0644\u0642\u0647")
test("Header: \u0643\u0627\u0641\u0647 \u062d\u0648\u0627\u062c\u0632 \u0627\u0631\u064a\u062d\u0627 \u2192 None", r, None)

r = parse_line("\u0628\u0627\u0642\u064a \u062d\u0648\u0627\u062c\u0632 \u0627\u0631\u064a\u062d\u0627 \u0633\u0627\u0644\u0643\u0647")
test("Header: \u0628\u0627\u0642\u064a \u062d\u0648\u0627\u062c\u0632 \u2192 None", r, None)

# Greeting chain fully stripped — result is valid
r = parse_line("\u064a\u0633\u0639\u062f \u0635\u0628\u0627\u062d\u0643 \u0627\u062e\u064a \u0639\u064a\u0646 \u0633\u064a\u0646\u064a\u0627 \u0633\u0627\u0644\u0643")
test("Greeting chain: name = \u0639\u064a\u0646 \u0633\u064a\u0646\u064a\u0627", r is not None and r["name_raw"], "\u0639\u064a\u0646 \u0633\u064a\u0646\u064a\u0627")

# ── Greeting prefix stripping (Phase 1E) ────────────────────────────────

print("\n\u2500\u2500 Greeting prefix stripping (Phase 1E) \u2500\u2500")

r = parse_line("\u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631 \u062d\u0648\u0627\u0631\u0629 \u0633\u0627\u0644\u0643\u0647")
test("Greeting: \u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631 stripped", r is not None and r["name_raw"], "\u062d\u0648\u0627\u0631\u0629")

r = parse_line("\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645 \u0628\u064a\u062a\u0627 \u0645\u063a\u0644\u0642")
test("Greeting: \u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645 stripped", r is not None and r["name_raw"], "\u0628\u064a\u062a\u0627")

# ── Canonical key dedup (Phase 1D) ──────────────────────────────────────

print("\n\u2500\u2500 Canonical key dedup (Phase 1D) \u2500\u2500")

test("\u0648-prefix stripped", make_canonical_key("\u0648\u0645\u062f\u062e\u0644 \u0628\u0632\u0627\u0631\u064a\u0627"), make_canonical_key("\u0645\u062f\u062e\u0644 \u0628\u0632\u0627\u0631\u064a\u0627"))
test("\u0648\u0627\u062f NOT stripped", make_canonical_key("\u0648\u0627\u062f \u0642\u0627\u0646\u0627"), "\u0648\u0627\u062f_\u0642\u0627\u0646\u0627")

# Alias resolution
test("Alias: \u0639\u064a\u0646 \u0633\u0646\u064a\u0627 \u2192 \u0639\u064a\u0646 \u0633\u064a\u0646\u064a\u0627", make_canonical_key("\u0639\u064a\u0646 \u0633\u0646\u064a\u0627"), "\u0639\u064a\u0646_\u0633\u064a\u0646\u064a\u0627")
test("Alias: \u0627\u0644\u0643\u0648\u0646\u062a\u064a\u0646\u0631 \u2192 \u0627\u0644\u0643\u0646\u062a\u064a\u0646\u0631", make_canonical_key("\u0627\u0644\u0643\u0648\u0646\u062a\u064a\u0646\u0631"), "\u0627\u0644\u0643\u0646\u062a\u064a\u0646\u0631")

# ── Admin mixed word+emoji (Phase 2) ────────────────────────────────────

print("\n\u2500\u2500 Admin mixed word+emoji (Phase 2) \u2500\u2500")

admin_mixed = "\u0628\u0648\u0631\u064a\u0646 \u0633\u0627\u0644\u0643\n\u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649 \u0633\u0627\u0644\u0643\n\u2705\u2705\u0628\u0646\u064a \u0646\u0639\u064a\u0645 \u0633\u0627\u0644\u0643"
r = parse_message(admin_mixed, is_admin=True)
test("Admin mixed: finds 3 updates", len(r), 3)
names = {u["name_raw"] for u in r}
test("Admin mixed: has \u0628\u0648\u0631\u064a\u0646", "\u0628\u0648\u0631\u064a\u0646" in names, True)
test("Admin mixed: has \u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649", "\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649" in names, True)
test("Admin mixed: has \u0628\u0646\u064a \u0646\u0639\u064a\u0645", "\u0628\u0646\u064a \u0646\u0639\u064a\u0645" in names, True)

# Admin message where ALL lines have emojis (no word-only lines)
admin_emoji = "\u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649 \u0633\u0627\u0644\u0643\n\u274c\u274c\u0627\u0644\u0639\u0631\u0648\u0628 \u0645\u063a\u0644\u0642"
r = parse_message(admin_emoji, is_admin=True)
test("Admin all-emoji: finds 2 updates", len(r), 2)

# Admin with emoji-only status (no word status)
admin_pure_emoji = "\u062d\u0648\u0627\u0631\u0629 \u2705\n\u0628\u064a\u062a\u0627 \U0001f534"
r = parse_message(admin_pure_emoji, is_admin=True)
test("Admin pure emoji: finds 2 updates", len(r), 2)

# ── _clean_checkpoint_name ──────────────────────────────────────────────

print("\n\u2500\u2500 _clean_checkpoint_name \u2500\u2500")

test("Clean: strips emojis + status", _clean_checkpoint_name("\u2705\u2705\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649 \u0633\u0627\u0644\u0643"), "\u0641\u0631\u0634 \u0627\u0644\u0647\u0648\u0649")
test("Clean: strips filler", _clean_checkpoint_name("\u2705 \u062d\u0627\u062c\u0632 \u062d\u0648\u0627\u0631\u0629 \u0627\u0644\u062d\u0645\u062f\u0644\u0644\u0647 \u0633\u0627\u0644\u0643"), "\u062d\u0648\u0627\u0631\u0629")
test("Clean: strips direction words", _clean_checkpoint_name("\u0639\u0646\u0627\u0628 \u0644\u0644\u062f\u0627\u062e\u0644 \u0633\u0627\u0644\u0643 \u2705"), "\u0639\u0646\u0627\u0628")

# ── Summary ──────────────────────────────────────────────────────────────

print(f"\n{'='*50}")
print(f"  Results: {passed} passed, {failed} failed")
print(f"{'='*50}")

sys.exit(1 if failed else 0)
