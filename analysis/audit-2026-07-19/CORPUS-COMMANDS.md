# Corpus re-pull — YOUR gate (monitor down ~5-10 min)

The analyzer session is logged out, so the pull needs the monitor's own Telegram
session, which means briefly stopping the monitor. Run these as `!` commands in
order. corpus_dump.py is already staged in the container at /tmp/corpus_dump.py.

```
# 1. stop the monitor (frees the wb_alerts session):
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose stop alerts"

# 2. dump checkpoint + security channels using the monitor's session (AUDIT_SESSION=wb_alerts):
! ssh zaid@100.99.243.75 "docker exec -e AUDIT_SESSION=wb_alerts params-alerts-api python /tmp/corpus_dump.py --corpus ahwalaltreq,a7walstreet,road_jehad,peopleofHebron,KHBNews1,aljesernews,jisrrrr,Almasshta,Roaddconditions,ahwaltrkwhwagz_nablous,QudsN,alkofiyatv,alqastalps,eyeonpalestine2,maannews,nablus_now,palinfo,safaps,shehabagency,wafanews --limit 2000"

# 3. discovery sweep (source-expansion input for Task 13):
! ssh zaid@100.99.243.75 "docker exec -e AUDIT_SESSION=wb_alerts params-alerts-api python /tmp/corpus_dump.py --discover"

# 4. restart the monitor:
! ssh zaid@100.99.243.75 "cd /opt/stacks/palestine && docker compose up -d alerts"

# 5. verify ingestion resumed (monitor.connected true, last_message_at advancing):
! curl -sS https://wb-alerts.zaidlab.xyz/health
```

After step 4 restarts the monitor, I pull the corpus out of the container myself
(read-only docker cp) and build corpus.db locally — no further action from you.
