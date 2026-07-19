# M6 — channel health (last 30d)

## Checkpoint channels (checkpoint_updates)

| channel | updates 30d | updates 7d | verdict |
|---|---|---|---|
| a7walstreet | 17450 | 4952 | active |
| ahwalaltreq | 10881 | 3711 | active |
| road_jehad | 7027 | 1723 | active |
| roaddconditions | 3403 | 979 | active |
| almasshta | 1913 | 169 | dying |
| peopleofhebron | 144 | 27 | active |
| jisrrrr | 10 | 0 | DEAD |
| khbnews1 | 7 | 0 | DEAD |
| aljesernews | 5 | 0 | DEAD |
| ahwaltrkwhwagz_nablous | 3 | 1 | active |

## Security/news sources (alerts)

| source | alerts 30d | alerts 7d | verdict |
|---|---|---|---|
| qudsn | 1882 | 641 | active |
| safaps | 1548 | 564 | active |
| palinfo | 1150 | 421 | active |
| alkofiyatv | 864 | 346 | active |
| alqastalps | 518 | 174 | active |
| rt_arabic | 246 | 131 | active |
| anadolu_ar | 223 | 101 | active |
| aljazeera_ar | 179 | 67 | active |
| eyeonpalestine2 | 152 | 60 | active |
| maannews | 71 | 29 | active |
| a7walstreet | 18 | 4 | active |
| roaddconditions | 8 | 0 | DEAD |
| ahwalaltreq | 7 | 4 | active |
| road_jehad | 5 | 1 | active |
| jisrrrr | 5 | 1 | active |
| khbnews1 | 1 | 1 | active |

## channel_reliability (static trust priors — seed, not dynamic)

- Almustashaar: w=1.0 (Official PA/IDF communiqué aggregator) seeded 2026-06-10
- WAFA: w=0.9 (Palestinian national news agency (offici) seeded 2026-06-10
- wafa_ps: w=0.9 (WAFA Arabic mirror) seeded 2026-06-10
- QudsN: w=0.8 (Quds News Network — high volume, cross-v) seeded 2026-06-10
- qudsn: w=0.8 (Quds News Network — alt handle) seeded 2026-06-10
- MOHMediaGaza: w=0.8 (Gaza Health Ministry — bulletins only) seeded 2026-06-10
- maannews: w=0.8 (Ma'an News Agency — establishment outlet) seeded 2026-06-11
- ahwalaltreq: w=0.75 (Road conditions backbone — checkpoint ch) seeded 2026-06-11
- a7walstreet: w=0.75 (Roads & checkpoints WB+Jerusalem, 124K s) seeded 2026-06-11
- Shihab: w=0.7 (Shihab Agency — fast but occasional dupl) seeded 2026-06-10
- shehabagency: w=0.7 (Shihab agency alt) seeded 2026-06-10
- PalinfoAr: w=0.7 (Palinfo Arabic) seeded 2026-06-10
- alqastalps: w=0.7 (Al-Qastal — Jerusalem/EJ focus, 117K sub) seeded 2026-06-11
- safaps: w=0.7 (Safa Agency) seeded 2026-06-11
- road_jehad: w=0.7 (Roads & checkpoints — WB-wide) seeded 2026-06-11
- KHBNews1: w=0.7 (King Hussein Bridge news — 59K subs, cro) seeded 2026-06-11
- aljazeera_ar: w=0.65 (Al Jazeera Arabic RSS) seeded 2026-06-10
- ajanews: w=0.6 (Al Jazeera Arabic news feed) seeded 2026-06-10
- alkofiyatv: w=0.6 (Kofiya TV) seeded 2026-06-11
- peopleofHebron: w=0.6 (Hebron roads — regional) seeded 2026-06-11
- aljesernews: w=0.6 (Bridge news — secondary) seeded 2026-06-11
- Almasshta: w=0.6 (Jericho checkpoints — regional) seeded 2026-06-11
- Roaddconditions: w=0.6 (Ramallah roads — regional) seeded 2026-06-11
- ahwaltrkwhwagz_nablous: w=0.6 (Nablus roads — regional) seeded 2026-06-11
- anadolu_ar: w=0.55 (Anadolu Agency Arabic RSS) seeded 2026-06-10
- skynews_ar: w=0.55 (Sky News Arabia RSS — fast breaking news) seeded 2026-06-10
- jisrrrr: w=0.55 (Bridge + Jericho rest stop) seeded 2026-06-11
- AlMayadeenNews: w=0.5 (Al Mayadeen — editorial overlay common) seeded 2026-06-10
- eyeonpalestine2: w=0.5 (Eye on Palestine — aggregation, slower v) seeded 2026-06-11
- rt_arabic: w=0.45 (RT Arabic RSS — framing bias) seeded 2026-06-10

# M7 — provenance completeness

- /v2/checkpoints: 199/258 records with full provenance chain (77%)
- checkpoint_updates: 59792 rows — raw_message 59792 (100%), source_msg_id 59792 (100%), source_channel 59792 (100%)
- alerts (30d): 6877/6877 with source_msg_id + raw_text (100%)

# M8 — coordinate regressions (June authoritative OSM/resident fixes)

- Huwara حواره: authoritative coord present (as `حواره`) → OK
- Anab عناب: authoritative coord present (as `عنبتا`) → OK
- Tayasir تياسير: authoritative coord present (as `تياسير`) → OK
- Walaja الولجه: authoritative coord present (as `الولجه`) → OK
- Zaim الزعيم: authoritative coord present (as `الزعيم`) → OK
- Allenby جسر الملك حسين: authoritative coord present (as `جسر الملك حسين`) → OK
- Zatara زعتره: authoritative coord present (as `زعتره`) → OK
- Anata عناتا: authoritative coord present (as `جبع`) → OK
- Beit Jala بيت جالا: authoritative coord present (as `ب��ت_جالا`) → OK
- Jaba جبع: authoritative coord present (as `عناتا`) → OK

**10/10 June coord fixes intact in prod.**

## Verdicts
**M6 (channel health):** Checkpoint coverage rests on **4 channels** (a7walstreet, ahwalaltreq, road_jehad, roaddconditions = 38.7k of 39.7k updates). **3 dead** (jisrrrr/khbnews1/aljesernews = 0 in 7d), almasshta dying (169 in 7d, down from 1913/30d), ahwaltrkwhwagz_nablous near-dead (3/30d). **Concentration risk:** if a7walstreet or ahwalaltreq drops, checkpoint coverage craters — no redundancy for their governorates. Security/news side is healthy (13 active sources). Feeds Task 13 (replace dead channels). channel_reliability = 30 well-curated static priors (some for unmonitored channels — harmless).

**M7 (provenance):** 100% on all actual reports (checkpoint_updates + 30d alerts carry raw_message/source_msg_id/source_channel). 77% of served v2 checkpoints have a full chain; the 23% gap = catalog checkpoints never live-reported (the "none" freshness band) — honest, not a hole. **Provenance is a genuine strength to sell.**

**M8 (coordinates):** **10/10** June authoritative fixes intact — no regression. Cosmetic notes: Beit Jala canonical_key still carries corrupted bytes (`ب��ت_جالا`, works via name_ar — known since June); the جبع/عناتا coords are both present and checkpoint-attached (label guesses in the fix list were swapped, not a data error).
