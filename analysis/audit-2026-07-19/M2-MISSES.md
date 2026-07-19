# M2 — whitelist-miss composition

candidates table: **5275** distinct names
- llm verdicts: {'not_a_checkpoint': 133, 'real': 46, 'unvetted': 5096}
- statuses: {'pending': 5275}
- **promoted to catalog: 0**
- llm_verdict=real but NOT promoted: **46** (coverage gap — real checkpoints sitting unserved)

## The unpromoted 'real' candidates (highest-value coverage gap)

| raw_name | mentions | conf | governorate |
|---|---|---|---|
| سيلة الظهر | 73 | 0.95 | Nablus |
| بني انعيم | 72 | 0.95 | Hebron |
| اللبن الشرقي الساوية | 60 | 0.95 | Salfit |
| تحت جسر اودله | 59 | 0.95 | Hebron |
| بوابة الطيبة | 55 | 0.95 | Ramallah and Al-Bireh |
| بوابات العروب مغلقات | 53 | 0.95 | Hebron |
| عصيرة المساكن | 43 | 0.95 | Nablus |
| اريحا الجنوبي ال dco | 42 | 0.95 | Jericho |
| جسر عزون جيوس | 41 | 0.95 | Qalqilya |
| كف 35 | 40 | 0.95 | Bethlehem |
| العروب جميعهم مغلقات | 36 | 0.95 | Hebron |
| واد البلاط | 30 | 0.95 | Bethlehem |
| المعرجات كرملوا الطيبة | 29 | 0.9 | Jericho |
| مفرق جيت يتسهار | 27 | 0.95 | Nablus |
| معاليه افرايم | 27 | 0.95 | Jerusalem |
| واد قانا | 26 | 0.95 | Salfit |
| الباذان | 25 | 0.95 | Nablus |
| قلنديا كثافة سير | 24 | 0.95 | Jerusalem |
| حوارة الالتفافي الجديد | 23 | 0.95 | Nablus |
| طلوع معالي ادوميم | 22 | 0.95 | Jerusalem |
| بوابة عطارة القديمة | 21 | 0.95 | Ramallah and Al-Bireh |
| بوابة المهلل | 17 | 0.95 | Bethlehem |
| محسوم | 16 | 0.95 | Hebron |
| دوار ارائيل | 15 | 0.95 | Salfit |
| قدوميم | 15 | 0.95 | Qalqilya |
| اشارات عوفرا | 14 | 0.95 | Ramallah and Al-Bireh |
| شافي شومرون | 13 | 0.95 | Nablus |
| الشواورة | 12 | 0.95 | Bethlehem |
| زعترا | 11 | 0.95 | Bethlehem |
| راس جوره | 11 | 0.95 | Jerusalem |
| المربعة بحري بدون | 8 | 0.95 | Hebron |
| بوابات حوارة سالكات | 8 | 0.95 | Nablus |
| الحواور | 7 | 0.95 | Jericho |
| الـ 17 عصيرة | 7 | 0.95 | Nablus |
| بوابة جماعين الرئيسية | 7 | 0.95 | Nablus |
| بوابة جماعين الكسارة | 7 | 0.95 | Nablus |
| حواجز أريحا | 7 | 0.9 | Jericho |
| مدخل رافات | 6 | 0.95 | Salfit |
| اللبن قبلان الساوية | 6 | 0.95 | Salfit |
| المربعه اخر تحديث | 6 | 0.95 | Hebron |
| الساويه قبلان سالكات | 6 | 0.95 | Tulkarm |
| العروب حلحلول سعير | 6 | 0.95 | Hebron |
| اللبن الرنتيس | 6 | 0.95 | Ramallah and Al-Bireh |
| جبع الان نزل | 5 | 0.95 | Jerusalem |
| الفراية | 5 | 0.95 | Jericho |
| دورا سكرت الان | 5 | 0.9 | Hebron |

## Top 40 candidates by mentions (hand-classify column below)

