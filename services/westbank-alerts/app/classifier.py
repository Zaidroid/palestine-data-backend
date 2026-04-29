"""
Alert classifier — multi-channel, two-tier model.

Designed to handle three distinct Telegram channel formats:
  - Almustashaar: structured military/security alerts (sirens, missiles)
  - WAFA (@WAFAgency): formal Palestinian news wire (longer, narrative)
  - Quds News (@QudsN): breaking news with عاجل markers, short bursts

Tier 1 (HIGH):  Missile/rocket sirens or confirmed impacts affecting West Bank.
Tier 2 (MED):   WB operational events — IDF raids, settler attacks, demolitions,
                road closures, flying checkpoints, injury reports, arrest campaigns.
Tier 3 (LOW):   Regional attacks on MENA countries or Israel interior.

DISCARD:        Political statements, IRGC press releases, analysis, forecasts,
                casualty news without an active event, general news.
"""

import re
from typing import Optional
from .models import AlertType, Severity


# ── Text normalization ───────────────────────────────────────────────────────
# Arabic has many variant spellings. Normalize before matching to catch more.

_ALEF_VARIANTS = re.compile(r"[إأآٱا]")
_TAA_MARBUTA = re.compile(r"ة")
_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]")


def _normalize(text: str) -> str:
    """Normalize Arabic text for keyword matching."""
    t = _DIACRITICS.sub("", text)
    t = _ALEF_VARIANTS.sub("ا", t)
    t = _TAA_MARBUTA.sub("ه", t)
    return t


# ── Channel → Tier routing ───────────────────────────────────────────────────
# All channels can contribute to both tiers. News channels (WAFA, QudsN) report
# on both missiles and ground ops. Almustashaar also occasionally reports raids.

_NEWS_CHANNELS = {
    # West Bank / general
    "wafagency", "qudsn", "wafanews", "ajanews",
    # Gaza-heavy agencies
    "palinfoar", "shihabagency", "shehabagency",
    "almayadeennews", "almayadeennewspal",
    # Gaza official / health
    "mohmediagaza",
}


def _channel_allows_tier(source: str, tier: str) -> bool:
    """All channels are allowed on all tiers."""
    return True


def _is_news_channel(source: str) -> bool:
    """Check if source is a formal news channel (relaxed noise filtering)."""
    return source.lower().lstrip("@") in _NEWS_CHANNELS


# ── Attack / event verbs ──────────────────────────────────────────────────────
# At least one of these must be present for Tier 1 (missile/siren) classification.

ATTACK_VERBS_AR = [
    # Sirens / warnings
    "صافرات", "انذار", "صافره الانذار",
    # Falling / impact
    "سقط", "سقوط", "سقطت", "تسقط", "يسقط",
    # Explosions
    "انفجار", "انفجارات", "انفجر", "تفجير",
    # Shelling / strikes
    "قصف", "يقصف", "تقصف", "قصفت",
    "ضربه صاروخيه", "ضربه جويه", "ضربات",
    # Barrages / launches
    "رشقه صاروخيه", "رشقه", "رشقات",
    "اطلاق صواريخ",
    "هجوم صاروخي",
    # Rockets / missiles
    "صاروخ", "صواريخ", "قذيفه", "قذائف",
    # Attack
    "تحت النار",
    "دوي انفجار",
    "غاره جويه", "غاره", "غارات", "غارات جويه",
    "طائره مسيره", "مسيره",
]

ATTACK_VERBS_EN = [
    "sirens", "missile", "rocket", "explosion", "strike", "barrage",
    "fired", "launched", "impact", "blast", "airstrike", "drone",
    "shelling", "projectile", "mortar",
]

# ── Palestinian geography — West Bank + Gaza Strip ───────────────────────────
# Historically named WB_ZONE for back-compat; now covers all of occupied Palestine.
# Normalized (alef→ا, taa marbuta→ه). Includes governorate capitals, towns,
# villages, refugee camps, and areas frequently mentioned in WAFA/QudsN/Shehab.

WB_ZONE = [
    # General
    "الضفه الغربيه", "الضفه", "فلسطين",
    "الاغوار", "غور الاردن",
    "قطاع غزه", "غزه", "القطاع", "قطاع",

    # Governorate capitals
    "رام الله", "ramallah",
    "القدس", "نابلس", "جنين", "طولكرم", "الخليل", "بيت لحم",
    "قلقيليه", "اريحا", "طوباس", "سلفيت",

    # Nablus governorate
    "حواره", "بيتا", "بلاطه", "عصيره الشماليه", "عصيره القبليه",
    "بورين", "مادما", "عوره", "عقربا", "قبلان", "يتما",
    "جوريش", "عينابوس", "زعتره", "دير شرف", "سبسطيه",
    "بيت فوريك", "بيت دجن", "روجيب", "كفر قليل", "عزموط",
    "سالم", "الساويه", "اللبن الشرقيه", "قريوت",

    # Jenin governorate
    "مخيم جنين", "يعبد", "قباطيه", "عرابه", "سيله الحارثيه",
    "برقين", "الزبابده", "طمون", "عانين", "جلبون",
    "ميثلون", "ام الريحان", "رمانه", "كفر دان", "فقوعه",
    "عجه", "دير ابو ضعيف", "زبوبا", "طوره الغربيه",

    # Tulkarm governorate
    "مخيم طولكرم", "مخيم نور شمس", "عنبتا", "بلعا",
    "شويكه", "عتيل", "قفين", "دير الغصون", "كفر اللبد",
    "فرعون", "خربه جبارات",

    # Hebron governorate
    "يطا", "دورا", "الظاهريه", "السموع", "حلحول", "بيت امر",
    "بني نعيم", "ترقوميا", "اذنا", "صوريف", "بيت اولا",
    "الشيوخ", "بيت عوا", "الفوار", "العروب", "تفوح",
    "خاراس", "نوبا", "دير سامت", "بيت كاحل",

    # Ramallah/Al-Bireh governorate
    "البيره", "بيتونيا", "بير زيت", "سلواد", "دير نظام",
    "المزرعه الشرقيه", "المزرعه القبليه", "كوبر", "ابوديس",
    "عين عريك", "بيت ريما", "نعلين", "بلعين", "بدرس",
    "دير قديس", "صفا", "كفر نعمه", "ام صفا", "النبي صالح",
    "ترمسعيا", "سنجل", "عابود",

    # Bethlehem governorate
    "بيت ساحور", "بيت جالا", "الدهيشه", "عايده",
    "الخضر", "نحالين", "حوسان", "تقوع", "زعتره",
    "العبيديه", "بيت فجار", "الولجه",

    # Qalqilya governorate
    "عزون", "كفر ثلث", "جيوس", "حبله", "كفر قاسم",

    # Salfit governorate
    "كفل حارس", "بديا", "دير استيا", "بروقين", "مرده",
    "كفر الديك", "اسكاكا",

    # Tubas governorate
    "طمون", "عقابا", "تياسير", "الفارعه",

    # Jericho governorate
    "العوجا", "دير حجله", "فصايل", "النويعمه",

    # East Jerusalem area
    "القدس الكبرى", "الشيخ جراح", "سلوان", "العيساويه",
    "جبل المكبر", "الطور", "شعفاط", "بيت حنينا",
    "العيزريه", "راس العمود", "باب العامود",

    # Major refugee camps
    "مخيم بلاطه", "مخيم نابلس", "مخيم جنين", "مخيم طولكرم",
    "مخيم الفارعه", "مخيم عقبه جبر", "مخيم الامعري",
    "مخيم الجلزون", "مخيم قلنديا", "مخيم شعفاط",
    "مخيم الدهيشه", "مخيم عايده", "مخيم العروب", "مخيم الفوار",

    # Key roads / areas
    "طريق نابلس", "طريق الخليل", "طريق رام الله",
    "المنطقه ج", "المنطقه ب",

    # Israeli settlements in WB (mentioned in context of settler attacks)
    "بيت ايل", "معاليه ادوميم", "كريات اربع", "ارئيل",
    "عوفرا", "يتسهار", "الون موريه", "ايتمار",
    "عمونه", "بيتار عيليت", "ادم", "حلميش",

    # Hebrew transliterated zone names used in Arabic siren reports
    "شومرون", "يهودا وشومرون",

    # ── Gaza Strip ────────────────────────────────────────────────────────────
    # North Gaza governorate
    "شمال غزه", "شمال قطاع غزه",
    "بيت حانون", "بيت لاهيا", "جباليا", "مخيم جباليا",
    "العطاطره", "ام النصر",

    # Gaza City governorate
    "مدينه غزه", "مدينة غزه",
    "الرمال", "الشجاعيه", "التفاح", "الزيتون", "الصبره", "الدرج",
    "الشاطئ", "مخيم الشاطئ", "الشيخ رضوان", "النصر", "تل الهوى",
    "الكراّمه", "الكراّمة", "الكرامه",

    # Deir al-Balah (middle Gaza) governorate
    "دير البلح", "مخيم دير البلح",
    "النصيرات", "مخيم النصيرات",
    "البريج", "مخيم البريج",
    "المغازي", "مخيم المغازي",
    "الزوايده", "وادي السلقا", "المصدر",

    # Khan Younis governorate
    "خان يونس", "مخيم خان يونس",
    "بني سهيلا", "عبسان", "عبسان الكبيره", "عبسان الجديده",
    "القراره", "الفخاري", "خزاعه", "قيزان النجار", "معن",

    # Rafah governorate
    "رفح", "مخيم رفح",
    "تل السلطان", "الشابوره", "الشعوت",
    "المواصي", "البرازيل", "زعرب",

    # Gaza crossings / border areas
    "معبر رفح", "معبر كرم ابو سالم", "معبر بيت حانون", "معبر ايرز",
    "محور نتساريم", "محور فيلادلفيا",
]

# Normalize all WB_ZONE entries at module load
WB_ZONE = [_normalize(z) for z in WB_ZONE]

# ── West Bank Sub-Zones (North / Middle / South) ──────────────────────────────
# Used for zone-based alert display on the map (pulse effect over entire zone).
# Each zone has a center coordinate and a list of area keywords that map to it.

WB_ZONES = {
    "north": {
        "center": (32.22, 35.25),  # Nablus area
        "polygon": [
            [32.55, 34.95],  # NW corner (near Tulkarm/Qalqilya)
            [32.55, 35.50],  # NE corner (Jordan Valley north)
            [32.00, 35.50],  # SE corner (near Jericho)
            [32.00, 34.95],  # SW corner (near Salfit)
        ],
        "keywords": [
            "جنين", "طولكرم", "قلقيليه", "سلفيت", "نابلس", "طوباس",
            "ya'bad", "qabatiya", "arraba", "anabta", "bal'a", "shweikeh",
            "nablus", "jenin", "tulkarm", "qalqilya", "salfit", "tubas",
            "حواره", "بيتا", "بورين", "عصيره", "قبلان", "عرابه", "قباطيه",
            "يعبد", "عنبتا", "كفر ثلث", "عزون", "كفل حارس", "بديا",
        ],
    },
    "middle": {
        "center": (31.90, 35.20),  # Ramallah/Jerusalem area
        "polygon": [
            [32.00, 35.05],  # NW corner
            [32.00, 35.50],  # NE corner (Jericho area)
            [31.70, 35.50],  # SE corner (Dead Sea north)
            [31.70, 35.05],  # SW corner
        ],
        "keywords": [
            "رام الله", "القدس", "اريحا", "abudis", "ramallah", "jerusalem",
            "jericho", "al-bireh", "بيتونيا", "البيره", "ابوديس", "العيزريه",
            "الشيخ جراح", "سلوان", "شعفاط", "بيت حنينا", "جبل المكبر",
            "بير زيت", "سلواد", "النبي صالح", "دير ابوديس", "العوجا",
        ],
    },
    "south": {
        "center": (31.53, 35.10),  # Hebron area
        "polygon": [
            [31.70, 34.90],  # NW corner
            [31.70, 35.30],  # NE corner
            [31.25, 35.30],  # SE corner (south of Hebron)
            [31.25, 34.90],  # SW corner
        ],
        "keywords": [
            "بيت لحم", "الخليل", "bethlehem", "hebron",
            "يطا", "دورا", "حلحول", "بيت امر", "بيت ساحور", "بيت جالا",
            "yatta", "dura", "halhul", "beit ummar", "بيت اولا", "الظاهريه",
            "السموع", "تقوع", "نحالين", "الخضر", "بيت فجار",
        ],
    },

    # ── Gaza Strip sub-zones (north → south) ──────────────────────────────────
    "gaza_north": {
        "center": (31.53, 34.50),  # Beit Hanoun / Jabalia
        "polygon": [
            [31.60, 34.45],  # NW (sea side)
            [31.60, 34.57],  # NE (border)
            [31.48, 34.57],  # SE
            [31.48, 34.45],  # SW
        ],
        "keywords": [
            "شمال غزه", "beit hanoun", "beit lahia", "jabalia",
            "بيت حانون", "بيت لاهيا", "جباليا", "مخيم جباليا",
            "العطاطره", "ام النصر", "north gaza",
        ],
    },
    "gaza_city": {
        "center": (31.50, 34.47),  # Gaza City center
        "polygon": [
            [31.55, 34.40],  # NW (coast)
            [31.55, 34.52],  # NE (border)
            [31.45, 34.52],  # SE
            [31.45, 34.40],  # SW
        ],
        "keywords": [
            "مدينه غزه", "مدينة غزه", "gaza city", "gaza",
            "الرمال", "الشجاعيه", "التفاح", "الزيتون", "الصبره", "الدرج",
            "الشاطئ", "مخيم الشاطئ", "الشيخ رضوان", "تل الهوى",
            "النصر", "الكرامه", "rimal", "shujaiya", "tuffah", "zaytoun",
            "shati", "beach camp",
        ],
    },
    "middle_gaza": {
        "center": (31.42, 34.37),  # Deir al-Balah
        "polygon": [
            [31.48, 34.32],  # NW (coast)
            [31.48, 34.47],  # NE
            [31.36, 34.47],  # SE
            [31.36, 34.32],  # SW
        ],
        "keywords": [
            "دير البلح", "النصيرات", "البريج", "المغازي",
            "deir al-balah", "deir al balah", "nuseirat", "bureij", "maghazi",
            "الزوايده", "وادي السلقا", "المصدر",
            "مخيم النصيرات", "مخيم البريج", "مخيم المغازي",
        ],
    },
    "khan_younis": {
        "center": (31.35, 34.30),  # Khan Younis
        "polygon": [
            [31.40, 34.25],  # NW
            [31.40, 34.40],  # NE
            [31.28, 34.40],  # SE
            [31.28, 34.25],  # SW
        ],
        "keywords": [
            "خان يونس", "khan younis", "khan yunis",
            "بني سهيلا", "عبسان", "القراره", "خزاعه", "الفخاري",
            "قيزان النجار", "bani suheila", "abasan", "qarara", "khuza'a",
            "مخيم خان يونس",
        ],
    },
    "rafah": {
        "center": (31.29, 34.24),  # Rafah
        "polygon": [
            [31.34, 34.20],  # NW
            [31.34, 34.33],  # NE
            [31.22, 34.33],  # SE (Egypt border)
            [31.22, 34.20],  # SW
        ],
        "keywords": [
            "رفح", "rafah", "تل السلطان", "الشابوره", "البرازيل",
            "المواصي", "زعرب", "tel al-sultan", "shaboura", "al-mawasi",
            "مخيم رفح", "معبر رفح", "محور فيلادلفيا", "philadelphi",
        ],
    },
}

