"""
Classifier accuracy harness.

Originally built from the live audit on 2026-04-19 (Task #34). Expanded
2026-04-25 with three more fixture buckets covering issues the operator
hit in production:

  4. NEWS_METADATA_LEAK — daily roundups, headline summaries, and posts
     where action verbs sit inside news/photo metadata rather than
     describing a live event. Today these slip past CAPTION_PREFIX.
  5. GEO_PRECISION — village/camp/neighborhood inside a city; the most
     specific named place must win over the containing city.
  6. HISTORICAL_REFERENCE — anniversaries, retrospectives, last-year/
     last-month posts. The verb is real but the event is not live.

Run the regression suite (CI-friendly, exits non-zero on any miss):
    python3 test_classifier_fp_audit.py

Run the eval summary (per-bucket numbers + mismatch listing):
    python3 test_classifier_fp_audit.py --summary
"""
import asyncio
import sys
from pathlib import Path

# Bootstrap the gazetteer singleton so geo tests can resolve villages that
# only live in known_locations.json (Anata, Kafr Qaddum, …) and not in
# the hardcoded AREA_MAP. In production this happens during app startup;
# in the test we drive it synchronously here.
import app.location_knowledge_base as _lkb
_kb = _lkb.LocationKnowledgeBase()
asyncio.run(_kb.load_from_file(Path(__file__).parent / "data" / "known_locations.json"))
_lkb._location_kb = _kb

from app.classifier import classify, classify_wb_operational  # noqa: E402


def _classify(text: str, source: str):
    return classify(text, source) or classify_wb_operational(text, source)


# 1. Lebanon casualty narratives — must NOT be west_bank_siren.
LEBANON_NOT_SIREN = [
    ("الاحتلال يعترف.. مقتل جندي وإصابة 9 آخرين في انفجار عبوة ناسفة "
     "زرعها مقاتلو حزب الله في جنوب لبنان.", "qudsn"),
    ("عاجل| تحت بند سمح بالنشر.. مصادر عبرية: مقتل الرقيب أول (احتياط) "
     "ليدور بورات من الكتيبة 7106 في المعارك جنوب لبنان.", "qudsn"),
    ("عاجل | الإذاعة الإسرائيلية: سكان بلدات حدودية يبدأون مسيرة باتجاه "
     "رئاسة الوزراء للتظاهر ضد وقف إطلاق النار في #لبنان", "ajanews"),
    ("عاجل | القناة 12 عن رئيس بلدية تل أبيب: ألف شقة سكنية في المدينة باتت "
     "غير صالحة للسكن بفعل الصواريخ الإيرانية", "qudsn"),
]

# 2. Photo / video captions — must be filtered (None).
PHOTO_CAPTIONS = [
    ("جانب من اقتحام بلدة عناتا شمال القدس المحتلة", "qudsn"),
    ("من اقتحام محيط مفترق مدرسة الكندي في مدينة نابلس.", "qudsn"),
    ("جانب من اقتحام قوات الاحتلال لشارع فيصل وسط نابلس", "qudsn"),
    ("بالصور | اقتحام مخيم الجلزون شمال رام الله", "qudsn"),
    ("بالفيديو | مواجهات في بلدة بيتا جنوب نابلس", "qudsn"),
]

# 3. Eulogies / biographical recaps — must be filtered (None).
EULOGIES = [
    ("حركة الجهاد الإسلامي: ننعى الشيخ ناجي فايز القزاز مؤذن المسجد المبارك، "
     "الذي توفي مساء أمس السبت", "qudsn"),
    ("من أيقونات الصمود الأسطوري وعدم الاعتراف بالتحقيق.. الشهيد الأسير نادر "
     "العفوري.. قضى سنوات في الاعتقال", "qudsn"),
    ("سرايا القدس: ننعى كوكبة من قادة الاختصاصات العسكرية", "qudsn"),
]

# 4. NEW — News-metadata leakage. Daily roundups, photo galleries without
#    the standard caption prefix, headline summaries citing a newspaper.
#    Must be filtered (None) — the verb is in metadata, not a live event.
NEWS_METADATA_LEAK = [
    # Daily roundup — multiple events in one post, listing-style
    ("أبرز ما جرى اليوم في الضفة الغربية: اقتحامات ومواجهات واعتقالات في "
     "عدة بلدات.", "qudsn"),
    ("ملخص اليوم: 12 مداهمة و34 معتقلاً ومواجهات في الضفة وغزة", "qudsn"),
    # Newspaper citation about a past raid — historical, not live
    ("صحيفة هآرتس: الجيش الإسرائيلي اقتحم بلدة كفر قدوم خلال الأسبوع الماضي "
     "وأصاب عدداً من المواطنين.", "qudsn"),
    # Photo gallery without "بالصور |" prefix — uses "صور" inline
    ("صور من اقتحام قوات الاحتلال لمخيم جنين فجر اليوم", "qudsn"),
    # Tag / hashtag-only post promoting an article
    ("تقرير | قراءة في تصاعد عمليات اقتحام الضفة الغربية #الضفة_الغربية "
     "#اقتحامات", "qudsn"),
    # Editorial / analysis post
    ("تحليل: ماذا يعني تصاعد اقتحامات الجيش لبلدات شمال الضفة؟", "qudsn"),
]

