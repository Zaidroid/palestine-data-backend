"""F7 — media/commentary content misclassified as events must be filtered:
podcasts, infographics, court rulings, prisoner-release, body-recovery, vigils.
Real kinetic events with similar words must STILL fire.

Run: pytest test_media_fp_f7.py -v
"""
from app.classifier import classify, classify_wb_operational, is_security_relevant


def _t(text, source="QudsN"):
    c = None
    if is_security_relevant(text):
        c = classify(text, source)
    if c is None:
        c = classify_wb_operational(text, source)
    return c is not None


# --- media containers (M1 FPs) must be filtered ---
def test_podcast_filtered():
    assert not _t("📹 غزة بودكاست| الحلقة 13| كيف تعامل أطباء شمال غزة مع آلاف الإصابات بدون مقومات")

def test_infographic_filtered():
    assert not _t("📊 إنفوجرافيك صفا| أزمة المياه في غزة: الموت عطشًا")

def test_court_ruling_filtered():
    assert not _t("أصدرت محكمة الاحتلال في القدس قراراً يقضي بإلزام سلطة الطبيعة برفع يدها عن الأرض")

def test_prisoner_release_filtered():
    assert not _t("#شاهد| لحظة وصول 12 أسيرًا محررًا من سجون الاحتلال إلى مستشفى شهداء الأقصى بدير البلح")

def test_body_recovery_filtered():
    assert not _t("الدفاع المدني بغزة يستأنف عمليات انتشال جثامين الشهداء من تحت الركام")

def test_solidarity_vigil_filtered():
    assert not _t("أطباء وعاملون في القطاع الصحي ينظمون وقفة تضامنية في مجمع الشفاء مطالبين بالإفراج عن الكوادر")


# --- real kinetic events must STILL fire (no over-filtering) ---
def test_real_gaza_strike_still_fires():
    assert _t("عاجل | طيران الاحتلال يشن غارتين على مواصي مدينة خان يونس جنوب قطاع غزة")

def test_real_injury_still_fires():
    assert _t("عاجل | إصابة شاب برصاص قوات الاحتلال خلال اقتحام بلدة بيت أمر شمال الخليل")

def test_real_arrest_still_fires():
    assert _t("قوات الاحتلال تعتقل فلسطينيا في مسافر يطا جنوب الخليل")

def test_real_hospital_strike_still_fires():
    assert _t("#متابعة| نقل 12 إصابة إلى مستشفى السرايا الميداني جراء استهداف طيران الاحتلال خيمة")
