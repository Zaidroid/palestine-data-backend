"""F4 — a leading reporter byline ("مراسل صفا:") must not make an event
classify as journalist_targeted. The event after the byline classifies on its
own merits (also recovers recall). A real journalist-targeting stays.

Run:  pytest test_reporter_byline.py -v
"""
from app.classifier import classify_wb_operational, classify, is_security_relevant


def _rtype(text, source="safaps"):
    c = None
    if is_security_relevant(text):
        c = classify(text, source)
    if c is None:
        c = classify_wb_operational(text, source)
    t = c.get("type") if c else None
    return t.value if hasattr(t, "value") else t


# --- byline-prefixed events must NOT be journalist_targeted (measured FPs, M1) ---
def test_byline_injury_not_journalist():
    t = _rtype("🔴 مراسل صفا: إصابة الشاب أشرف ياسين خضر بعيار ناري في الرئة من قبل جيش الاحتلال الإسرائيلي بمقابر النمساوي غربي خانيونس")
    assert t != "journalist_targeted"

def test_byline_truckdriver_not_journalist():
    t = _rtype("🔴 مراسل صفا: استشهاد سائق شاحنة برصاص جيش الاحتلال الإسرائيلي في مواصي مدينة رفح جنوبي قطاع غزة")
    assert t != "journalist_targeted"

def test_byline_gunfire_not_journalist():
    t = _rtype("🔴 مراسل صفا: إطلاق نار كثيف من آليات الاحتلال محيط مدرسة الهاشمية بحي التفاح شرقي مدينة غزة")
    assert t != "journalist_targeted"


# --- a REAL journalist targeting (journalist is the object) must STILL fire ---
def test_real_journalist_targeting_kept():
    t = _rtype("إصابة الصحفي معاذ عمارنة برصاص قوات الاحتلال")
    assert t == "journalist_targeted"

# --- and it still fires even WITH a reporter byline in front of it ---
def test_real_journalist_targeting_kept_with_byline():
    t = _rtype("🔴 مراسل صفا: إصابة الصحفي معاذ عمارنة برصاص قوات الاحتلال")
    assert t == "journalist_targeted"