| raw_name | mentions | llm_verdict | conf | in_catalog? | HAND: junk/real/variant/parse |
|---|---|---|---|---|---|
| اخر تحديث | 744 | not_a_checkpoint | 0 |  | |
| https | 453 | not_a_checkpoint | 0 |  | |
| فرش الهوا | 258 | not_a_checkpoint | 0 |  | |
| حديثة | 207 | not_a_checkpoint | 0 |  | |
| وتفتيش | 181 | not_a_checkpoint | 0 |  | |
| دوار الطنيب | 174 | not_a_checkpoint | 0.2 |  | |
| مداخل | 148 | not_a_checkpoint | 0 |  | |
| اخر اشارة | 135 | not_a_checkpoint | 0.1 |  | |
| دوار مخماس | 132 | not_a_checkpoint | 0.2 |  | |
| المدخل الشمالي لمدينة البيرة | 129 | not_a_checkpoint | 0.3 |  | |
| عين سينا | 124 | not_a_checkpoint | 0.3 |  | |
| هاتف | 102 | not_a_checkpoint | 0 |  | |
| سيارة | 95 | not_a_checkpoint | 0 |  | |
| برقا | 94 | not_a_checkpoint | 0 |  | |
| وازمة | 81 | not_a_checkpoint | 0.1 |  | |
| سيلة الظهر | 73 | real | 0.95 |  | |
| بني انعيم | 72 | real | 0.95 |  | |
| اندماج | 70 | not_a_checkpoint | 0 |  | |
| واد الشاجنة | 67 | not_a_checkpoint | 0.9 |  | |
| طريق العبارة | 65 | not_a_checkpoint | 0 |  | |
| المراح | 64 | not_a_checkpoint | 0 |  | |
| ابو العرقان | 63 | not_a_checkpoint | 0.2 |  | |
| باتجاه قرية رافات | 61 | not_a_checkpoint | 0 |  | |
| اللبن الشرقي الساوية | 60 | real | 0.95 |  | |
| تحت جسر اودله | 59 | real | 0.95 |  | |
| اسأل ناقش شارك تجربتك | 57 | not_a_checkpoint | 0 |  | |
| بوابة الطيبة | 55 | real | 0.95 |  | |
| دورا واد الشاجنة | 54 | not_a_checkpoint | 0 |  | |
| بوابات العروب مغلقات | 53 | real | 0.95 |  | |
| من قريب | 52 | None | 0 |  | |
| قانونيه رسميه | 51 | not_a_checkpoint | 0 |  | |
| موبايل | 51 | not_a_checkpoint | 0 |  | |
| واتساب | 51 | not_a_checkpoint | 0 |  | |
| واتس | 51 | not_a_checkpoint | 0 |  | |
| نصار الإسكانات | 49 | not_a_checkpoint | 0.1 |  | |
| عش اغراب | 49 | not_a_checkpoint | 0 |  | |
| ماشية | 49 | not_a_checkpoint | 0 |  | |
| ال 17 | 48 | not_a_checkpoint | 0.1 |  | |
| احوال طرق اريحا | 46 | not_a_checkpoint | 0 |  | |
| مزموريا | 45 | not_a_checkpoint | 0 |  | |

## Replay-window misses: (pending corpus re-pull — Task 4 gate)


## Hand classification of top 40 by mentions (Claude, Palestinian geography)

**Headline split:** ~22 junk (55%), ~11 real-uncataloged (28%), ~4 variant-of-cataloged (10%), ~1 parse-failure, ~2 ambiguous. So **~38% of the highest-mention misses are genuine coverage** (real + variant), not noise.

**junk (generic words / CTAs / status fragments / URLs)** — correctly not checkpoints:
اخر تحديث ("last update"), https, وتفتيش ("and inspection"), مداخل ("entrances"), اخر اشارة ("last signal"), هاتف ("phone"), سيارة ("car"), وازمة ("and congestion"), اندماج ("merge"), طريق العبارة, المراح, ابو العرقان, اسأل ناقش شارك تجربتك (channel CTA), من قريب, قانونيه رسميه, موبايل, واتساب, واتس, نصار الإسكانات, عش اغراب (=عش الغراب, correctly rejected), ماشية ("flowing"), حديثة ("recent").

**real-uncataloged (genuine coverage gap; several are VETTER FALSE-NEGATIVES marked not_a_checkpoint):**
- فرش الهوا (Farsh al-Hawa — western entrance to Hebron; vetter said not_a_checkpoint @0.0 → **FN**)
- عين سينا (Ein Siniya — Route 60 N of Ramallah; vetter not_a_checkpoint @0.3 → **FN**)
- دوار الطنيب (Tunayb roundabout, near Jericho DCO; @0.2 → **FN**)
- دوار مخماس (Mukhmas/Michmash roundabout; @0.2 → **FN**)
- المدخل الشمالي لمدينة البيرة (northern entrance to Al-Bireh; @0.3 → **FN**)
- سيلة الظهر (Silat adh-Dhahr — real @0.95 ✓), بني انعيم (Bani Na'im @0.95 ✓)
- تحت جسر اودله (Awarta/Odala bridge @0.95 ✓), بوابة الطيبة (Taybeh gate @0.95 ✓)
- برقا (Burqa village), واد الشاجنة (Wadi al-Shajna, Hebron)

**variant-of-cataloged (real place, status-polluted raw_name → needs name normalization before promote):**
اللبن الشرقي الساوية (al-Lubban ash-Sharqiya), بوابات العروب مغلقات ("Arroub gates closed"), دورا واد الشاجنة, ال 17 (checkpoint "17" near Asira).

**parse-failure:** باتجاه قرية رافات ("towards Rafat village" — directional phrase, real place embedded).

## M2 findings
1. **Promote loop is stalled: 0 of 5,275 candidates promoted** despite 46 vetted `real`@0.90-0.95. Real checkpoints (Silat adh-Dhahr, Bani Na'im, Al-Badhan, Wadi Qana, Azzun-Jayyous bridge, Taybeh gate, +~15 more after dedup) have sat unserved for a month. Auto-promote is off by design, but nothing replaced the manual review either.
2. **Vetter false-negatives:** real Hebron/Ramallah checkpoints (Farsh al-Hawa, Ein Siniya, Tunayb, Mukhmas, Al-Bireh N. entrance) marked not_a_checkpoint at 0.0-0.3. The vetter under-recognizes checkpoints whose name is a bare place/junction without a gate word.
3. **Vetting stalled:** only 179 of 5,275 candidates (3.4%) ever got an LLM verdict — matches llm_cache last write 2026-06-24. The other 5,096 are unvetted.
4. **raw_name pollution:** many real candidates carry status words ("مغلقات/سالكات/الان نزل") baked into the name — extraction grabs "checkpoint + status" as one string, so dedup against the catalog misses and the promoted name would be wrong. Name-normalization is a prerequisite for promotion.
