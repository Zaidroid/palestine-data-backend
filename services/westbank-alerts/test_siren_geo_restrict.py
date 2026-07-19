"""F1 — west_bank_siren must be geo-restricted to Israel/WB/Gaza-proper.
Foreign MENA sirens (Bahrain/Kuwait/Jordan/...) → regional_attack, not west_bank_siren.

Run:  pytest test_siren_geo_restrict.py -v
"""
from app.classifier import classify


def _type(text, source="QudsN"):
    r = classify(text, source)
    return r.get("type").value if r and hasattr(r.get("type"), "value") else (r.get("type") if r else None)


# --- foreign MENA sirens must NOT be west_bank_siren (measured FPs, M1) ---
def test_bahrain_siren_is_regional():
    assert _type("صفارات الإنذار تدوي مجددا في البحرين") != "west_bank_siren"

def test_kuwait_bahrain_siren_is_regional():
    assert _type("الكويت والبحرين تفعلان صفارات الإنذار وتدعوان السكان إلى التوجه لأماكن آمنة") != "west_bank_siren"

def test_jordan_amman_siren_is_regional():
    assert _type("عاجل | صفارات الإنذار تدوي في العاصمة الأردنية عمان ومناطق مختلفة من الأردن") != "west_bank_siren"

# adjectival country forms in bylines ("الداخلية البحرينية", "التلفزيون الأردني")
def test_bahrain_adjectival_byline_is_regional():
    assert _type("🔴 متابعة صفا| الداخلية البحرينية: إطلاق صفارة الإنذار وعلى المواطنين التوجه للملاجئ") != "west_bank_siren"

def test_jordan_adjectival_tv_is_regional():
    assert _type("عاجل | التلفزيون الأردني: إطلاق صفارات الإنذار في مختلف مناطق المملكة") != "west_bank_siren"


# --- real Israel/WB sirens (shared airspace) must STAY west_bank_siren ---
def test_telaviv_siren_still_wb():
    assert _type("صافرات الإنذار تدوي في تل أبيب بعد إطلاق صواريخ") == "west_bank_siren"

def test_ramallah_siren_still_wb():
    assert _type("دوي صافرات الإنذار في رام الله والمناطق المجاورة") == "west_bank_siren"
