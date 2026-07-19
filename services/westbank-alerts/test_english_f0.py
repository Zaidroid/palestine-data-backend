"""English-language coverage (bounded): real West Bank ground events reported in
English (detentions/raids/searches) should classify. Hard-gated against the two
big English non-event families — MoH daily statistics and Lebanon/regional — which
must still discard.

Run: pytest test_english_f0.py -v
"""
from app.classifier import classify, classify_wb_operational, is_security_relevant


def _t(text, source="eyeonpalestine2"):
    c = None
    if is_security_relevant(text):
        c = classify(text, source)
    if c is None:
        c = classify_wb_operational(text, source)
    return c is not None


# --- real English WB ground events must fire ---
def test_english_detention_yabad():
    assert _t("Israeli forces detain a young Palestinian man in the town of Ya'bad, south of Jenin.")

def test_english_raid_albireh():
    assert _t("An Israeli army force entered the city of Al-Bireh and searched a children's toy store.")

def test_english_child_detention_silwan():
    assert _t("The Israeli occupation forces detain a Palestinian child in Silwan, in occupied Jerusalem.")

def test_english_arrest_incursion():
    assert _t("Occupation forces arrest a young man and a woman during an incursion into the town of Kafr Qaddum.")


# --- English non-events must still discard ---
def test_english_moh_statistics_filtered():
    assert not _t("The Palestinian Ministry of Health in Gaza reported on June 15, 2026, that over the past 24 hours 2 martyrs and 5 injuries arrived at hospitals.")

def test_english_lebanon_filtered():
    assert not _t("Israeli occupation forces continue to shell multiple areas in southern Lebanon.")

def test_english_solidarity_filtered():
    assert not _t("In New Jersey, a woman supporting the occupation attacks a Muslim family in a store.")
