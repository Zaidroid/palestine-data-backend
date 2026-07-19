# Tier 1 Fixes — Plan B (round 1: classifier + serving trust fixes)

> Executes the top findings from `analysis/audit-2026-07-19/FINDINGS.md`.
> Cut-line set by Claude (Zaid delegated); F5 decision (Zaid): regional = separate tagged feed.

**Round 1 scope (this session, offline-testable, safe):** F1, F4, F5.
**Round 2 (separate):** F0 (recall broadening — riskier, needs FN+FP fixture balance),
F2 (serving count reconciliation), F3 (catalog promotion — touches live DB), F6–F9.

**Global constraints:** every classifier change is TDD'd and added to the eval-harness
fixtures (`test_classifier_fp_audit.py`) so CI gates it. No prod write from auto-mode —
deploy is a batched `!` command list for Zaid. Re-measure offline against the corpus after
each fix; ACCURACY.md shows before/after. Run tests with `.venv-audit/bin/python -m pytest`.

## F1 — siren geo-restrict (app/classifier.py)
**Bug:** in `classify()`, the `if _is_israel_interior(normed) or has_siren:` branch builds
`west_bank_siren` whenever a siren word appears — the MENA guard is `and not has_siren`, so
Bahrain/Kuwait/Jordan/Iran sirens bypass it. Measured 0/7 west_bank_siren were actually WB.
**Fix:** `west_bank_siren` requires Israel/WB/Gaza-proper geography. If the text names a
foreign MENA country (and no Israel/WB/Gaza target) → `regional_attack`, even with a siren.
- Add missing countries to `_FOREIGN_AREAS` (Bahrain, Egypt, UAE, Qatar, Saudi, Oman, Turkey)
  and a `_names_foreign_country(normed)` text check (البحرين/الكويت/الاردن/عمان/قطر/...).
- In the siren branch: if `_names_foreign_country(normed)` and not (WB/Gaza/Israel target) →
  `regional_attack`.
**Tests:** Bahrain/Kuwait/Jordan/Lebanon siren fixtures → regional_attack; Tel Aviv/Haifa/
Ramallah siren → west_bank_siren (unchanged). Add to FP-audit fixtures.

## F4 — strip reporter byline (app/classifier.py)
**Bug:** `مراسل` (correspondent) is in `JOURNALIST_TARGETED_TERMS`; "مراسل صفا: إصابة الشاب…"
matches مراسل + اصابه → journalist_targeted though it is a byline, not a targeted journalist.
**Fix:** strip a leading reporter/agency byline before classification —
`(emoji/marker)* (مراسل|مراسلة|متابعة) <agency> (:|｜|\|)`. The event text after the byline
then classifies correctly (also recovers recall on byline-prefixed events). journalist_targeted
then needs a journalist noun (صحفي…) in the actual content.
**Tests:** "🔴 مراسل صفا: إصابة الشاب…" → injury_report (not journalist_targeted); a real
"استشهاد الصحفي … بقصف" → journalist_targeted (unchanged). Add to fixtures.

## F5 — regional scope tag + feed filter (serving, no schema change)
**Decision:** keep regional events, tag them, default WB/Gaza feed excludes them.
**Fix (serving only — types already distinguish regional):**
- A pure `scope_for_type(alert_type)` helper: `regional_attack`, `northern_israel_siren`
  → `"regional"`; `gaza_strike` → `"gaza"`; else `"wb"`.
- Alerts feed endpoint: add `scope` to each served alert (derived) + a query filter; the
  default excludes `regional`, `?scope=regional` or `?include_regional=true` returns them.
**Tests:** default feed excludes regional_attack/northern_israel_siren; `?scope=regional`
returns only those. Endpoint-level test.

## Gate
Add all new fixtures to the harness; run full suite green; re-run the M1-precision replay
offline (expect precision 65% → ~85%+ from F1/F4/F5); update ACCURACY.md before/after;
hand Zaid the batched deploy (rsync code → rebuild image → recreate alerts container) +
live verify (`/quality/eval`, spot-check west_bank_siren feed, `?scope=regional`).
