# Tier 1 trustworthiness audit — 2026-07-19
Working dir for the measure-first audit (spec: docs/superpowers/specs/2026-07-19-tier1-trustworthiness-audit-design.md).
- snapshot/ = read-only prod copies (git-ignored, local only)
- *.py = measurement instruments, run with services/westbank-alerts/.venv-audit/bin/python
- outputs (*.md, *.json summaries) are committed

## Baseline counts (snapshot 2026-07-19 ~19:17)
- checkpoint_updates: 59,792 | checkpoint_status: 729 | checkpoint_candidates: 5,275
- alerts: 9,233 | channel_reliability: 30
- prod catalog == repo catalog (234 entries, list) → replay uses repo catalog, no swap
- channels: CHECKPOINT (10) ahwalaltreq,a7walstreet,road_jehad,peopleofHebron,KHBNews1,aljesernews,jisrrrr,Almasshta,Roaddconditions,ahwaltrkwhwagz_nablous | SECURITY (5) QudsN,wafanews,palinfo,nablus_now,shehabagency | GAZA (1) MOHMediaGaza
- also pulled news.db (17MB) for channel-health cross-check
