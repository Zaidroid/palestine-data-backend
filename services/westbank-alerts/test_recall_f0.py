"""F0 — recall: real WB/Gaza safety events the classifier was dropping should
now fire. These are TRUE trigger/verb gaps (verified from the M5 corpus discard
sample). NOT included: caption-dedup cases ("جانب من اقتحام…", "من مواجهات…" =
footage of an already-reported event) and funerals — those filters are correct.

Any non-None classification counts as caught (the type is checked loosely; the
point of F0 is to stop DISCARDING real events). Run: pytest test_recall_f0.py -v
"""
from app.classifier import classify, classify_wb_operational, is_security_relevant


def _fires(text, source="QudsN"):
    c = None
    if is_security_relevant(text):
        c = classify(text, source)
    if c is None:
        c = classify_wb_operational(text, source)
    return c is not None


def _type(text, source="QudsN"):
    c = None
    if is_security_relevant(text):
        c = classify(text, source)
    if c is None:
        c = classify_wb_operational(text, source)
    t = c.get("type") if c else None
    return (t.value if hasattr(t, "value") else t) if c else None


# --- Gaza airstrikes (غارة family, dropped bombs, نسف) ---
def test_gaza_airstrike_gharatayn():
    assert _type("عاجل | طيران الاحتلال يشن غارتين على منطقة شارع روني في مواصي مدينة خان يونس جنوب قطاع غزة") == "gaza_strike"

def test_gaza_quadcopter_bombs():
    assert _fires("عاجل | طائرة كواد كابتر تلقي قنابل قرب دوار بني سهيلا شرق مدينة خانيونس جنوبي قطاع غزة")

def test_gaza_nasf_buildings():
    assert _fires("عاجل | جيش الاحتلال ينفّذ عمليات نسف لمبانٍ سكنية شرقي مدينة غزة")


# --- present-tense arrests (تعتقل) ---
def test_single_arrest_present_tense():
    assert _fires("قوات الاحتلال تعتقل فلسطينيا في مسافر يطا جنوب الخليل")

def test_arrest_four_youths():
    assert _fires("عاجل | قوات الاحتلال تعتقل 4 شبان خلال تواجدهم في منطقة المقشور شمال مدينة قلقيلية")


# --- clashes (مواجهات, not caption-prefixed) ---
def test_clashes_beit_rima():
    assert _fires("عاجل | اندلاع مواجهات بين الشبان وقوات الاحتلال في قرية بيت ريما شمال غرب رام الله")

def test_clashes_jayyus():
    assert _fires("عاجل | اندلاع مواجهات بين الشبّان وقوات الاحتلال في بلدة جَيّوس شمال شرق قلقيلية")


# --- settler present-tense / kill verbs ---
def test_settler_assault_present():
    assert _type("عاجل | مستوطنون يعتدون على عائلة إبراهيم الجبور بالضرب ورش غاز الفلفل في منطقة حوارة شرق يطا") == "settler_attack"

def test_settler_kill_livestock():
    assert _type("مستوطنون يقتلون أغنام الفلسطينيين بحقنها بمادة سامة في واد الرخيم في الخليل") == "settler_attack"


# --- house search (تفتيش) ---
def test_house_search_anata():
    assert _fires("قوات الاحتلال تقوم بتفتيش منزل علي يطاوي المنطقة الصناعية عناتا بالقدس المحتلة")


# --- GUARDRAILS: correct filters must still hold (no new FPs) ---
def test_caption_footage_still_filtered():
    # "جانب من اقتحام…" = footage of an already-reported raid → still deduped
    assert not _fires("جانب من اقتحام قوات الاحتلال لحي الكسارات المحاذي لمخيم قلنديا شمالي القدس المحتلة")

def test_funeral_still_filtered():
    assert not _fires("تشييع جثمان الشهيد الطفل وليد نضال أبو سنينة الذي ارتقى برصاص قوات الاحتلال")