# Normalize all zone keywords
for _zone_data in WB_ZONES.values():
    _zone_data["keywords"] = [_normalize(k) for k in _zone_data["keywords"]]


_GAZA_GENERAL_MARKERS = [_normalize(k) for k in [
    "قطاع غزه", "غزه", "قطاع", "gaza",
]]

# Gaza-specific zone markers — ANY of these means the event is in Gaza, not WB.
# Used to route Tier 1 attack-verb messages to gaza_strike instead of
# west_bank_siren (since Gaza keys are also in WB_ZONE for back-compat).
_GAZA_ONLY_MARKERS = [_normalize(k) for k in [
    "قطاع غزه", "قطاع غزة", "قطاع",
    "مدينه غزه", "مدينة غزه", "gaza city", "gaza strip",
    "شمال غزه",
    "بيت حانون", "بيت لاهيا", "جباليا", "مخيم جباليا",
    "العطاطره", "ام النصر",
    "الرمال", "الشجاعيه", "التفاح", "الزيتون", "الصبره", "الدرج",
    "الشاطئ", "مخيم الشاطئ", "الشيخ رضوان", "تل الهوى",
    "دير البلح", "النصيرات", "البريج", "المغازي",
    "مخيم النصيرات", "مخيم البريج", "مخيم المغازي",
    "خان يونس", "مخيم خان يونس", "بني سهيلا", "عبسان", "خزاعه",
    "القراره", "الفخاري", "قيزان النجار",
    "رفح", "مخيم رفح", "تل السلطان", "الشابوره", "المواصي",
    "معبر رفح", "معبر كرم ابو سالم", "معبر بيت حانون", "معبر ايرز",
    "محور نتساريم", "محور فيلادلفيا",
    "beit hanoun", "beit lahia", "jabalia",
    "rimal", "shujaiya", "khan younis", "khan yunis",
    "deir al-balah", "deir al balah", "nuseirat", "rafah",
]]


def _is_gaza_text(normed_text: str) -> bool:
    """Cheap check: does the text mention Gaza generally?"""
    return any(m in normed_text for m in _GAZA_GENERAL_MARKERS)


def _is_gaza_zone(normed_text: str) -> bool:
    """True iff text mentions a Gaza-specific location (not just shared WB keys)."""
    return any(m in normed_text for m in _GAZA_ONLY_MARKERS)


def _extract_zone(normed_text: str) -> str:
    """
    Determine which sub-zone the text refers to.
    Returns WB sub-zones (north/middle/south), Gaza sub-zones
    (gaza_north/gaza_city/middle_gaza/khan_younis/rafah),
    or a coarse fallback ('west_bank' / 'gaza_strip').
    """
    scores = {z: 0 for z in WB_ZONES}
    for zone_name, zone_data in WB_ZONES.items():
        for kw in zone_data["keywords"]:
            if kw in normed_text:
                scores[zone_name] += 1

    best_zone = max(scores, key=scores.get)
    if scores[best_zone] > 0:
        return best_zone

    # Check area name from _extract_area
    area = _extract_area(normed_text)
    if area:
        area_lower = area.lower()
        for zone_name, zone_data in WB_ZONES.items():
            for kw in zone_data["keywords"]:
                if kw in area_lower or area_lower in kw:
                    return zone_name

    # Gaza general fallback — "غزه" mentioned without a specific sub-zone
    if _is_gaza_text(normed_text):
        return "gaza_strip"

    # Check for general WB mention
    if _is_wb_zone(normed_text):
        return "west_bank"

    return ""

# ── MENA / regional zone ──────────────────────────────────────────────────────
MENA_ZONE = [
    "العراق", "عراق", "بغداد", "اربيل", "البصره", "الموصل",
    "الكويت", "كويت",
    "الاردن", "عمان", "اردن",
    "لبنان", "بيروت",
    "سوريا", "دمشق", "حلب",
    "ايران", "طهران", "اصفهان",
    "اليمن", "يمن", "صنعاء", "الحوثي", "الحوثيون",
    "البحرين",
    "السعوديه",
    "منطقه الخليج",
]
MENA_ZONE = [_normalize(z) for z in MENA_ZONE]

# Israel interior as TARGET — missiles/drones hitting these means WB may be next
ISRAEL_AS_TARGET = [
    "تل ابيب", "غوش دان", "حيفا", "نتانيا", "بتاح تكفا",
    "ريشون لتسيون", "هرتسليا", "رعنانا", "بئر السبع",
    "عسقلان", "اشدود", "الجليل",
    "الداخل الاسرائيلي", "العمق الاسرائيلي", "اراضي الاحتلال",
    "المستوطنات", "في اسرائيل",
]
ISRAEL_AS_TARGET = [_normalize(z) for z in ISRAEL_AS_TARGET]

# Israel conducting outward attacks on MENA — not relevant to WB safety
# These messages describe Israel *attacking* Lebanon/Syria/Iran, not the reverse
ISRAEL_ATTACKING_OUT = [
    "اسرائيل قصفت", "قصف اسرائيلي على",
    "غارات اسرائيليه على", "الجيش الاسرائيلي قصف",
    "الجيش الاسرائيلي شن", "شن الجيش الاسرائيلي",
    "طيران اسرائيلي قصف", "قوات اسرائيليه قصفت",
    "القوات الاسرائيليه تقصف", "حرب اسرائيل على",
    "اسرائيل تستهدف", "اسرائيل ضربت", "ضربه اسرائيليه",
    "دبابات اسرائيليه", "توغل اسرائيلي في لبنان",
    "توغل اسرائيلي في سوريا",
]
ISRAEL_ATTACKING_OUT = [_normalize(z) for z in ISRAEL_ATTACKING_OUT]

# Israel interior cities
ISRAEL_INTERIOR = [
    "تل ابيب", "غوش دان",
    "حيفا",
    "نتانيا",
    "بتاح تكفا",
    "كريات اونو", "ريشون لتسيون",
    "هرتسليا", "رعنانا",
    "بئر السبع",
    "عسقلان", "اشدود",
    "الجليل",
    "الشمال",
]
ISRAEL_INTERIOR = [_normalize(z) for z in ISRAEL_INTERIOR]

# Northern Israel (Galilee + border settlements) — Hezbollah-front siren
# events. Distinct from generic west_bank_siren so the live tracker can
# tell "actually a WB threat" from "shared-airspace siren up north".
NORTHERN_ISRAEL_LOCATIONS = [
    # Galilee variants
    "الجليل الاعلى", "الجليل الغربي", "اصبع الجليل",
    "شمال الجليل", "الجليل الشرقي",
    # Northern-front framing
    "شمال فلسطين المحتله", "شمالي فلسطين المحتله",
    "شمال اسرائيل", "شمالي اسرائيل", "شمال إسرائيل", "شمالي إسرائيل",
    "المستوطنات الشماليه", "خط المواجهه الشماليه",
    # Specific border-area towns / settlements (Hezbollah-front)
    "حانيتا", "شلومي", "ياعره", "راس الناقوره",
    "مرجليوت", "مسجاف عام", "المالكيه",
    "كريات شمونه", "متولا", "المطله",
    "نهاريا", "كرميئيل",
    "بنت جبيل",  # Lebanese border town (cross-mention common)
]
NORTHERN_ISRAEL_LOCATIONS = [_normalize(z) for z in NORTHERN_ISRAEL_LOCATIONS]


def _is_northern_israel(text: str) -> bool:
    return _has(text, NORTHERN_ISRAEL_LOCATIONS)


# ── Noise signals — discard if these dominate the message ────────────────────

NOISE_DOMINANT = [
    "المتحدث باسم",
    "في بيان",
    "يزعم الجيش",
    "وفق مصادر",
    "افادت وكاله",
    "قناه عبريه",
    "قناه اسرائيليه",
    "وسائل اعلام",
    "تقرير:",
    "تحليل:",
    "بيان رسمي",
    "هدد",
    "سيقوم",
    "تحذير من",
    "توقعات",
    "مخطط",
]
NOISE_DOMINANT = [_normalize(n) for n in NOISE_DOMINANT]

# Strong news attribution — single hit = discard (no need for 2+ markers)
NEWS_ATTRIBUTION = [
    "القناه 12", "القناه 13", "القناه 14",
    "قناه كان",
    "فرانس برس", "رويترز",
    "وكاله الانباء",
    "هآرتس", "يديعوت", "معاريف",
    "تايمز اوف اسرائيل",
    "نيويورك تايمز", "بلومبرغ", "واشنطن بوست",
    "بحسب مصادر اعلاميه",
    "نقلا عن", "افادت مصادر",
    "بحسب تقارير", "وفق ما افاد", "حسبما افاد",
    "ذكرت وسائل اعلام", "وسائل اعلام اسرائيليه",
    "اعلن المتحدث", "حسب بيان",
    "الرقابه العسكريه تسمح",
    # Report/analysis prefixes — past coverage framed as news, not live events
    "تقرير:", "تقرير |", "تحليل:", "ملخص:", "مراجعه:",
    "ما حدث", "ما جرى", "احداث امس", "اخبار امس",
]
NEWS_ATTRIBUTION = [_normalize(n) for n in NEWS_ATTRIBUTION]

# Future/threat/speculative language — discard conditional statements
SPECULATIVE_NOISE = [
    "سيقوم ب", "اذا استمر",
    "يهدد ب", "يخطط ل",
    "من المتوقع", "قد يؤدي",
    "تنتظر الضوء الاخضر",
    "في الطريق الى",
    "يستعد ل", "يتوقع ان",
]
SPECULATIVE_NOISE = [_normalize(n) for n in SPECULATIVE_NOISE]

# IDF GROUND operations — exclude from missile classifier
GROUND_OP_NOISE = [
    "اعتقال", "اعتقالات",
    "اقتحام", "مداهمه", "مداهمات",
    "قوات الاحتلال دخلت", "اجتاحت قوات",
    "مستوطنون", "مستوطن", "هجوم مستوطنين",
]
GROUND_OP_NOISE = [_normalize(g) for g in GROUND_OP_NOISE]


# ── WB Operational event keyword sets ────────────────────────────────────────

IDF_RAID_VERBS = [
    "اقتحم", "اقتحمت", "اقتحام", "تقتحم", "يقتحم", "يقتحمون",
    "داهم", "داهمت", "مداهمه", "مداهمات", "تداهم", "يداهم",
    "توغل", "توغلت", "اجتاح", "اجتاحت",
    "دخل بالقوه", "قوات خاصه دخلت",
    "اشتباك", "اشتباكات",
    "قوات الاحتلال دخلت", "قوات الاحتلال اقتحمت",
    "جيش الاحتلال اقتحم", "جيش الاحتلال يقتحم",
    "قوات الاحتلال تقتحم",
    "انتشار عسكري", "تعزيزات عسكريه",
    "حصار", "حاصرت قوات", "محاصره",
    "اطلاق نار", "اطلقت النار",
    "قنابل غاز", "قنابل صوت", "غاز مسيل للدموع",
]
IDF_RAID_VERBS = [_normalize(v) for v in IDF_RAID_VERBS]