# 5. NEW — Geo precision. The post names a village/camp/neighborhood
#    inside a city. The most specific place must win over the city.
#    Tuple: (text, source, expected_event_type, expected_area).
GEO_PRECISION = [
    # Anata is in East Jerusalem; village should win over city.
    # Gazetteer transliterates ع as a leading apostrophe → "'Anata".
    ("قوات الاحتلال تقتحم بلدة عناتا شمال شرق القدس وتعتقل شابين.",
     "qudsn", "idf_raid", "'Anata"),
    # Kafr Qaddum is west of Qalqilya — village should win
    ("اشتباكات بين شبان وقوات الاحتلال في قرية كفر قدوم غرب قلقيلية.",
     "qudsn", "idf_raid", "Kafr Qaddum"),
    # Balata refugee camp east of Nablus — canonical label "Balata Camp"
    ("اقتحام مخيم بلاطة شرق نابلس واعتقال 4 شبان.",
     "almustashaar", "idf_raid", "Balata Camp"),
    # Beit Dajan east of Nablus
    ("مستوطنون يخرّبون 50 شجرة زيتون في قرية بيت دجن شرق نابلس.",
     "qudsn", "settler_attack", "Beit Dajan"),
    # Huwara south of Nablus — well-known flashpoint, must resolve to Huwara
    ("جيش الاحتلال يهدم منزلاً في بلدة حوارة جنوب نابلس.",
     "qudsn", "demolition", "Huwara"),
    # Already-correct case — verify city when no village named
    ("اقتحام مدينة نابلس واعتقال شابين من شارع فيصل.",
     "qudsn", "idf_raid", "Nablus"),
]

# 6. NEW — Historical / anniversary references. Verb is real but the
#    event isn't live. Must be filtered (None) or, if returned, must
#    not be classified as a live raid/attack.
HISTORICAL_REFERENCE = [
    # Anniversary post
    ("في الذكرى السنوية لاستشهاد الشاب أحمد، نستذكر اقتحام جيش الاحتلال "
     "للبلدة قبل عام.", "qudsn"),
    # Last month
    ("في الشهر الماضي اقتحمت قوات الاحتلال بلدة كفر قدوم وأصابت عدداً "
     "من المواطنين.", "qudsn"),
    # Last year
    ("قبل عام، شنّ الجيش الإسرائيلي عملية واسعة في مخيم جنين.", "qudsn"),
    # Year-explicit historical
    ("خلال عام 2023 شهدت الضفة الغربية تصاعداً ملحوظاً في عمليات "
     "الاقتحام والاعتقال.", "qudsn"),
    # Memorial / commemoration
    ("في ذكرى مجزرة جنين، نستذكر شهداء الاقتحام الذي وقع قبل ثلاث سنوات.",
     "qudsn"),
]

# True positives — must continue to classify (not None) with expected type.
# Optional 4th element = expected `area`. None means we don't assert area.
TRUE_POSITIVES = [
    ("قوة من جيش الاحتلال تقتحم بلدة كوبر شمال رام الله.",
     "qudsn", "idf_raid", None),
    ("مصادر محلية: قوات الاحتلال تعتقل الشقيقين خلال اقتحام شارع سفيان وسط "
     "مدينة نابلس.", "qudsn", "idf_raid", "Nablus"),
    ("عاجل| إصابة فلسطيني بجروح خطيرة برصاص جيش الاحتلال بمخيم حلاوة في "
     "جباليا البلد شمالي غزة.", "qudsn", "injury_report", None),
    ("جيش الاحتلال يهدم منزل المواطن أحمد العاروري في قرية كوبر",
     "qudsn", "demolition", None),
]


def _type_name(t):
    return str(t).split(".")[-1]


