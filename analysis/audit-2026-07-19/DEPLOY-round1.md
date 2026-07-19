# Deploy — Tier 1 fixes round 1 (F1 + F4 + F5)

Commits `c46f2a7` (F1), `a567e9e` (F4), `530c835` (F5), `f529397` (gate) on `main`.
All offline-verified: 46 tests + classifier FP audit 96/96. Nothing regional/schema-breaking.

## Run as `!` commands, in order

```
# 1. push the branch (deploy.sh pulls origin/main; I can't push to a default branch):
! cd ~/Zlab/palestine-data-backend && git push origin main

# 2. deploy on .114 (pulls main, rsyncs app code, rebuilds image, restarts alerts;
#    live DBs + Telegram session are volume-mounted and untouched):
! ssh zaid@100.99.243.75 "bash /opt/stacks/palestine/deploy.sh"

# 3. confirm the monitor came back and is ingesting:
! curl -sS https://wb-alerts.zaidlab.xyz/health
```

## After step 3 I verify (read-only, myself):
- `/quality/eval` — classifier FP fixtures still pass live.
- Default alerts feed excludes regional: `/alerts?scope=wb_gaza` has no regional_attack/
  northern_israel_siren; `/alerts?scope=regional` returns only those; `/alerts?scope=all` both.
- `/quality/accuracy` serves `fix_round_1` (65% → ~81%).
- Spot-check: a Bahrain/Kuwait/Jordan siren no longer appears as a West Bank alert.

## Rollback (if needed)
`deploy.sh` keeps the prior image; `ssh zaid@100.99.243.75 "cd /opt/stacks/palestine &&
docker compose up -d --force-recreate alerts"` after `git reset --hard <prev>` on the clone,
or redeploy an earlier commit. Live data is never touched by deploy.