# Settler compound phrases — self-sufficient (contain actor + action)
SETTLER_ATTACK_PHRASES = [
    "هجوم مستوطنين", "اعتداء مستوطنين",
    "مستوطنين يقتحمون", "مستوطنين يهاجمون",
    "حرق منازل", "حرق سيارات", "حرق مركبات", "احرق مستوطنون",
    "اقتلع اشجار", "اقتلاع اشجار",
    "رشق حجاره على", "اعتداء على مزارعين",
    "هجوم للمستوطنين", "عربده مستوطنين",
    "اعتداءات المستوطنين",
    "مستوطنون يرشقون", "مستوطنون يحرقون",
]
SETTLER_ATTACK_PHRASES = [_normalize(v) for v in SETTLER_ATTACK_PHRASES]

# Settler actor terms — require pairing with an action verb
SETTLER_ACTOR_TERMS = [
    "مستوطنون", "مستوطن", "مستوطنين", "المستوطنين",
]
SETTLER_ACTOR_TERMS = [_normalize(v) for v in SETTLER_ACTOR_TERMS]

SETTLER_ACTION_VERBS = [
    "هاجم", "هاجموا", "اعتدى", "اعتدوا", "حرق", "حرقوا",
    "اقتحم", "اقتحموا", "رشق", "رشقوا", "اتلف", "خرب",
    "قطع", "اقتلع", "دمر", "دمروا", "اطلق النار", "اطلقوا النار",
    "هجم", "نفذ هجوم", "داهم", "نهب",
]
SETTLER_ACTION_VERBS = [_normalize(v) for v in SETTLER_ACTION_VERBS]

ROAD_CLOSURE_TERMS = [
    "اغلاق الطريق", "اغلاق طريق",
    "اغلقت الطريق", "اغلقت طريق",
    "قطع الطريق", "قطع طريق", "قطعت الطريق",
    "طريق مغلق", "الطريق مغلق", "طريق مسدود",
    "نصب حواجز على الطريق", "اغلقت قوات الطريق",
    "اغلاق شارع", "اغلاق الشارع",
    "سواتر ترابيه", "اغلاق المدخل", "اغلاق مدخل",
    "البوابه الحديديه", "اغلقت البوابه",
]
ROAD_CLOSURE_TERMS = [_normalize(t) for t in ROAD_CLOSURE_TERMS]

FLYING_CP_TERMS = [
    "حاجز طيار", "حواجز طياره", "حاجز طائر",
    "نصب حاجزا", "نصب حاجز", "حاجز مفاجئ",
    "حاجز متحرك", "حاجز جديد على",
    "حاجز على مدخل", "حاجز على طريق",
]
FLYING_CP_TERMS = [_normalize(t) for t in FLYING_CP_TERMS]

INJURY_TERMS = [
    "اصابه", "اصابات", "جريح", "جرحى",
    "استشهد", "استشهدت", "استشهاد", "شهيد", "شهداء",
    "نقل للمستشفى", "اصيب", "اصيبوا",
    "اصيب برصاص", "اصابه برصاص", "اصابه حرجه",
    "جرح برصاص", "مصاب",
    "ارتقى", "ارتقاء",    # euphemism for martyrdom
]
INJURY_TERMS = [_normalize(t) for t in INJURY_TERMS]

DEMOLITION_TERMS = [
    "هدم", "هدمت", "هدم منزل", "هدم منازل", "عمليه هدم",
    "تجريف", "جرفت", "جرافات", "جرافه",
    "ازاله", "ازالت قوات",
    "اخطار بالهدم", "اخطارات هدم",
    "هدم ذاتي", "اجبر على هدم",
    "تدمير", "دمرت",
]
DEMOLITION_TERMS = [_normalize(t) for t in DEMOLITION_TERMS]

ARREST_CAMPAIGN_TERMS = [
    "اعتقلت قوات", "اعتقال", "اعتقالات",
    "حمله اعتقالات", "حمله مداهمات واعتقالات",
    "اعتقل الاحتلال", "اعتقلت", "اعتقل",
    "معتقل", "معتقلين",
    "اعتقال عدد", "اعتقال مواطنين",
]
ARREST_CAMPAIGN_TERMS = [_normalize(t) for t in ARREST_CAMPAIGN_TERMS]


# ── B5 — civilian-life impact event keyword sets ────────────────────────────

# Hospital strike: AND of (medical noun) + (raid/strike verb).
# Substring keywords miss "اقتحام جيش الاحتلال لمستشفى" because the noun
# and verb are split by intervening words.
HOSPITAL_NOUNS = [
    "مستشفى", "مستوصف", "مركز صحي", "مجمع طبي", "عياده طبيه",
]
HOSPITAL_NOUNS = [_normalize(t) for t in HOSPITAL_NOUNS]

HOSPITAL_HARM_VERBS = [
    "قصف", "استهداف", "اقتحام", "اقتحم", "محاصره", "ضرب",
]
HOSPITAL_HARM_VERBS = [_normalize(t) for t in HOSPITAL_HARM_VERBS]

# Journalist-targeted is a 2-pass match: subject+verb. Each list alone is
# noisy; the AND in classifier requires both.
JOURNALIST_TARGETED_TERMS = [
    "صحفي", "صحفيه", "صحفيون", "صحفيين", "مراسل", "مراسله", "مراسلين",
    "مصور صحفي", "مصوره صحفيه", "طاقم صحفي",
]
JOURNALIST_TARGETED_TERMS = [_normalize(t) for t in JOURNALIST_TARGETED_TERMS]

JOURNALIST_HARM_VERBS = [
    "استشهد", "استشهاد", "اصيب", "اصابه", "اعتقل", "اعتقال",
    "استهداف", "قصف", "اطلاق نار",
]
JOURNALIST_HARM_VERBS = [_normalize(t) for t in JOURNALIST_HARM_VERBS]

EVACUATION_ORDER_TERMS = [
    "امر اخلاء", "اوامر اخلاء", "اخلاء فوري",
    "تطلب اخلاء", "اوامر بالاخلاء", "اخلاء المنطقه",
    "اخلاء عاجل", "تهجير قسري",
]
EVACUATION_ORDER_TERMS = [_normalize(t) for t in EVACUATION_ORDER_TERMS]

UTILITY_CUTOFF_TERMS = [
    "قطع الكهرباء", "قطع المياه", "قطع التيار الكهربائي",
    "انقطاع الكهرباء", "انقطاع المياه", "ازمه المياه",
    "نفاد الوقود", "ازمه الوقود",
]
UTILITY_CUTOFF_TERMS = [_normalize(t) for t in UTILITY_CUTOFF_TERMS]

CHILD_DETENTION_TERMS = [
    "اعتقال طفل", "اعتقال اطفال", "اعتقل طفلا", "اعتقلت طفله",
    "اعتقال قاصر", "اعتقال قاصرين", "احتجاز اطفال",
]
CHILD_DETENTION_TERMS = [_normalize(t) for t in CHILD_DETENTION_TERMS]

SCHOOL_CLOSURE_TERMS = [
    "اغلاق المدرسه", "اغلاق المدارس", "تعليق الدراسه",
    "تعليق التعليم", "وقف الدراسه", "اغلاق الجامعه",
    "تعليق الدوام المدرسي",
]
SCHOOL_CLOSURE_TERMS = [_normalize(t) for t in SCHOOL_CLOSURE_TERMS]


# ── Breaking news markers (QudsN style) ─────────────────────────────────────

URGENT_MARKERS = [
    "عاجل", "عااجل", "خبر عاجل",
    "الان", "حدث الان",
    "بث مباشر",
]
URGENT_MARKERS = [_normalize(m) for m in URGENT_MARKERS]


# ── FP guard lists (audit 2026-04-19, see TaskGet #34) ──────────────────────
# Active incoming-attack indicators — used to upgrade MENA news from regional
# noise to a WB siren. Mere "عاجل" (breaking news) was insufficient: every
# Lebanese casualty report from QudsN starts with عاجل and was firing as siren.
INCOMING_ATTACK_INDICATORS = [
    "صاروخ", "صواريخ", "صافرات", "صافره", "صفارات",
    "قذائف", "قذيفه", "رشقه", "انذار", "انذارات",
    "تحذير من اطلاق", "تحليق", "مسيره", "مسيرات",
    "اطلاق نار باتجاه", "هدف معاد", "هدف جوي",
]
INCOMING_ATTACK_INDICATORS = [_normalize(t) for t in INCOMING_ATTACK_INDICATORS]

# Photo / video caption prefixes — these are duplicates of already-reported
# events, not new alerts. Anchor at start of message to avoid false matches.
CAPTION_PREFIX_PATTERNS = [
    "جانب من", "من اقتحام", "من مواجهات", "من مظاهرات", "من احتجاجات",
    "صور من", "صوره من", "صور |", "بالصور", "بالفيديو", "فيديو |",
    "مشاهد من", "لقطات من", "بالاسماء |",
]
CAPTION_PREFIX_PATTERNS = [_normalize(t) for t in CAPTION_PREFIX_PATTERNS]

# Eulogy / biographical recap — past-tense remembrance, not new event.
EULOGY_PATTERNS = [
    "ننعى", "نعت ", "تنعى", "ينعى",
    "من ايقونات", "من رموز",
    "قضى سنوات في الاعتقال", "قضى سنوات",
    "الذكرى السنويه", "في ذكرى استشهاد",
]
EULOGY_PATTERNS = [_normalize(t) for t in EULOGY_PATTERNS]

# Solidarity demonstrations / protests ABROAD about Palestine. The verb
# is "تظاهرة"/"اعتصام"/"مسيرة" + foreign-city; not a live event in PS.
SOLIDARITY_LEADING_MARKERS = [
    "تظاهره في", "تظاهرات في", "تظاهرات شعبيه",
    "اعتصام في", "اعتصام امام",
    "مسيره حاشده في", "مسيره في",
    "وقفه تضامنيه", "وقفه احتجاجيه",
]
SOLIDARITY_LEADING_MARKERS = [_normalize(t) for t in SOLIDARITY_LEADING_MARKERS]
SOLIDARITY_CONTEXT = [
    "تضامنا", "تضامناً", "تنديدا", "تنديداً",
    "للمطالبه بوقف", "للمطالبه برفع",
]
SOLIDARITY_CONTEXT = [_normalize(t) for t in SOLIDARITY_CONTEXT]

# Diplomatic news — foreign-minister visits, talks, embassy news. Verbs
# are travel/meeting; not kinetic. Markers chosen to be specific enough
# that a real military "وفد" or "اجتماع" doesn't get filtered.
DIPLOMATIC_MARKERS = [
    "وزير الخارجيه", "الخارجيه الايرانيه", "الخارجيه الامريكيه",
    "الخارجيه السعوديه", "الخارجيه التركيه", "الخارجيه المصريه",
    "وفد دبلوماسي", "محادثات بين", "مباحثات",
    "جوله دبلوماسيه", "زياره دبلوماسيه",
    # Specific officials — extend as more diplomatic FPs appear
    "عراقجي", "بلينكن",
]
DIPLOMATIC_MARKERS = [_normalize(t) for t in DIPLOMATIC_MARKERS]

# Political commentary — analyst/settler/journalist statements about a
# situation. Verb is "تعليق"/"تصريح"/"أرشيف"; the post wraps a quote,
# the wrapper is not a live event.
COMMENTARY_MARKERS = [
    "تعليقا على", "تعليقاً على", "في تعليق على", "في تعليقه على",
    "في تصريح صحفي", "في حديث صحفي", "في حديثه ل",
    "ارشيف التصريحات", "ارشيف تصريحات",
]
COMMENTARY_MARKERS = [_normalize(t) for t in COMMENTARY_MARKERS]

# Non-war health statistics — disease/condition counts that aren't combat
# trauma. Distinct from injury_report which is for kinetic injuries.
NON_WAR_HEALTH_MARKERS = [
    "بسبب القوارض", "بسبب الطفيليات", "بسبب الامراض",
    "بسبب نقص الميا", "بسبب نقص الغذاء", "بسبب البرد",
    "الامراض الجلديه", "الامراض المعديه", "الامراض المزمنه",
    "سوء التغذيه",
]
NON_WAR_HEALTH_MARKERS = [_normalize(t) for t in NON_WAR_HEALTH_MARKERS]

# Family appeals about EXISTING detentions. Family warns/pleads/calls
# for intervention; the detention itself is old, no new event.
FAMILY_APPEAL_LEADING = [
    "عائله",
    "والده الاسير", "والد الاسير", "زوجه الاسير",
    "ذوو الاسير", "ذوي الاسير",
]
FAMILY_APPEAL_LEADING = [_normalize(t) for t in FAMILY_APPEAL_LEADING]
FAMILY_APPEAL_VERBS = [
    "تحذر من", "تطالب", "تناشد", "تطالبون",
    "ينادون", "تناشدون", "تنادي", "يناشد",
]
FAMILY_APPEAL_VERBS = [_normalize(t) for t in FAMILY_APPEAL_VERBS]

# Funeral / burial / posthumous profile. The deceased is named alongside
# a past-tense burial verb. Distinct from a fresh strike report — those
# carry "قصف" / "استهداف" / "إصابة" without the burial framing.
FUNERAL_BURIAL_PATTERNS = [
    "يشيعون جثمان", "يشيعون جثامين",
    "تشييع جثمان", "تشييع جثامين",
    "يودعون جثمان", "يودعون جثامين",
    "يودعون جثامين الشهداء", "يودعون جثامين شهداء",
    "وصول جثمان", "وصول جثامين",
    "في تشييع",
    "الذي ارتقى", "التي ارتقت", "الذين ارتقوا",
    "ارتقى متاثرا بجراح", "ارتقت متاثره بجراح",
    "بالروح بالدم نفديك",
    "جنازه مهيبه", "موكب جنازه",
    "هتاف يعلو فوق جراح الوداع",
]
FUNERAL_BURIAL_PATTERNS = [_normalize(t) for t in FUNERAL_BURIAL_PATTERNS]