def _run_all():
    """Run every fixture; return a list of buckets with per-row outcome."""
    buckets = []

    # FP buckets — pass = classifier returned None (or, for LEBANON, returned
    # something other than west_bank_siren).
    def _fp_bucket(name, rows, also_fail_when):
        outcomes = []
        for entry in rows:
            text, source = entry[0], entry[1]
            r = _classify(text, source)
            failed = also_fail_when(r)
            outcomes.append({
                "ok": not failed,
                "text": text,
                "source": source,
                "got": _type_name(r["type"]) if r else "None",
                "got_area": (r.get("area") if r else None),
                "expected": "None",
                "expected_area": None,
            })
        buckets.append({"name": name, "kind": "fp", "outcomes": outcomes})

    _fp_bucket("LEBANON_NOT_SIREN", LEBANON_NOT_SIREN,
               lambda r: r is not None and "west_bank_siren" in str(r["type"]))
    _fp_bucket("PHOTO_CAPTIONS", PHOTO_CAPTIONS, lambda r: r is not None)
    _fp_bucket("EULOGIES", EULOGIES, lambda r: r is not None)
    _fp_bucket("NEWS_METADATA_LEAK", NEWS_METADATA_LEAK, lambda r: r is not None)
    _fp_bucket("HISTORICAL_REFERENCE", HISTORICAL_REFERENCE,
               lambda r: r is not None)

    # GEO_PRECISION — pass = correct event_type AND correct area.
    geo_outcomes = []
    for text, source, expected_type, expected_area in GEO_PRECISION:
        r = _classify(text, source)
        type_ok = r is not None and _type_name(r["type"]) == expected_type
        area_ok = r is not None and r.get("area") == expected_area
        geo_outcomes.append({
            "ok": type_ok and area_ok,
            "text": text,
            "source": source,
            "got": _type_name(r["type"]) if r else "None",
            "got_area": (r.get("area") if r else None),
            "expected": expected_type,
            "expected_area": expected_area,
        })
    buckets.append({"name": "GEO_PRECISION", "kind": "geo",
                    "outcomes": geo_outcomes})

    # TRUE_POSITIVES — must classify, must match type, and area if asserted.
    tp_outcomes = []
    for entry in TRUE_POSITIVES:
        text, source, expected_type = entry[0], entry[1], entry[2]
        expected_area = entry[3] if len(entry) > 3 else None
        r = _classify(text, source)
        type_ok = r is not None and _type_name(r["type"]) == expected_type
        area_ok = (expected_area is None) or (r is not None
                                              and r.get("area") == expected_area)
        tp_outcomes.append({
            "ok": type_ok and area_ok,
            "text": text,
            "source": source,
            "got": _type_name(r["type"]) if r else "None",
            "got_area": (r.get("area") if r else None),
            "expected": expected_type,
            "expected_area": expected_area,
        })
    buckets.append({"name": "TRUE_POSITIVES", "kind": "tp",
                    "outcomes": tp_outcomes})

    return buckets


def _print_summary(buckets):
    """Per-bucket stats + a flat list of failures with diff."""
    print("\n=== Classifier eval summary ===\n")
    total_n = total_ok = 0
    for b in buckets:
        n = len(b["outcomes"])
        ok = sum(1 for o in b["outcomes"] if o["ok"])
        rate = (ok / n * 100) if n else 0
        total_n += n
        total_ok += ok
        marker = "OK " if ok == n else "MISS"
        print(f"  [{marker}] {b['name']:24s} {ok:>2}/{n:<2}  ({rate:5.1f}%)")
    overall = (total_ok / total_n * 100) if total_n else 0
    print(f"\n  TOTAL: {total_ok}/{total_n} ({overall:.1f}%)\n")

    # Failure listing
    misses = [(b["name"], o) for b in buckets for o in b["outcomes"] if not o["ok"]]
    if misses:
        print("=== Misses ===\n")
        for name, o in misses:
            exp = o["expected"]
            if o["expected_area"]:
                exp = f"{exp} @ {o['expected_area']}"
            got = o["got"]
            if o["got_area"]:
                got = f"{got} @ {o['got_area']}"
            text = o["text"][:90].replace("\n", " ")
            print(f"  [{name}] expected={exp} got={got}")
            print(f"      {text}")


def main(argv) -> int:
    summary_mode = "--summary" in argv

    buckets = _run_all()

    if summary_mode:
        _print_summary(buckets)

    failures = [(b["name"], o) for b in buckets for o in b["outcomes"] if not o["ok"]]

    total = sum(len(b["outcomes"]) for b in buckets)
    passed = total - len(failures)
    if not summary_mode:
        print(f"Classifier FP audit: {passed}/{total} passed")
        for name, o in failures:
            text = o["text"][:60].replace("\n", " ")
            got = o["got"]
            if o["got_area"]:
                got = f"{got} @ {o['got_area']}"
            print(f"  FAIL [{name}] got={got}: {text}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
