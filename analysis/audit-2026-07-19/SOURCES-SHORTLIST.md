# Source-expansion shortlist — inputs for Plan B

Goal: richer, best-in-class WB/Gaza coverage. Ordered by value-per-effort. Every new
source passes the trust gate (shadow-ingest → corroborate → promote) before serving.

## Tier 0 — coverage we ALREADY earned (no new source; just unblock)

The stalled candidate→promote loop (Finding F3) is the cheapest expansion: ~20 real
checkpoints already vetted, sitting unserved. Promote after name-normalization + dedup.

| checkpoint | gov | mentions | note |
|---|---|---|---|
| سيلة الظهر (Silat adh-Dhahr) | Nablus/Jenin | 73 | Route 60 corridor |
| بني انعيم (Bani Na'im) | Hebron | 72 | |
| اللبن الشرقي/الساوية (al-Lubban ash-Sharqiya) | Salfit | 60 | variant of cataloged? verify |
| تحت جسر اودله (Awarta bridge) | Nablus | 59 | |
| بوابة الطيبة (Taybeh gate) | Ramallah | 55 | |
| عصيرة (Asira) | Nablus | 43 | |
| جسر عزون-جيوس (Azzun-Jayyous bridge) | Qalqilya | 41 | |
| واد قانا (Wadi Qana) | Salfit | 26 | |
| الباذان (Al-Badhan) | Nablus | 25 | |
| بوابة عطارة القديمة (old Atara gate) | Ramallah | 21 | |
| + settlement-adjacent (Kedumim, Shavei Shomron, Ma'ale Efrayim/Adumim) | various | | verify names |

Plus the **vetter false-negatives** (F6) to re-vet and likely promote: فرش الهوا
(Farsh al-Hawa, Hebron), عين سينا (Ein Siniya, Ramallah), دوار الطنيب (Tunayb), دوار
مخماس (Mukhmas), المدخل الشمالي للبيرة (N. entrance Al-Bireh).

**Prereq:** re-run the vetter (llm_cache dead since 2026-06-24) over the 5,096 unvetted
candidates; add gazetteer cross-check so bare place-names aren't rejected.

## Tier 1 — replace dead checkpoint channels (Finding F10)

Dead (0 msgs/7d): **jisrrrr, khbnews1, aljesernews**. Dying: **almasshta**. Coverage rests
on 4 channels — no redundancy. Replacements come from the discovery sweep:
- `corpus_dump.py --discover` is **staged in the container**; runs with the corpus pull
  (Task 4 gate). It searches road/checkpoint queries and ranks candidates by subscribers +
  last-post recency. **Pending corpus gate — results append here.**
- Target governorates currently thin on live channels: Jenin, Tubas, Jericho, Salfit
  (their checkpoints are reported mostly by the 4 big cross-WB channels, not local ones).

## Tier 2 — non-Telegram sources (probed 2026-07-19)

| source | status | format | verdict |
|---|---|---|---|
| ReliefWeb API (api.reliefweb.int) | 200 reachable | JSON API, needs correct oPt filter (iso3=pse via proper query) | KEEP — official OCHA/UN sitreps; already a databank source; wire WB/Gaza flash updates. Needs `appname`. |
| Al Jazeera / Anadolu / RT Arabic RSS | LIVE (in system) | RSS | KEEP — already ingested; the working RSS backbone |
| WAFA (wafa.ps) | site 200, RSS .aspx **404** | HTML (no RSS) | MAYBE — official PA agency; requires HTML scrape (browser-fetch pattern), not a feed |
| Ma'an News RSS | **404** | — | SKIP for now — classic RSS dead; find current endpoint in Plan B |
| OCHA oPt flash updates | not probed | web/PDF | INVESTIGATE — high trust, slow cadence; good consensus anchor |
| PRCS (Palestine Red Crescent) incident reports | not probed | web/social | INVESTIGATE — authoritative casualty/incident source |

**Vetting protocol (every Tier-1/2 source):** shadow-ingest first (trust-calibrated via the
per-channel dynamic-trust mechanism, NOT served) for a calibration window; promote to
serving only if reports corroborate trusted sources. No source ships straight to serving.

## Coverage metrics to record (before/after, into ACCURACY.md)
- Governorates with ≥1 active local live channel (today: thin on Jenin/Tubas/Jericho/Salfit).
- Catalog size vs OCHA published obstacle counts.
- Median report age per governorate (freshness by region — currently unmeasured).

## Pending corpus gate
`corpus_dump.py --discover` output (discovery.json) and the replay-window miss stream
(enriches Tier 0/1) land after the Task 4 corpus pull. This file updates then.