# Past-perfect recap: "وكان قد + verb past" / "وكانت قد …" introduces a
# recap clause about a prior event, often nested inside today's news.
# Filter when this leads the post — mid-text use is just background.
PAST_PERFECT_RECAP_LEADING = [
    "وكان قد", "وكانت قد",
    "وكان جيش", "وكانت قوات", "وكانت سلطات", "وكانت وزاره",
    "كانت قد",
]
PAST_PERFECT_RECAP_LEADING = [_normalize(t) for t in PAST_PERFECT_RECAP_LEADING]

# Period summary: "خلال (\d+|واحد) (period word)" — aggregate over a
# time window, not a single event. Two alternations:
#   1. digit + period word ("خلال 48 ساعة")
#   2. period word + "واحد/واحدة" ("خلال أسبوع واحد")
_PERIOD_SUMMARY_RE = re.compile(
    r"خلال\s+(?:"
    r"\d+\s+(?:ساعه|ساعات|يوم|ايام|اسبوع|اسابيع|شهر|اشهر|سنه|اعوام)"
    r"|"
    r"(?:ساعه|يوم|اسبوع|شهر|سنه)\s+واحد[هة]?"
    r")"
)

# Human-interest emotional posts — a video about someone reacting to
# a Palestinian event. The event is real but old; the post is the
# reaction. Filter on framing markers.
HUMAN_INTEREST_MARKERS = [
    "في مقطع فيديو مؤثر", "في فيديو مؤثر",
    "بهذه البراءه", "بهذا الالم", "بهذا الحزن",
    "تروي معاناتها", "يروي معاناته",
    "وهو يغالب دموعه", "وهي تغالب دموعها",
    "تاثرا بمشاهد", "تاثراً بمشاهد",
]
HUMAN_INTEREST_MARKERS = [_normalize(t) for t in HUMAN_INTEREST_MARKERS]

# Humanitarian capacity appeal — local officials reporting equipment
# shortages or fuel/aid scarcity. Not a kinetic event.
HUMANITARIAN_APPEAL_MARKERS = [
    "نعاني نقصا حادا", "نعاني من نقص",
    "نقص حاد في الوقود", "نقص حاد في الميا",
    "نقص حاد في الغذاء", "نقص حاد في الدواء",
]
HUMANITARIAN_APPEAL_MARKERS = [_normalize(t) for t in HUMANITARIAN_APPEAL_MARKERS]

# Spokesperson / leader speech wrappers. Text that is a quoted statement
# from a named regional leader (Iranian IRGC commander, Hezbollah
# secretary-general, US officials via NYT/WSJ etc.) — the post wraps a
# political quote, not a live event. Matches in HEAD only (first 120
# chars) so we don't filter live coverage that mentions the name in
# passing later in the body.
SPOKESPERSON_LEADING_MARKERS = [
    # Iranian leadership
    "قاآني", "اسماعيل قاآني", "قائد قوه القدس",
    "الحرس الثوري الايراني",
    # Hezbollah leadership
    "نصرالله", "السيد نصر الله", "نعيم قاسم",
    # Foreign-press analysis bylines
    "نيويورك تايمز عن مصادر", "نيويورك تايمز نقلا",
    "وول ستريت جورنال", "واشنطن بوست",
    "رويترز عن مصادر", "بلومبرغ عن مصادر",
    "ال بي بي سي عن",
]
SPOKESPERSON_LEADING_MARKERS = [_normalize(t) for t in SPOKESPERSON_LEADING_MARKERS]

# Activism / flotilla / interview-with-activist / commentary-on-video.
# These are media events — coverage of a campaign, an interview, or a
# reaction post. Not security incidents. Hard-filter when present
# anywhere in the text.
ACTIVISM_COMMENTARY_MARKERS = [
    # Flotilla coverage
    "اسطول الصمود", "اسطول الحريه",
    # Interview format
    "مقابله مع الناشط", "مقابله مع الناشطه", "مقابله مع المحلل",
    "في مقابله مع",
    # Reaction-to-post format ("after a settler posted X.. interview..")
    "بعد نشر مستوطن", "بعد نشر فيديو",
    # Activist commentary verbs
    "يتحدث عن الخربه", "تتحدث عن الخربه",
    "يتحدث عن الواقع", "تتحدث عن الواقع",
    "يتحدث عن مخطط", "يتحدث عن المخطط",
]
ACTIVISM_COMMENTARY_MARKERS = [_normalize(t) for t in ACTIVISM_COMMENTARY_MARKERS]

# Aftermath / living-condition descriptions. Present-tense framing of
# someone's post-injury / post-displacement state. The wounded/displaced
# event itself happened earlier — the post is a follow-up profile, not
# a new event report. Caught by HUMAN_INTEREST_MARKERS for video framing,
# but plain prose follow-ups slipped through.
AFTERMATH_LIVING_MARKERS = [
    "يقاسي ظروفا انسانيه", "تقاسي ظروفا انسانيه",
    "في ظروف انسانيه صعبه",
    "يعيش مع اطفاله في", "تعيش مع اطفالها في",
    "داخل خيمته في", "داخل خيمتها في",
    "بعد فقدانه البصر", "بعد فقدانها البصر",
    "بعد بتر قدمه", "بعد بتر ساقه", "بعد بتر يده",
    "بعد نزوحه من", "بعد نزوحها من", "بعد نزوحهم من",
]
AFTERMATH_LIVING_MARKERS = [_normalize(t) for t in AFTERMATH_LIVING_MARKERS]

# Off-topic news guard. RSS feeds (RT Arabic, Anadolu, Sky News) publish
# global news; some alerts leak about events with no Palestine/Israel/
# Lebanon/Iran connection (e.g. "Salmonella in 13 US states linked to
# backyard poultry" classified as injury_report). Require the text to
# mention at least one regional anchor before treating it as security-
# relevant. This is a coarse pre-filter — fine geo resolution still
# happens later in _resolve_coordinates.
OFF_TOPIC_REGIONAL_ANCHORS = [
    # Palestine
    "فلسطين", "غزه", "الضفه", "القدس", "الخليل", "نابلس", "رام الله",
    "بيت لحم", "طولكرم", "جنين", "قلقيليه", "اريحا", "طوباس", "سلفيت",
    "خان يونس", "رفح", "جباليا", "دير البلح", "بيت حانون", "بيت لاهيا",
    "النصيرات", "البريج", "المغازي", "الشجاعيه",
    # Israel proper / regional
    "اسرائيل", "تل ابيب", "حيفا", "عسقلان", "اشدود",
    # Lebanon (Hezbollah front)
    "لبنان", "بيروت", "صور", "صيدا", "بنت جبيل", "النبطيه", "بعلبك",
    # Iran (regional escalation)
    "ايران", "طهران",
    # Yemen / Iraq / Syria (broader Hamas-front)
    "اليمن", "صنعاء", "الحوثي",
    "سوريا", "دمشق", "العراق", "بغداد",
    # Actor names
    "الاحتلال", "الكيان الصهيوني", "حزب الله", "حماس", "المقاومه",
    "جيش الاحتلال", "قوات الاحتلال", "نتنياهو",
    # Security-context vocabulary that is itself inherently regional —
    # "settler/settlement" and "siren" only appear in this context here.
    "مستوطن", "مستوطنه", "مستوطنين", "مستوطنون",
    "صافرات الانذار", "صفارات الانذار", "صافرات انذار",
    "الجبهه الداخليه",
]
OFF_TOPIC_REGIONAL_ANCHORS = [_normalize(t) for t in OFF_TOPIC_REGIONAL_ANCHORS]


def _is_off_topic(normed_text: str) -> bool:
    """True when the text mentions no regional anchor — drop the alert."""
    return not any(a in normed_text for a in OFF_TOPIC_REGIONAL_ANCHORS)


# Diplomatic news extension. Existing DIPLOMATIC_MARKERS catches
# travel/meeting verbs; these add named foreign-leader quote patterns
# that escape the wider net.
DIPLOMATIC_EXTENSION_MARKERS = [
    # EU / Western leadership quotes
    "رئيسه المفوضيه الاوروبيه",
    "المفوضيه الاوروبيه",
    "وزير خارجيه",
    "وزير الخارجيه",
    # UN officials
    "الامين العام للامم المتحده",
    "غوتيريش",
    # China envoy / diplomat speech
    "مندوب الصين",
    "مندوب روسيا",
    "السفير الاوروبي",
]
DIPLOMATIC_EXTENSION_MARKERS = [_normalize(t) for t in DIPLOMATIC_EXTENSION_MARKERS]


# NGO / press-release wrappers. The post quotes an organization's
# explanation or status update; not a kinetic event.
PRESS_RELEASE_MARKERS = [
    "اوضحت جمعيه الهلال الاحمر",
    "اوضح الهلال الاحمر",
    "بيان للهلال الاحمر",
    "اوضح المتحدث باسم",
    "بيان للمتحدث",
    "في اطار الاستجابه الانسانيه",
    "في اطار الاستجابه",
    "اعلنت الانروا",
    "اعلنت اونروا",
    "صرحت الانروا",
    "بيان للانروا",
    "اوضحت منظمه",
]
PRESS_RELEASE_MARKERS = [_normalize(t) for t in PRESS_RELEASE_MARKERS]


# Political / municipal news — elections, council resignations,
# party statements. Not kinetic events.
POLITICAL_RESIGNATION_MARKERS = [
    "الفائزين في انتخابات",
    "الفائزين في الانتخابات",
    "نتائج انتخابات",
    "نتائج الانتخابات",
    "اعلن انسحابي",
    "اعلن استقالتي",
    "اعلنت انسحابي", "اعلنت استقالتي",
    "اعلن انسحابه من",
    "بيان حركه",
    "بيان فصيل",
    "كلمه رئيس",
]
POLITICAL_RESIGNATION_MARKERS = [_normalize(t) for t in POLITICAL_RESIGNATION_MARKERS]


# Israeli civilian / municipal speaker quotes. Mayors, ministers, IDF
# generals making political statements wrap quoted speech that's not a
# live event. Extends SPOKESPERSON_LEADING (which is mostly Iranian +
# Hezbollah leadership).
ISRAELI_OFFICIAL_QUOTE_MARKERS = [
    "رئيس بلديه كريات شمونه",
    "رئيس بلديه ميتولا",
    "رئيس بلديه نهاريا",
    "رئيس بلديه صفد",
    "رئيس بلديه حيفا",
    "رئيس بلديه تل ابيب",
    "وزير الامن الاسرائيلي:",
    "وزير الدفاع الاسرائيلي:",
    "وزير الجيش الاسرائيلي:",
    "وزير الخارجيه الاسرائيلي:",
    "رئيس الاركان الاسرائيلي:",
    "وزير الماليه سموتريتش",
    "بن غفير:",
]
ISRAELI_OFFICIAL_QUOTE_MARKERS = [_normalize(t) for t in ISRAELI_OFFICIAL_QUOTE_MARKERS]

# Temporal attribution markers — distinguish "happening now" from historical
# mentions. Past markers downweight confidence so news-recap noise doesn't
# fire as real-time alerts. (T2.1)
PAST_MARKERS = [
    "البارحه", "امس", "قبل ايام", "قبل ساعات", "الاسبوع الماضي",
    "الشهر الماضي", "العام الماضي", "في السابق", "سابقا",
]
PAST_MARKERS = [_normalize(t) for t in PAST_MARKERS]

# Strong historical markers — when these appear, the post is narrating a
# past event (anniversary, years-ago retrospective, last-month framing in
# the leading clause). Distinct from PAST_MARKERS, which only downgrades
# confidence; HISTORICAL_HARD_FILTER drops the alert entirely.
HISTORICAL_HARD_MARKERS = [
    # Anniversary / commemoration framing
    "في الذكرى", "الذكرى السنويه", "ذكرى مجزره", "ذكرى استشهاد",
    "ذكرى الشهيد", "نستذكر", "نتذكر",
    # Long-past spelled-out gaps
    "قبل عام", "قبل عامين", "قبل سنه", "قبل سنتين",
    "قبل ثلاث سنوات", "قبل اربع سنوات", "قبل خمس سنوات",
    "قبل ست سنوات", "قبل سبع سنوات",
    "قبل اشهر", "قبل شهور",
]
HISTORICAL_HARD_MARKERS = [_normalize(t) for t in HISTORICAL_HARD_MARKERS]

# Soft historical markers — only filter when they appear in the leading
# clause (first ~60 chars). Mid-text use is usually background context for
# a live event ("they raided now, they had also raided last month").
HISTORICAL_SOFT_LEADING_MARKERS = [
    "في الشهر الماضي", "في الاسبوع الماضي", "في العام الماضي",
    "العام الماضي شهد", "العام الماضي شنت",
]
HISTORICAL_SOFT_LEADING_MARKERS = [_normalize(t) for t in HISTORICAL_SOFT_LEADING_MARKERS]

# Quantified "X years/months/weeks ago" — filter anywhere.
_HISTORICAL_QUANT_RE = re.compile(r"قبل\s+\d+\s+(سنوات|اعوام|شهور|اشهر)")

