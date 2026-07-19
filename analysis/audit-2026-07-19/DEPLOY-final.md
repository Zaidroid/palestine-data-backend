# Deploy — Tier 1 final polish (F7, F8, F9, English, F10, F11 + OSM)

All committed on main, offline-verified: 55 new-fix tests + FP audit 96/96 + 63 regression tests.

## 1. Push + deploy (code + catalog)
```
! cd ~/Zlab/palestine-data-backend && git push origin main
! ssh zaid@100.99.243.75 "bash /opt/stacks/palestine/deploy.sh"
! curl -sS https://wb-alerts.zaidlab.xyz/health
```
This ships: F7 (media-FP filter), F8 (6h staleness), F9 (consensus large-cohort guard),
English coverage, and the catalog (240 entries incl. Beit Jala key fix + Bani Na'im coord fix).

## 2. Post-deploy data migrations (I run these after the container is up)
- Seed the new/updated catalog rows (Kedumim, Ma'ale Efrayim, Bani Na'im coord) — bulk_seed upsert.
- Beit Jala key migration: `docker cp scripts/migrate_beitjala_key.py` in, dry-run, then `--apply`.
(I do these via docker exec once deploy confirms healthy.)

## 3. F10 — replace dead checkpoint channels (config; low-risk)
Dead: jisrrrr, khbnews1, aljesernews. The whitelist parser filters checkpoint-channel output
to the catalog, so new channels can only ADD coverage (never junk to the served feed).
Add the top vetted-active discovery candidates to CHECKPOINT_CHANNELS. Requires the Telegram
account to be able to read them (public channels are readable without joining; if a channel is
private the pull just fails gracefully). In `/opt/stacks/palestine/docker-compose.override.yml`,
append to the alerts service `CHECKPOINT_CHANNELS` env:
```
,aljanoop48,ahwalaltareq,ahwaltareq1,rsdrasd,areenablus,ahwalaltorq
```
then `docker compose up -d --force-recreate alerts`. Verify after ~30 min that the new channels
appear in checkpoint_updates (redundancy for the big-4 + Nablus-south coverage). Roll back by
removing them from the env if any is noisy/inaccessible.

## Verify (I run, read-only)
- /quality/eval 96/96 live.
- Default feed still clean (no regional), F8: >6h checkpoints show effective_status unknown.
- New checkpoints (Kedumim/Ma'ale Efrayim) in /v2/checkpoints; total_directory 240.
- Beit Jala key no longer garbled in /v2/checkpoints.
