"""
Classifier false-positive regression suite.

Built from the live audit on 2026-04-19 (Task #34): 200 fresh alerts pulled
from the production API revealed a 26% FP rate concentrated in three patterns:

  1. Lebanon/Syria/Iran casualty narratives mis-tagged as `west_bank_siren`
     (root cause: bare `تل` in WB_ZONE substring-matched `تل ابيب` / `مقاتلو`,
     plus Tier 1 MENA branch fired on any `عاجل` marker)
  2. Photo/video caption posts ("جانب من اقتحام …") duplicating prior alerts
  3. Eulogy and biographical recap posts ("ننعى …", "من أيقونات …")

These fixtures lock the fix in place. Run with:

    python3 test_classifier_fp_audit.py
"""
import sys
from app.classifier import classify, classify_wb_operational


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

# 4. True positives — must continue to classify (not None) with expected type.
TRUE_POSITIVES = [
    ("قوة من جيش الاحتلال تقتحم بلدة كوبر شمال رام الله.", "qudsn", "idf_raid"),
    ("مصادر محلية: قوات الاحتلال تعتقل الشقيقين خلال اقتحام شارع سفيان وسط "
     "مدينة نابلس.", "qudsn", "idf_raid"),
    ("عاجل| إصابة فلسطيني بجروح خطيرة برصاص جيش الاحتلال بمخيم حلاوة في "
     "جباليا البلد شمالي غزة.", "qudsn", "injury_report"),
    ("جيش الاحتلال يهدم منزل المواطن أحمد العاروري في قرية كوبر",
     "qudsn", "demolition"),
]


def main() -> int:
    failures = []

    for text, source in LEBANON_NOT_SIREN:
        r = _classify(text, source)
        if r is not None and "west_bank_siren" in str(r["type"]):
            failures.append(("LEBANON_NOT_SIREN", text[:60], str(r["type"])))

    for text, source in PHOTO_CAPTIONS:
        r = _classify(text, source)
        if r is not None:
            failures.append(("PHOTO_CAPTION", text[:60], str(r["type"])))

    for text, source in EULOGIES:
        r = _classify(text, source)
        if r is not None:
            failures.append(("EULOGY", text[:60], str(r["type"])))

    for text, source, expected in TRUE_POSITIVES:
        r = _classify(text, source)
        if r is None:
            failures.append(("TRUE_POSITIVE_LOST", text[:60], "None"))
        elif str(r["type"]).split(".")[-1] != expected:
            failures.append(("TRUE_POSITIVE_MISCLASSIFIED",
                             text[:60], f"{r['type']} (wanted {expected})"))

    total = (len(LEBANON_NOT_SIREN) + len(PHOTO_CAPTIONS)
             + len(EULOGIES) + len(TRUE_POSITIVES))
    passed = total - len(failures)
    print(f"Classifier FP audit: {passed}/{total} passed")
    for kind, text, got in failures:
        print(f"  FAIL [{kind}] got={got}: {text}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