# Explicit prior-year framing: "خلال/في + (عام|سنه) + 20XX" with XX<current.
# Conservative: only match years 2018–2024 to avoid false positives on near-
# future references.
_HISTORICAL_YEAR_RE = re.compile(r"(خلال|في)\s+(عام|سنه)\s+(201[89]|202[0-4])")


def _is_historical_reference(normed_text: str) -> bool:
    """True when the post is narrating a past/anniversary event rather
    than reporting something live. Used by _is_noise to drop the alert."""
    if _has(normed_text, HISTORICAL_HARD_MARKERS):
        return True
    if _HISTORICAL_QUANT_RE.search(normed_text):
        return True
    if _HISTORICAL_YEAR_RE.search(normed_text):
        return True
    head = normed_text[:80]
    if _has(head, HISTORICAL_SOFT_LEADING_MARKERS):
        return True
    return False

PRESENT_MARKERS = [
    "الان", "الآن", "اللحظه", "حاليا", "جاري", "مستمر",
    "قبل قليل", "منذ قليل", "في هذه اللحظه",
]
PRESENT_MARKERS = [_normalize(t) for t in PRESENT_MARKERS]

# Numeric-count extraction regex. Matches Arabic verbs followed by an Arabic
# or Latin number — captures "اعتقل 5", "أصيب ١٢", "استشهد 3" etc. The
# pattern uses a lookahead for the verb root + optional inflection, then
# greedily consumes the next number within ~6 words.
_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_LATIN_DIGITS = "0123456789"
_ARABIC_TO_LATIN = str.maketrans(_ARABIC_DIGITS, _LATIN_DIGITS)

COUNT_VERB_PATTERNS = [
    r"اعتقل[تيوه]?\s+(?:قوات الاحتلال\s+)?(?:نحو\s+|حوالي\s+|ما يقارب\s+)?(\d+)",
    r"اعتقال\s+(?:نحو\s+|حوالي\s+|ما يقارب\s+)?(\d+)",
    r"استشهد[تي]?\s+(?:نحو\s+|حوالي\s+)?(\d+)",
    r"استشهاد\s+(?:نحو\s+)?(\d+)",
    r"اصي[بت]\s+(?:نحو\s+|حوالي\s+|ما يقارب\s+)?(\d+)",
    r"اصابه\s+(?:نحو\s+)?(\d+)",
    r"عدد\s+(?:من\s+)?(?:الاسرى|الجرحى|الشهداء|المعتقلين|المصابين)\s*[:،]?\s*(\d+)",
    r"(\d+)\s+(?:شهيدا|شهداء|مصابا|مصابين|جريحا|جرحى|معتقلا|معتقلين|اسيرا|اسرى)",
]
COUNT_VERB_PATTERNS = [re.compile(p) for p in COUNT_VERB_PATTERNS]


def _extract_count(text: str) -> Optional[int]:
    """Pull the largest credible casualty/arrest count from message text.

    Multiple verbs may match (e.g. "أصيب 3 واعتقل 5"); we return the max
    so the alert reflects the bigger impact. Returns None when no number is
    extractable so callers can default to 1 or leave unset.
    """
    normalized = _normalize(text).translate(_ARABIC_TO_LATIN)
    counts = []
    for pat in COUNT_VERB_PATTERNS:
        for m in pat.finditer(normalized):
            try:
                n = int(m.group(1))
                # Plausibility cap: a single Telegram alert about >500 victims
                # is almost certainly a cumulative figure, not an event count.
                if 1 <= n <= 500:
                    counts.append(n)
            except (ValueError, IndexError):
                continue
    return max(counts) if counts else None


def _extract_temporal_certainty(normalized_text: str) -> Optional[str]:
    """Return "past" if past markers dominate, "now" if present markers
    dominate, otherwise None (unspecified)."""
    has_past = _has(normalized_text, PAST_MARKERS)
    has_present = _has(normalized_text, PRESENT_MARKERS)
    if has_past and not has_present:
        return "past"
    if has_present and not has_past:
        return "now"
    return None


def _signal_density(text: str) -> float:
    """0.0–1.0 score = matched-attack-verb count / sqrt(word count). Caps
    at 1.0. Higher density (lots of attack verbs in a short message) =
    more signal. Sparse mentions (one verb in a long news recap) = less."""
    words = len(text.split()) or 1
    matches = sum(1 for v in ATTACK_VERBS_AR if v in text)
    if matches == 0:
        return 0.0
    import math
    return min(1.0, matches / math.sqrt(words))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has(text: str, keywords: list) -> bool:
    return any(kw in text for kw in keywords)


def _has_attack_verb(text: str) -> bool:
    return _has(text, ATTACK_VERBS_AR) or _has(text, [v.lower() for v in ATTACK_VERBS_EN])


def _zone_match(text: str, zone_entry: str) -> bool:
    """Substring match for ≥4-char entries; bounded match for short entries.

    Audit 2026-04-19 (#34): the bare 3-char village name "تل" was matching
    inside "مقاتلو" (fighters) and routing every Lebanese casualty narrative
    to west_bank_siren. Short entries (≤3 chars) now require a non-letter
    boundary on at least one side to behave like a token, not a substring.
    """
    if len(zone_entry) >= 4:
        return zone_entry in text
    pos = 0
    n = len(text)
    e = len(zone_entry)
    while True:
        i = text.find(zone_entry, pos)
        if i < 0:
            return False
        left_ok = (i == 0) or not text[i - 1].isalpha()
        right_ok = (i + e >= n) or not text[i + e].isalpha()
        if left_ok and right_ok:
            return True
        pos = i + 1


def _is_wb_zone(text: str) -> bool:
    return any(_zone_match(text, z) for z in WB_ZONE)


def _is_mena_zone(text: str) -> bool:
    return any(_zone_match(text, z) for z in MENA_ZONE)


def _is_israel_interior(text: str) -> bool:
    return any(c in text for c in ISRAEL_INTERIOR)


def _is_noise(text: str, tier: str = "tier1", source: str = "") -> bool:
    """True if text is dominated by statement/attribution/speculative language.

    tier="tier1": also filters ground-op terms (raids/arrests) from missile classifier.
    tier="tier2": skips ground-op filter since those ARE the events we want.
    source: channel username — news channels get relaxed attribution filtering.
    """
    is_news = _is_news_channel(source)

    # Photo/video caption prefix → duplicate of already-reported event.
    # Strip leading emojis, symbols, and whitespace so an emoji-prefixed
    # caption ("⭕بالفيديو | …") still trips the check; only Arabic and
    # Latin letters remain at the front before we anchor-match.
    head = re.sub(r"^[^a-zA-Zء-ي]+", "", text)[:30]
    if any(head.startswith(p) for p in CAPTION_PREFIX_PATTERNS):
        return True

    # Eulogy / biographical recap → past tense remembrance, not new event.
    if _has(text, EULOGY_PATTERNS):
        return True

    # Historical / anniversary / X-years-ago framing → past, not live.
    if _is_historical_reference(text):
        return True

    # Solidarity protest abroad → not a live event in Palestine.
    head_120 = text[:120]
    if _has(head_120, SOLIDARITY_LEADING_MARKERS) and _has(text, SOLIDARITY_CONTEXT):
        return True

    # Diplomatic news → travel/meeting verb, not kinetic.
    if _has(text, DIPLOMATIC_MARKERS):
        return True

    # Political commentary wrapper ("تعليقاً على X قال Y") → quote, not event.
    if _has(text, COMMENTARY_MARKERS):
        return True

    # Non-war health statistics → disease/condition counts, not trauma.
    if _has(text, NON_WAR_HEALTH_MARKERS):
        return True

    # Family appeal about an existing detention — no new arrest event.
    if (_has(head_120, FAMILY_APPEAL_LEADING)
            and _has(text, FAMILY_APPEAL_VERBS)):
        return True

    # Funeral / body-arrival / posthumous profile of someone already dead.
    if _has(text, FUNERAL_BURIAL_PATTERNS):
        return True

    # Past-perfect recap leading the post (وكان قد / وكانت قد …).
    if _has(text[:80], PAST_PERFECT_RECAP_LEADING):
        return True

    # Period summary: "خلال 48 ساعة" / "خلال أسبوع" — aggregate, not event.
    if _PERIOD_SUMMARY_RE.search(text):
        return True

    # Human-interest emotional reaction post — the event is old; the
    # post is someone reacting to it.
    if _has(text, HUMAN_INTEREST_MARKERS):
        return True

    # Humanitarian capacity appeal — equipment/supplies shortage,
    # not a kinetic event.
    if _has(text, HUMANITARIAN_APPEAL_MARKERS):
        return True

    # Spokesperson / leader speech wrapper — head contains a named
    # regional figure or foreign-press analysis byline. Not a live event.
    if _has(text[:120], SPOKESPERSON_LEADING_MARKERS):
        return True

    # Activism / flotilla / interview / commentary-on-post — media
    # coverage of campaigns, not security incidents.
    if _has(text, ACTIVISM_COMMENTARY_MARKERS):
        return True

    # Aftermath / living-condition follow-up about an existing wounded
    # or displaced person. The event happened earlier; the post is a
    # profile of their current state.
    if _has(text, AFTERMATH_LIVING_MARKERS):
        return True

    # Off-topic guard — text mentions no regional anchor (Palestine /
    # Israel / Lebanon / Iran / actors). RSS feeds occasionally publish
    # global news that triggers casualty/injury keywords ("Salmonella in
    # 13 US states", etc.).
    if _is_off_topic(text):
        return True

    # Diplomatic news extension — named foreign-leader quote patterns
    # that escape the broader DIPLOMATIC_MARKERS net.
    if _has(text, DIPLOMATIC_EXTENSION_MARKERS):
        return True

    # NGO / press-release wrappers — Red Crescent statements, UNRWA
    # announcements, organizational explanations. Not kinetic events.
    if _has(text, PRESS_RELEASE_MARKERS):
        return True

    # Political / municipal — elections, council resignations, party
    # statements. Not kinetic events.
    if _has(text, POLITICAL_RESIGNATION_MARKERS):
        return True

    # Israeli civilian/military official speaking — mayor of Kiryat
    # Shmona on Hezbollah, defense minister speech, etc. Quoted political
    # speech wrapped as if a live event.
    if _has(text[:200], ISRAELI_OFFICIAL_QUOTE_MARKERS):
        return True

    # News attribution — only discard for non-news channels.
    # WAFA/QudsN ARE news agencies; their messages naturally contain attribution.
    # For news channels, only discard analysis/report/summary prefixes.
    if is_news:
        report_prefixes = [_normalize(t) for t in [
            "تقرير:", "تقرير |", "تحليل:", "ملخص:", "مراجعه:",
            # Daily roundup framings — these list many events in one post,
            # not a single live event, so they shouldn't fire as alerts.
            "ملخص اليوم", "ملخص اخبار", "ملخص الاحداث",
            "حصاد اليوم", "حصيله اليوم", "اهم الاحداث",
            "ابرز الاحداث", "ابرز ما جرى", "ابرز ما حدث",
            "ما حدث", "ما جرى", "احداث امس", "اخبار امس",
        ]]
        if _has(text, report_prefixes):
            return True
    else:
        if _has(text, NEWS_ATTRIBUTION):
            return True

    # Speculative/future/threat language = discard
    if _has(text, SPECULATIVE_NOISE):
        return True
    noise_count = sum(1 for kw in NOISE_DOMINANT if kw in text)
    if noise_count >= 2:
        return True
    # Ground-op noise only applies to Tier 1 (missile/siren classifier)
    # For Tier 2, ground-op terms (raids, arrests, settler attacks) are the signal
    if tier == "tier1" and _has(text, GROUND_OP_NOISE):
        rocket_terms = [_normalize(t) for t in ["صاروخ", "صافرات", "قصف جوي", "غاره", "صواريخ",
                        "رشقه", "انفجار", "انذار"]]
        if not any(k in text for k in rocket_terms):
            return True
    return False


def _has_urgent_marker(text: str) -> bool:
    """Check for عاجل-style breaking news markers (QudsN/WAFA)."""
    return _has(text, URGENT_MARKERS)


def _is_wb_contextual(text: str) -> bool:
    """
    Broader Palestinian-relevance check — for operational events, we don't
    require an exact zone match. If the message mentions Palestinian-specific
    context (occupation forces, settlers, Palestinian cities) it is relevant.

    Name kept as `_is_wb_contextual` for back-compat; now covers WB + Gaza.
    """
    if _is_wb_zone(text):
        return True

    # Palestinian context markers — if these appear, the event is almost
    # certainly within occupied Palestine (WB or Gaza).
    palestine_context = [
        "قوات الاحتلال", "جيش الاحتلال", "الاحتلال الاسرائيلي",
        "جنود الاحتلال", "الاحتلال",
        "مستوطنون", "مستوطنين", "المستوطنين",
        "الجدار الفاصل", "جدار الفصل",
        "فلسطيني", "فلسطينيين", "مواطن فلسطيني",
        "الضفه",
        "قطاع غزه", "القطاع", "غزه",
    ]
    palestine_context = [_normalize(p) for p in palestine_context]
    return _has(text, palestine_context)


# ── Area extraction — comprehensive ─────────────────────────────────────────

