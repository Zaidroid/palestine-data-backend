# F3 — checkpoint catalog promotion (2026-07-19)

Analyzed the 46 candidates the vetting loop marked `real`@0.90–0.95 but never promoted.

## Honest finding
The raw "46 unpromoted reals" **overstated the coverage gap**. After normalizing the
status-word pollution (مغلقات/سالكات/كثافة سير/الان نزل/…) and deduping against the 234-entry
catalog, most are **variants of checkpoints already in the catalog**: Arroub (بوابات العروب),
Qalandia (قلنديا كثافة سير), Huwara (حوارة الالتفافي/بوابات حوارة), Jaba (جبع الان نزل),
Za'tara (زعترا), Dura (دورا سكرت), al-Lubban, al-Murabba'a, Jamma'in, Jit-Yitzhar, Ariel,
Shavei Shomron, Badhan — all already served.

Of the genuinely-new ones, several had **bad or missing coordinates**: بوابة الطيبة resolved
to 32.51 (the wrong Taybeh, ~60km north); بني نعيم's lon was ~4km off; and ~12 real-but-new
names (عصيرة المساكن, تحت جسر اودله, كف 35, محسوم, الشواورة, راس جوره, …) had no coordinates
at all.

## Promoted (4 — genuinely new, real, coord-plausible; catalog 234 → 238)
| canonical_key | name | region | coord | precision |
|---|---|---|---|---|
| اشارات_عوفرا | Ofra Junction | ramallah | 31.9563, 35.2601 | gazetteer |
| واد_قانا | Wadi Qana | salfit | 32.1591, 35.1064 | gazetteer |
| سيله_الظهر | Silat adh-Dhahr | jenin | 32.3193, 35.1842 | gazetteer |
| مدخل_رافات | Rafat Entrance | salfit | 32.0781, 35.0442 | gazetteer |

Marked `geo_precision: gazetteer` (village-center approximations — honest; the 400m routing
corridor + gateway model tolerate this). Once cataloged, the whitelist parser matches these
names in incoming messages instead of dropping them as whitelist-misses, so coverage grows
going forward.

## Deferred to a future OSM-precision pass (documented, not promoted)
- **Bad coord (need OSM):** بوابة الطيبة, بني انعيم.
- **No coord (real, need geocoding):** عصيرة المساكن, تحت جسر اودله, كف 35, واد البلاط,
  معاليه افرايم, بوابة المهلل, محسوم, قدوميم, الشواورة, راس جوره, الحواور, الفراية.
- **Azzun–Jayyous bridge (جسر عزون جيوس):** Azzun town is cataloged; the bridge is a distinct
  point but held back to avoid a near-duplicate without a precise coord.

Promoting these needs authoritative (OSM/resident-confirmed) coordinates per the standing
"trusted-data-only" rule — the same discipline that fixed the 10 June coords. That's the
right follow-up, not a gazetteer guess into the live catalog.