# Map normalized Arabic → English display name
_AREA_MAP_RAW = {
    # Governorate capitals
    "رام الله": "Ramallah", "البيره": "Al-Bireh",
    "القدس": "Jerusalem", "نابلس": "Nablus", "جنين": "Jenin",
    "طولكرم": "Tulkarm", "الخليل": "Hebron", "بيت لحم": "Bethlehem",
    "قلقيليه": "Qalqilya", "اريحا": "Jericho", "طوباس": "Tubas",
    "سلفيت": "Salfit",

    # Nablus area
    "حواره": "Huwara", "بيتا": "Beita", "بلاطه": "Balata",
    "بورين": "Burin", "مادما": "Madama", "عقربا": "Aqraba",
    "قبلان": "Qabalan", "يتما": "Yatma", "بيت فوريك": "Beit Furik",
    "بيت دجن": "Beit Dajan", "عصيره الشماليه": "Asira al-Shamaliya",
    "سبسطيه": "Sebastia", "دير شرف": "Deir Sharaf",

    # Jenin area
    "يعبد": "Ya'bad", "قباطيه": "Qabatiya", "عرابه": "Arraba",
    "برقين": "Burqin", "طمون": "Tamun", "الزبابده": "Az-Zababdeh",
    "سيله الحارثيه": "Silat al-Harithiya", "كفر دان": "Kafr Dan",
    "ميثلون": "Maythalun",

    # Tulkarm area
    "نور شمس": "Nur Shams", "عنبتا": "Anabta", "بلعا": "Bal'a",
    "شويكه": "Shweikeh", "عتيل": "Attil", "قفين": "Qaffin",

    # Hebron area
    "يطا": "Yatta", "دورا": "Dura", "الظاهريه": "Adh-Dhahiriya",
    "حلحول": "Halhul", "بيت امر": "Beit Ummar", "بني نعيم": "Bani Na'im",
    "ترقوميا": "Tarqumiya", "صوريف": "Surif", "السموع": "As-Samu'",
    "الشيوخ": "Ash-Shuyukh", "خاراس": "Kharas",

    # Ramallah area
    "بيتونيا": "Beitunia", "بير زيت": "Birzeit", "سلواد": "Silwad",
    "كوبر": "Kobar", "نعلين": "Ni'lin", "بلعين": "Bil'in",
    "المزرعه الشرقيه": "Al-Mazra'a ash-Sharqiya",
    "النبي صالح": "An-Nabi Salih", "ترمسعيا": "Turmus Ayya",
    "عابود": "Aboud", "ابوديس": "Abu Dis",

    # Bethlehem area
    "بيت ساحور": "Beit Sahour", "بيت جالا": "Beit Jala",
    "الخضر": "Al-Khader", "تقوع": "Tuqu'", "بيت فجار": "Beit Fajjar",
    "الولجه": "Al-Walaja", "نحالين": "Nahalin",

    # Qalqilya area
    "عزون": "Azzun", "جيوس": "Jayyous",

    # Salfit area
    "كفل حارس": "Kifl Haris", "بديا": "Bidya",
    "دير استيا": "Deir Istiya", "كفر الديك": "Kafr ad-Dik",

    # East Jerusalem
    "الشيخ جراح": "Sheikh Jarrah", "سلوان": "Silwan",
    "العيساويه": "Al-Issawiya", "جبل المكبر": "Jabal al-Mukaber",
    "الطور": "At-Tur", "شعفاط": "Shu'fat", "بيت حنينا": "Beit Hanina",
    "العيزريه": "Al-Eizariya", "راس العمود": "Ras al-Amud",

    # Refugee camps
    "مخيم جنين": "Jenin Camp", "مخيم بلاطه": "Balata Camp",
    "مخيم نابلس": "Nablus Camp", "مخيم طولكرم": "Tulkarm Camp",
    "مخيم نور شمس": "Nur Shams Camp",
    "مخيم الفارعه": "Al-Fara'a Camp",
    "مخيم الامعري": "Al-Am'ari Camp",
    "مخيم الجلزون": "Al-Jalazun Camp",
    "مخيم الدهيشه": "Dheisheh Camp",
    "مخيم عايده": "Aida Camp",
    "مخيم العروب": "Al-Arroub Camp",
    "مخيم الفوار": "Al-Fawwar Camp",
    "مخيم شعفاط": "Shu'fat Camp",
    "مخيم قلنديا": "Qalandia Camp",
    "مخيم عقبه جبر": "Aqbat Jabr Camp",

    # General areas
    "الضفه": "West Bank", "الاغوار": "Jordan Valley",
    "غور الاردن": "Jordan Valley",

    # ── Gaza Strip ────────────────────────────────────────────────────────────
    # Gaza governorates / general
    "قطاع غزه": "Gaza Strip", "غزه": "Gaza",
    "مدينه غزه": "Gaza City", "مدينة غزه": "Gaza City",
    "شمال غزه": "North Gaza",

    # North Gaza
    "بيت حانون": "Beit Hanoun", "بيت لاهيا": "Beit Lahia",
    "جباليا": "Jabalia", "مخيم جباليا": "Jabalia Camp",
    "العطاطره": "Al-Atatra", "ام النصر": "Umm an-Nasr",

    # Gaza City neighbourhoods
    "الرمال": "Al-Rimal", "الشجاعيه": "Shujaiya",
    "التفاح": "Tuffah", "الزيتون": "Zaytoun",
    "الصبره": "Sabra", "الدرج": "Daraj",
    "الشاطئ": "Al-Shati", "مخيم الشاطئ": "Shati Camp",
    "الشيخ رضوان": "Sheikh Radwan", "تل الهوى": "Tel al-Hawa",
    "النصر": "An-Nasr", "الكرامه": "Al-Karama",

    # Middle Gaza (Deir al-Balah governorate)
    "دير البلح": "Deir al-Balah",
    "النصيرات": "Nuseirat", "مخيم النصيرات": "Nuseirat Camp",
    "البريج": "Bureij", "مخيم البريج": "Bureij Camp",
    "المغازي": "Maghazi", "مخيم المغازي": "Maghazi Camp",
    "الزوايده": "Zawayda", "وادي السلقا": "Wadi as-Salqa",
    "المصدر": "Al-Musaddar",

    # Khan Younis governorate
    "خان يونس": "Khan Younis",
    "بني سهيلا": "Bani Suheila", "عبسان": "Abasan",
    "عبسان الكبيره": "Abasan al-Kabira",
    "القراره": "Qarara", "الفخاري": "Al-Fukhari",
    "خزاعه": "Khuza'a", "قيزان النجار": "Qizan an-Najjar",
    "معن": "Maen",

    # Rafah governorate
    "رفح": "Rafah", "مخيم رفح": "Rafah Camp",
    "تل السلطان": "Tel as-Sultan", "الشابوره": "Shaboura",
    "البرازيل": "Brazil", "المواصي": "Al-Mawasi",
    "زعرب": "Zaarab",

    # Gaza crossings / border
    "معبر رفح": "Rafah Crossing",
    "معبر كرم ابو سالم": "Kerem Shalom Crossing",
    "معبر بيت حانون": "Beit Hanoun Crossing",
    "معبر ايرز": "Erez Crossing",
    "محور نتساريم": "Netzarim Corridor",
    "محور فيلادلفيا": "Philadelphi Corridor",

    # Regional (for Tier 3)
    "الكويت": "Kuwait", "العراق": "Iraq", "بغداد": "Baghdad",
    "الاردن": "Jordan", "لبنان": "Lebanon", "بيروت": "Beirut",
    "سوريا": "Syria", "ايران": "Iran", "اليمن": "Yemen",
    "تل ابيب": "Tel Aviv", "حيفا": "Haifa", "نتانيا": "Netanya",
}

# Build normalized area map
AREA_MAP = {_normalize(k): v for k, v in _AREA_MAP_RAW.items()}

# Sort by key length descending so longer (more specific) matches win
_AREA_KEYS_SORTED = sorted(AREA_MAP.keys(), key=len, reverse=True)


# Marker-prefixed location extraction. When a post says "بلدة X" /
# "قرية X" / "مخيم X" / "حي X", X is the actual location — even if a
# containing city is also mentioned in the same sentence (e.g. "بلدة
# عناتا شمال شرق القدس" → Anata, not Jerusalem). The plain longest-key
# scan misses this because: (a) some villages aren't in AREA_MAP at all,
# and (b) when both village and city ARE in the map at the same key
# length, the city often wins by iteration order.
# The marker must start at a word boundary — `حي` (neighborhood) is only
# 2 chars and would otherwise substring-match inside words like "تحي" or
# "تحية". Negative lookbehind for Arabic letters enforces the boundary.
_MARKER_PLACE_RE = re.compile(
    r"(?<![ء-ي])(بلده|قريه|مخيم|حي)\s+(\S+(?:\s+\S+){0,2})"
)

# Trailing words to strip after over-capturing 1–3 tokens after the marker
# ("بلده كفر قدوم غرب قلقيليه" → keep "كفر قدوم", drop "غرب", then drop
# "قلقيليه" by progressively trying shorter prefixes against the lookup).
_TRAILING_NOISE_TOKENS = {
    "شمال", "جنوب", "شرق", "غرب",
    "شمالي", "جنوبي", "شرقي", "غربي",
    "شمالا", "جنوبا", "شرقا", "غربا",
    "قرب", "بمحاذاه", "بجوار", "في", "من", "على",
    "بمحافظه", "محافظه", "وسط", "اعلى", "اسفل",
}

# Major-city blacklist for the gazetteer fallback. The marker-prefixed
# extractor exists to subvert the city-wins outcome; if KB substring scan
# returns one of these, retry with a shorter candidate so the village wins.
_MAJOR_CITY_NAMES_LC = {
    "hebron", "jerusalem", "ramallah", "nablus", "jenin", "tulkarm",
    "bethlehem", "qalqilya", "jericho", "tubas", "salfit", "al-bireh",
    "gaza", "gaza city", "khan yunis", "khan younis", "rafah",
    "deir al-balah", "deir al balah", "north gaza",
}


def _extract_marker_prefixed_place(normed_text: str) -> Optional[str]:
    """If text uses a 'بلدة X' / 'قرية X' / 'مخيم X' / 'حي X' marker,
    resolve X to its English label via AREA_MAP first, then the gazetteer.
    Returns None if no marker, or X can't be resolved."""
    m = _MARKER_PLACE_RE.search(normed_text)
    if not m:
        return None
    marker = m.group(1)
    raw = m.group(2)
    # Pull only Arabic-letter sequences from the captured slice. Inline
    # punctuation (commas, periods) would otherwise survive into the
    # candidate string and break exact AREA_MAP matches like "مخيم العروب،"
    # AND, worse, leak containing-city tokens (الخليل / نابلس) into
    # find_location's substring scan, returning the city instead.
    words = re.findall(r"[ء-ي]+", raw)
    while len(words) > 1 and words[-1] in _TRAILING_NOISE_TOKENS:
        words.pop()
    if not words:
        return None

    # Try progressively shorter prefixes against AREA_MAP. Try the full
    # "marker X" form first so camp/neighborhood-specific entries win
    # ("مخيم بلاطه" → "Balata Camp" rather than "بلاطه" → "Balata"),
    # then fall back to bare X.
    for n in range(len(words), 0, -1):
        candidate = " ".join(words[:n])
        with_marker = f"{marker} {candidate}"
        if with_marker in AREA_MAP:
            return AREA_MAP[with_marker]
        if candidate in AREA_MAP:
            return AREA_MAP[candidate]

    # Gazetteer fallback for villages outside AREA_MAP. Iterate longest
    # prefix first so multi-token names ("كفر قدوم") win, but skip any
    # resolution that lands on a major city — the marker logic exists
    # precisely to subvert that.
    from .location_knowledge_base import get_location_kb
    kb = get_location_kb()
    if kb:
        for n in range(len(words), 0, -1):
            candidate = " ".join(words[:n])
            if len(candidate) < 3:
                continue
            key = kb.find_location(candidate)
            if not key:
                continue
            loc = kb.get_location(key)
            name_en = (loc or {}).get("name_en") or ""
            if name_en.lower() in _MAJOR_CITY_NAMES_LC:
                continue
            if name_en:
                return name_en
    return None


def _area_key_match(text: str, key: str) -> bool:
    """Substring match with word-boundary for short keys. The 3-char
    Yatta ("يطا") would otherwise substring-match inside "إيطاليا"
    (Italy) — same class of bug as "تل" inside "مقاتلو" that the WB-
    zone matcher already guards against."""
    if len(key) >= 5:
        return key in text
    pos = 0
    n = len(text)
    e = len(key)
    while True:
        i = text.find(key, pos)
        if i < 0:
            return False
        left_ok = (i == 0) or not text[i - 1].isalpha()
        right_ok = (i + e >= n) or not text[i + e].isalpha()
        if left_ok and right_ok:
            return True
        pos = i + 1


def _extract_area(text: str) -> Optional[str]:
    """Return the most specific area match.

    1. Marker-prefixed first ('بلدة X' / 'قرية X' / 'مخيم X' / 'حي X')
       — handles villages inside cities and villages outside AREA_MAP.
    2. Otherwise the longest AREA_MAP key wins (legacy behaviour),
       with word-boundary check for short keys.
    """
    marker_place = _extract_marker_prefixed_place(text)
    if marker_place:
        return marker_place
    for ar in _AREA_KEYS_SORTED:
        if _area_key_match(text, ar):
            return AREA_MAP[ar]
    return None


def _sanitize(text: str, max_len: int = 500) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len - 3] + "..." if len(text) > max_len else text


# ── Confidence scoring (Phase P3.3) ──────────────────────────────────────────
# Mirrors the seed in database.py CHANNEL_RELIABILITY_SEED. Kept as a sync dict
# so classify() can stay synchronous on the hot path; the DB copy is the
# operator-facing surface (read by /channel-reliability) but the classifier
# always reads from this in-process map.
_CHANNEL_WEIGHT = {
    "almustashaar":   1.00,
    "wafa":           0.90,
    "wafa_ps":        0.90,
    "wafagency":      0.90,
    "wafanews":       0.90,
    "qudsn":          0.80,
    "shihab":         0.70,
    "shehabagency":   0.70,
    "shihabagency":   0.70,
    "palinfoar":      0.70,
    "ajanews":        0.60,
    "almayadeennews": 0.50,
    "almayadeennewspal": 0.50,
    "mohmediagaza":   0.80,
    # B2 RSS sources — calibrated by editorial track record + framing bias
    "aljazeera_ar":   0.65,
    "anadolu_ar":     0.55,
    "rt_arabic":      0.45,   # framing-heavy state media
    "skynews_ar":     0.55,   # UAE-based, fast breaking news
}

_SEVERITY_BUMP = {
    Severity.critical: 0.15,
    Severity.high:     0.10,
    Severity.medium:   0.00,
    Severity.low:      -0.10,
}


def _channel_weight(source: Optional[str]) -> float:
    if not source:
        return 0.5
    return _CHANNEL_WEIGHT.get(source.lower().lstrip("@"), 0.5)


# A2 — keyword_weight_overrides cache.
# Keyed by (channel.lower(), event_type_value). Reloaded by refresh_overrides().
_OVERRIDES: dict[tuple[str, str], float] = {}


def _override_for(source: Optional[str], event_type: AlertType) -> float:
    """Return the learned weight_delta for this (channel, type), or 0."""
    if not source:
        return 0.0
    key = (source.lower().lstrip("@"), event_type.value if hasattr(event_type, "value") else str(event_type))
    return _OVERRIDES.get(key, 0.0)


def refresh_overrides_from_db_sync(db_path: str) -> int:
    """Reload _OVERRIDES from keyword_weight_overrides. Sync because the
    classifier module is loaded outside the app's async event loop on cold
    start. Returns the count of rows loaded."""
    import sqlite3
    try:
        conn = sqlite3.connect(db_path, timeout=5)
        try:
            cur = conn.execute(
                "SELECT channel, event_type, weight_delta FROM keyword_weight_overrides"
            )
            rows = cur.fetchall()
        finally:
            conn.close()
    except sqlite3.OperationalError:
        return 0
    _OVERRIDES.clear()
    for ch, et, delta in rows:
        _OVERRIDES[(ch.lower(), et)] = float(delta)
    return len(_OVERRIDES)


def _compute_confidence(
    severity: Severity,
    source: str,
    area: Optional[str],
    zone: Optional[str],
    text: str,
    alert_type: AlertType,
    temporal_certainty: Optional[str] = None,
    corroborator_count: int = 0,
) -> tuple[float, float]:
    """Return (confidence, source_reliability), both clamped to [0.0, 1.0].

    Confidence blends:
      1. Channel reliability (track-record-weighted source trust)
      2. Severity (classifier-ranked impact)
      3. Locality clarity (named area in a known zone > generic "West Bank")
      4. Tier-1 noise-filter credit (siren classifier passed MENA guard)
      5. Signal density (matched attack-verbs per √word-count) — one verb
         in a 100-word news recap weighs less than three in a 20-word alert
      6. Temporal markers — "البارحة" / "أمس" downweights ~0.20 because
         past-tense recaps are often news roundups, not real-time events
    """
    rel = _channel_weight(source)
    base = 0.5 + (rel - 0.5) * 0.6      # 0.20 .. 0.80 from reliability alone
    base += _SEVERITY_BUMP.get(severity, 0.0)
    if area and area != "West Bank":
        base += 0.05
    if zone:
        base += 0.05
    if alert_type in (AlertType.west_bank_siren, AlertType.regional_attack, AlertType.gaza_strike):
        base += 0.05
    base += _signal_density(_normalize(text)) * 0.10
    if temporal_certainty == "past":
        base -= 0.20
    elif temporal_certainty == "now":
        base += 0.05
    # B1 — cross-channel corroboration: +0.10 per distinct prior source
    # reporting the same (type, area) in the last 30 minutes, capped at +0.30.
    if corroborator_count > 0:
        base += min(0.30, 0.10 * corroborator_count)
    # A2 — apply learned correction-feedback override (negative when admins
    # have retracted ≥7 alerts of this (channel, type) combo). Clamped to
    # -0.30 to avoid one-off bad days zeroing a source out.
    base += max(-0.30, _override_for(source, alert_type))
    confidence = max(0.0, min(1.0, round(base, 3)))
    return confidence, round(rel, 3)


def _build(
    alert_type: AlertType,
    severity: Severity,
    text: str,
    source: str,
    area: Optional[str],
    title: Optional[str] = None,
    zone: Optional[str] = None,
) -> dict:
    sentences = re.split(r"[.!?؟\n]", text)
    body = next((s.strip() for s in sentences if len(s.strip()) > 10), text[:250])

    TYPE_LABEL_EN = {
        AlertType.west_bank_siren:       "West Bank Alert",
        AlertType.northern_israel_siren: "Northern Israel Siren",
        AlertType.regional_attack:       "Regional Attack",
        AlertType.gaza_strike:           "Gaza Strike",
        AlertType.idf_raid:          "IDF Raid",
        AlertType.settler_attack:    "Settler Attack",
        AlertType.road_closure:      "Road Closure",
        AlertType.flying_checkpoint: "Flying Checkpoint",
        AlertType.injury_report:     "Injury Report",
        AlertType.demolition:        "Demolition",
        AlertType.arrest_campaign:   "Arrest Campaign",
        AlertType.school_closure:    "School Closure",
        AlertType.hospital_strike:   "Hospital Strike",
        AlertType.evacuation_order:  "Evacuation Order",
        AlertType.utility_cutoff:    "Utility Cutoff",
        AlertType.journalist_targeted: "Journalist Targeted",
        AlertType.child_detention:   "Child Detention",
    }
    TYPE_LABEL_AR = {
        AlertType.west_bank_siren:       "تنبيه الضفة الغربية",
        AlertType.northern_israel_siren: "إنذار شمال فلسطين المحتلة",
        AlertType.regional_attack:       "هجوم إقليمي",
        AlertType.gaza_strike:           "قصف على غزة",
        AlertType.idf_raid:          "اقتحام",
        AlertType.settler_attack:    "اعتداء مستوطنين",
        AlertType.road_closure:      "إغلاق طريق",
        AlertType.flying_checkpoint: "حاجز طيار",
        AlertType.injury_report:     "إصابة",
        AlertType.demolition:        "هدم",
        AlertType.arrest_campaign:   "حملة اعتقالات",
        AlertType.school_closure:    "إغلاق مدرسة",
        AlertType.hospital_strike:   "استهداف مستشفى",
        AlertType.evacuation_order:  "أمر إخلاء",
        AlertType.utility_cutoff:    "قطع خدمات",
        AlertType.journalist_targeted: "استهداف صحفي",
        AlertType.child_detention:   "اعتقال طفل",
    }
    label_en = TYPE_LABEL_EN.get(alert_type, "Alert")
    label_ar = TYPE_LABEL_AR.get(alert_type, "تنبيه")
    built_title = title or (f"{label_en} — {area}" if area else label_en)
    built_title_ar = f"{label_ar} — {area}" if area else label_ar

    normed_full = _normalize(text)
    temporal_certainty = _extract_temporal_certainty(normed_full)
    extracted_count = _extract_count(text)

    confidence, source_reliability = _compute_confidence(
        severity, source, area, zone, text, alert_type, temporal_certainty
    )

    result = {
        "type":     alert_type,
        "severity": severity,
        "title":    built_title,
        "title_ar": built_title_ar,
        "body":     body,
        "source":   source,
        "area":     area,
        "zone":     zone,
        "raw_text": text,
        "confidence":         confidence,
        "source_reliability": source_reliability,
        "count":              extracted_count,
        "temporal_certainty": temporal_certainty,
        "status":             "active",
    }

    # 3-tier coordinate resolution: location KB → checkpoint KB → zone center
    _resolve_coordinates(result, area, zone)

    # OCHA admin stamps via point-in-polygon (cod-ab-pse). Lazy-loaded
    # singleton — no-op if polygons aren't installed.
    try:
        from . import admin_lookup
        admin1, admin2 = admin_lookup.point_to_admin(
            result.get("latitude"), result.get("longitude")
        )
        result["admin1"] = admin1
        result["admin2"] = admin2
    except Exception:
        result["admin1"] = None
        result["admin2"] = None

    return result


# B4 — fuzzy directional / proximity resolution.
# 1km in WB latitudes ≈ 0.009° lat, ≈ 0.011° lng (cos(32°)).
_KM_PER_DEG_LAT = 1 / 110.574
_KM_PER_DEG_LNG = 1 / 96.487

_DIRECTION_OFFSETS_KM = {
    "north":      (3, 0),
    "south":      (-3, 0),
    "east":       (0, 3),
    "west":       (0, -3),
    "northeast":  (2, 2),
    "northwest":  (2, -2),
    "southeast":  (-2, 2),
    "southwest":  (-2, -2),
    "near":       (0, 0),
}

# Modifier patterns; capture group = candidate place name string.
# Arabic prefixes appear in many inflected forms (شمال / شمالي / شمالى) —
# the [يى]? optional suffix covers the common adjective forms.
_FUZZY_PATTERNS = [
    (re.compile(r"north(?:east|west)?\s+of\s+([A-Za-z][\w\s'-]{2,30})", re.I), "north"),
    (re.compile(r"south(?:east|west)?\s+of\s+([A-Za-z][\w\s'-]{2,30})", re.I), "south"),
    (re.compile(r"\beast\s+of\s+([A-Za-z][\w\s'-]{2,30})", re.I), "east"),
    (re.compile(r"\bwest\s+of\s+([A-Za-z][\w\s'-]{2,30})", re.I), "west"),
    (re.compile(r"\bnear\s+([A-Za-z][\w\s'-]{2,30})", re.I), "near"),
    (re.compile(r"شمال[يى]?\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "north"),
    (re.compile(r"جنوب[يى]?\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "south"),
    (re.compile(r"شرق[يى]?\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "east"),
    (re.compile(r"غرب[يى]?\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "west"),
    (re.compile(r"بالقرب\s+من\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "near"),
    (re.compile(r"قرب\s+([؀-ۿ][؀-ۿ\s]{1,30})"), "near"),
]


def _extract_fuzzy_location(text: str, loc_kb) -> Optional[tuple]:
    """Return (lat, lng, source_phrase) for a "near X" / "south of X" style
    mention, or None. Tries 3-, 2-, then 1-word truncations of the captured
    phrase against the location KB (place names rarely exceed 3 tokens)."""
    if not text or not loc_kb:
        return None
    for pat, direction in _FUZZY_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        candidate_raw = m.group(1).strip().split('\n')[0].split('.')[0]
        words = candidate_raw.split()
        for w in (3, 2, 1):
            if w > len(words):
                continue
            candidate = " ".join(words[:w])
            loc_key = loc_kb.find_location(candidate) or loc_kb.by_english.get(candidate.lower())
            if not loc_key:
                continue
            coords = loc_kb.get_coordinates(loc_key)
            if not coords:
                continue
            lat, lng = coords
            dlat_km, dlng_km = _DIRECTION_OFFSETS_KM[direction]
            lat += dlat_km * _KM_PER_DEG_LAT
            lng += dlng_km * _KM_PER_DEG_LNG
            return (lat, lng, m.group(0).strip()[:80])
    return None


def _resolve_coordinates(result: dict, area: Optional[str], zone: Optional[str]):
    """
    Attach lat/lng + precision tier so map clients can decide pin vs polygon.

    Precision values (most → least specific):
      - "checkpoint" : exact checkpoint coords (10-100m accuracy)
      - "town"       : town/city center from location KB (city-block accuracy)
      - "fuzzy"      : "near X" / "south of X" → known place + 0-3km offset
      - "zone"       : WB sub-zone center (north/middle/south, ~30km)
      - "region"     : West Bank or Gaza-wide fallback (no useful point)
    `geo_source_phrase` records which input text resolved the coords — used
    for debugging false geocodes and for the future learner feedback loop.
    """
    from .location_knowledge_base import get_location_kb

    # Tier 1: location knowledge base (per-city coordinates)
    loc_kb = get_location_kb()
    if loc_kb and area and area != "West Bank":
        loc_key = loc_kb.find_location(area)
        if not loc_key:
            loc_key = loc_kb.by_english.get(area.lower())
        if loc_key:
            coords = loc_kb.get_coordinates(loc_key)
            if coords:
                result["latitude"], result["longitude"] = coords
                result["geo_precision"] = "town"
                result["geo_source_phrase"] = area
                return

    # Tier 2: checkpoint knowledge base (if area matches a checkpoint name)
    from .checkpoint_knowledge_base import get_knowledge_base
    cp_kb = get_knowledge_base()
    if cp_kb and area and area != "West Bank":
        cp_key = cp_kb.find_checkpoint(area)
        if cp_key:
            cp = cp_kb.get_checkpoint(cp_key)
            if cp and cp.get("latitude") and cp.get("longitude"):
                result["latitude"] = cp["latitude"]
                result["longitude"] = cp["longitude"]
                result["geo_precision"] = "checkpoint"
                result["geo_source_phrase"] = area
                return

    # Tier 2.5: fuzzy directional/proximity ("south of Nablus" / "بالقرب من رام الله")
    fuzzy = _extract_fuzzy_location(result.get("raw_text", ""), loc_kb)
    if fuzzy:
        result["latitude"], result["longitude"], result["geo_source_phrase"] = fuzzy
        result["geo_precision"] = "fuzzy"
        return

    # Tier 3: zone center fallback
    if zone and zone in WB_ZONES:
        lat, lon = WB_ZONES[zone]["center"]
        result["latitude"] = lat
        result["longitude"] = lon
        result["geo_precision"] = "zone"
        result["geo_source_phrase"] = zone
        return

    # Tier 4: region-wide (no useful point — map clients should use polygon)
    result["geo_precision"] = "region"
    result["geo_source_phrase"] = area or "West Bank"


# ── Public interface ──────────────────────────────────────────────────────────

def is_security_relevant(text: str) -> bool:
    """
    Broad pre-filter for Tier 1 (missile/siren) classification.
    Only checks for attack verbs — operational events bypass this gate.
    """
    normed = _normalize(text)
    return _has_attack_verb(normed)


def classify(raw_text: str, source: str) -> Optional[dict]:
    """
    Tier 1: Missile/rocket sirens or confirmed impacts.

    All missile/siren alerts are treated as LOCAL threats — the West Bank and
    Israel share the same geographic space. A missile hitting Tel Aviv or Haifa
    is a direct threat to WB residents (same airspace, same sirens).

    Returns a dict ready for Alert construction, or None.
    Always call is_security_relevant() first as a cheap pre-check.
    """
    if not _channel_allows_tier(source, "tier1"):
        return None

    clean = _sanitize(raw_text)
    normed = _normalize(clean)

    if not _has_attack_verb(normed):
        return None

    if _is_noise(normed, source=source):
        return None

    # Israel attacking outward (bombing Lebanon/Syria) → not an incoming threat.
    # EXCEPTION: Israel attacking Gaza or the West Bank is exactly the event we
    # want to surface, so don't filter when a Palestinian zone is named.
    if _has(normed, ISRAEL_ATTACKING_OUT) and not (_is_gaza_zone(normed) or _is_wb_zone(normed)):
        return None

    # Gaza first — Gaza keys are also in WB_ZONE for back-compat, so without
    # this branch a Gaza airstrike would mis-route to west_bank_siren.
    if _is_gaza_zone(normed):
        area = _extract_area(normed) or "Gaza Strip"
        zone = _extract_zone(normed) or "gaza_strip"
        # Major Gaza city + active strike → critical; otherwise high
        severity = (
            Severity.critical
            if any(k in normed for k in [
                _normalize("مدينه غزه"), _normalize("مدينة غزه"),
                _normalize("خان يونس"), _normalize("رفح"),
                _normalize("جباليا"), _normalize("بيت حانون"), _normalize("بيت لاهيا"),
            ])
            else Severity.high
        )
        return _build(AlertType.gaza_strike, severity, clean, source, area, zone=zone)

    # Northern Israel (Galilee / border settlements) → its own type. Must
    # be checked BEFORE the WB-zone branch because the framing "شمال
    # فلسطين المحتلة" matches "فلسطين" in WB_ZONE and would otherwise
    # mis-route to west_bank_siren.
    if _is_northern_israel(normed):
        area = _extract_area(normed) or "Northern Israel"
        return _build(AlertType.northern_israel_siren, Severity.high,
                      clean, source, area)

    # West Bank explicitly mentioned → CRITICAL/HIGH
    if _is_wb_zone(normed):
        severity = (
            Severity.critical
            if _normalize("رام الله") in normed or "ramallah" in normed.lower()
            else Severity.high
        )
        area = _extract_area(normed) or "West Bank"
        zone = _extract_zone(normed)
        return _build(AlertType.west_bank_siren, severity, clean, source, area, zone=zone)

    # Sirens / missiles hitting Israel interior — same geolocation, HIGH severity
    siren_terms = [_normalize(t) for t in ["صافرات", "انذار", "صافره"]]
    has_siren = any(s in normed for s in siren_terms) or "sirens" in normed.lower()

    # Retrospective / past-event narratives describing prior strikes — these are
    # historical reports, not live sirens. Audit 2026-04-19 (#34) caught Channel-12
    # reports about damage "بفعل الصواريخ الإيرانية خلال الحرب" mis-firing as siren.
    retrospective_markers = [_normalize(t) for t in [
        "بفعل", "خلال الحرب", "خلال المعركه", "خلال العمليه",
        "في الحرب الاخيره", "اثر الحرب", "عقب الحرب",
    ]]
    is_retrospective = _has(normed, retrospective_markers)

    if _is_israel_interior(normed) or has_siren:
        # Co-occurrence guard: Lebanon/Iran/Syria + Israel city without an active
        # siren marker → regional narrative, not a current incoming alert.
        if _is_mena_zone(normed) and not has_siren:
            area = _extract_area(normed)
            return _build(AlertType.regional_attack, Severity.medium, clean, source, area)
        if is_retrospective and not has_siren:
            area = _extract_area(normed)
            return _build(AlertType.regional_attack, Severity.medium, clean, source, area)
        area = _extract_area(normed) or "West Bank"
        zone = _extract_zone(normed) or "west_bank"
        return _build(AlertType.west_bank_siren, Severity.high, clean, source, area, zone=zone)

    # MENA country as source of incoming attack (Iran/Yemen/Lebanon → Israel/WB)
    # Audit 2026-04-19 (#34): the prior `urgency OR israel_target` gate fired on
    # every Lebanese casualty report (all of them carry عاجل) and labelled them
    # west_bank_siren. Now require an explicit Israel/WB target AND an active
    # incoming-attack indicator (rocket / siren / projectile). Casualty narratives
    # without a target downgrade to regional_attack.
    if _is_mena_zone(normed):
        has_israel_target = _has(normed, ISRAEL_AS_TARGET)
        has_incoming = _has(normed, INCOMING_ATTACK_INDICATORS)
        if has_israel_target and has_incoming:
            area = _extract_area(normed) or "West Bank"
            zone = _extract_zone(normed) or "west_bank"
            return _build(AlertType.west_bank_siren, Severity.high, clean, source, area, zone=zone)
        # MENA event without an active rocket/siren on Israeli targets → Tier 3
        area = _extract_area(normed)
        return _build(AlertType.regional_attack, Severity.medium, clean, source, area)

    return None


def classify_wb_operational(raw_text: str, source: str) -> Optional[dict]:
    """
    Tier 2: West Bank operational events.

    IDF raids, settler attacks, demolitions, road closures, flying checkpoints,
    injury reports, arrest campaigns.

    Does NOT require attack verbs — these are ground-level events.
    Uses broader WB context detection (not just zone list) to avoid missing
    events in villages not explicitly listed.

    Returns a dict ready for Alert construction, or None to discard.
    """
    if not _channel_allows_tier(source, "tier2"):
        return None

    clean = _sanitize(raw_text)
    normed = _normalize(clean)

    # Must be WB-relevant (exact zone match OR Palestinian context markers)
    wb_relevant = _is_wb_contextual(normed)
    if not wb_relevant:
        return None

    # MENA guard: if message mentions MENA countries but no specific WB city,
    # it's regional news misclassified as WB operational (Iran/Lebanon/Turkey events)
    if _is_mena_zone(normed) and not _is_wb_zone(normed):
        return None

    if _is_noise(normed, tier="tier2", source=source):
        return None

    # News attribution filter — applied to Tier 2 as well (not just Tier 1)
    if not _is_news_channel(source) and _has(normed, NEWS_ATTRIBUTION):
        return None

    # Gaza-aware fallbacks for Tier 2 ground events
    _is_gaza = _is_gaza_text(normed)
    area = _extract_area(normed) or ("Gaza Strip" if _is_gaza else "West Bank")
    zone = _extract_zone(normed) or ("gaza_strip" if _is_gaza else "west_bank")
    is_urgent = _has_urgent_marker(normed)

    # ── B5 — civilian-life specific checks (run BEFORE generic injury/raid/arrest)
    # Hospital strike beats raid (raid into a hospital is more specifically "hospital_strike")
    if _has(normed, HOSPITAL_NOUNS) and _has(normed, HOSPITAL_HARM_VERBS):
        return _build(AlertType.hospital_strike, Severity.high, clean, source, area, zone=zone)

    # Journalist targeted beats generic injury (subject + harm verb both required)
    if _has(normed, JOURNALIST_TARGETED_TERMS) and _has(normed, JOURNALIST_HARM_VERBS):
        return _build(AlertType.journalist_targeted, Severity.high, clean, source, area, zone=zone)

    # Child detention beats generic arrest (when the subject is explicitly a child)
    if _has(normed, CHILD_DETENTION_TERMS):
        return _build(AlertType.child_detention, Severity.medium, clean, source, area, zone=zone)

    # Evacuation order doesn't conflict but high severity
    if _has(normed, EVACUATION_ORDER_TERMS):
        return _build(AlertType.evacuation_order, Severity.high, clean, source, area, zone=zone)

    # Injury report — highest priority operational event
    if _has(normed, INJURY_TERMS):
        # Martyrdom = high, injuries = medium
        martyrdom_terms = [_normalize(t) for t in ["استشهد", "استشهاد", "شهيد", "شهداء", "ارتقى"]]
        if any(t in normed for t in martyrdom_terms):
            severity = Severity.high
        else:
            severity = Severity.high if is_urgent else Severity.medium
        return _build(AlertType.injury_report, severity, clean, source, area, zone=zone)

    # IDF raid / military incursion
    if _has(normed, IDF_RAID_VERBS):
        # Arrest subtype
        arrest_terms = [_normalize(t) for t in ["اعتقل", "اعتقال", "اعتقالات"]]
        subtype = "arrest" if any(w in normed for w in arrest_terms) else "raid"
        severity = Severity.high if is_urgent else Severity.medium
        result = _build(AlertType.idf_raid, severity, clean, source, area, zone=zone)
        result["event_subtype"] = subtype
        
        if subtype == "arrest":
            # Extract number of arrests
            count_match = re.search(r"اعتقال(\s+نحو)?\s+([0-9\u0660-\u0669]+|شابين|مواطنين اثنين|شاب)", normed)
            if count_match:
                num_str = count_match.group(2)
                if num_str == "شابين" or num_str == "مواطنين اثنين":
                    result["count"] = 2
                elif num_str == "شاب" or num_str == "مواطن":
                    result["count"] = 1
                elif num_str.isdigit():
                    result["count"] = int(num_str)
                else:
                    arabic_to_eng = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
                    try:
                        result["count"] = int(num_str.translate(arabic_to_eng))
                    except ValueError:
                        result["count"] = 1
            else:
                result["count"] = 1
                
        return result

    # Settler attack — compound phrases (self-sufficient) OR actor+action verb pair
    settler_matched = _has(normed, SETTLER_ATTACK_PHRASES)
    if not settler_matched:
        # Actor term without a compound phrase — require action verb co-occurrence
        has_actor = _has(normed, SETTLER_ACTOR_TERMS)
        has_action = _has(normed, SETTLER_ACTION_VERBS)
        if has_actor and has_action:
            settler_matched = True
    if settler_matched:
        severity = Severity.high if is_urgent else Severity.medium
        return _build(AlertType.settler_attack, severity, clean, source, area, zone=zone)

    # Demolition
    if _has(normed, DEMOLITION_TERMS):
        severity = Severity.medium
        return _build(AlertType.demolition, severity, clean, source, area, zone=zone)

    # Arrest campaign (standalone, without raid context)
    if _has(normed, ARREST_CAMPAIGN_TERMS):
        severity = Severity.medium
        result = _build(AlertType.arrest_campaign, severity, clean, source, area, zone=zone)
        result["event_subtype"] = "arrest_campaign"
        
        # Extract number of arrests if present (e.g. "اعتقال 5 شبان", "اعتقال شابين")
        # Handle Arabic and English numerals, as well as common words for small numbers
        count_match = re.search(r"اعتقال(\s+نحو)?\s+([0-9\u0660-\u0669]+|شابين|مواطنين اثنين|شاب)", normed)
        if count_match:
            num_str = count_match.group(2)
            if num_str == "شابين" or num_str == "مواطنين اثنين":
                result["count"] = 2
            elif num_str == "شاب" or num_str == "مواطن":
                result["count"] = 1
            elif num_str.isdigit():
                result["count"] = int(num_str)
            else:
                # Convert Arabic numerals to English
                arabic_to_eng = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
                try:
                    result["count"] = int(num_str.translate(arabic_to_eng))
                except ValueError:
                    result["count"] = 1
        else:
            result["count"] = 1 # Minimum 1 if an arrest occurred
            
        return result

    # Flying checkpoint
    if _has(normed, FLYING_CP_TERMS):
        severity = Severity.low
        return _build(AlertType.flying_checkpoint, severity, clean, source, area, zone=zone)

    # Road closure
    if _has(normed, ROAD_CLOSURE_TERMS):
        severity = Severity.low
        return _build(AlertType.road_closure, severity, clean, source, area, zone=zone)

    # B5 — utility/school checks here (low/medium impact, no conflict with priors)
    if _has(normed, UTILITY_CUTOFF_TERMS):
        return _build(AlertType.utility_cutoff, Severity.medium, clean, source, area, zone=zone)

    if _has(normed, SCHOOL_CLOSURE_TERMS):
        return _build(AlertType.school_closure, Severity.low, clean, source, area, zone=zone)

    return None
