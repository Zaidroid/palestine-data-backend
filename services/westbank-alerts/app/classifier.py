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
    "غاره جويه", "غاره",
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
    "بورين", "مادما", "عوره", "تل", "عقربا", "قبلان", "يتما",
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


def _is_gaza_text(normed_text: str) -> bool:
    """Cheap check: does the text mention Gaza generally?"""
    return any(m in normed_text for m in _GAZA_GENERAL_MARKERS)


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


# ── Breaking news markers (QudsN style) ─────────────────────────────────────

URGENT_MARKERS = [
    "عاجل", "عااجل", "خبر عاجل",
    "الان", "حدث الان",
    "بث مباشر",
]
URGENT_MARKERS = [_normalize(m) for m in URGENT_MARKERS]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has(text: str, keywords: list) -> bool:
    return any(kw in text for kw in keywords)


def _has_attack_verb(text: str) -> bool:
    return _has(text, ATTACK_VERBS_AR) or _has(text, [v.lower() for v in ATTACK_VERBS_EN])


def _is_wb_zone(text: str) -> bool:
    return any(z in text for z in WB_ZONE)


def _is_mena_zone(text: str) -> bool:
    return any(z in text for z in MENA_ZONE)


def _is_israel_interior(text: str) -> bool:
    return any(c in text for c in ISRAEL_INTERIOR)


def _is_noise(text: str, tier: str = "tier1", source: str = "") -> bool:
    """True if text is dominated by statement/attribution/speculative language.

    tier="tier1": also filters ground-op terms (raids/arrests) from missile classifier.
    tier="tier2": skips ground-op filter since those ARE the events we want.
    source: channel username — news channels get relaxed attribution filtering.
    """
    is_news = _is_news_channel(source)

    # News attribution — only discard for non-news channels.
    # WAFA/QudsN ARE news agencies; their messages naturally contain attribution.
    # For news channels, only discard analysis/report/summary prefixes.
    if is_news:
        report_prefixes = [_normalize(t) for t in [
            "تقرير:", "تقرير |", "تحليل:", "ملخص:", "مراجعه:",
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


def _extract_area(text: str) -> Optional[str]:
    """Return the most specific area match (longest key wins)."""
    for ar in _AREA_KEYS_SORTED:
        if ar in text:
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


def _compute_confidence(
    severity: Severity,
    source: str,
    area: Optional[str],
    zone: Optional[str],
    text: str,
    alert_type: AlertType,
) -> tuple[float, float]:
    """Return (confidence, source_reliability), both clamped to [0.0, 1.0].

    Confidence blends three signals:
      1. Channel reliability (the source has a track record)
      2. Severity (the classifier ranks the impact)
      3. Locality clarity (a named area inside a known zone is more trustworthy
         than a generic "West Bank" label, which often masks stale recycling)
    The MENA guard already runs upstream in the tier-1 classifier — anything
    that survives that gate gets a small lift here for "passed the noise
    filter" credit.
    """
    rel = _channel_weight(source)
    base = 0.5 + (rel - 0.5) * 0.6      # 0.20 .. 0.80 from reliability alone
    base += _SEVERITY_BUMP.get(severity, 0.0)
    if area and area != "West Bank":
        base += 0.05
    if zone:
        base += 0.05
    # Tier 1 (siren) survived the attack-verb + MENA guard, so it's structurally
    # more reliable than tier-2 operational events that have no such gate.
    if alert_type in (AlertType.west_bank_siren, AlertType.regional_attack):
        base += 0.05
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
        AlertType.west_bank_siren:   "West Bank Alert",
        AlertType.regional_attack:   "Regional Attack",
        AlertType.idf_raid:          "IDF Raid",
        AlertType.settler_attack:    "Settler Attack",
        AlertType.road_closure:      "Road Closure",
        AlertType.flying_checkpoint: "Flying Checkpoint",
        AlertType.injury_report:     "Injury Report",
        AlertType.demolition:        "Demolition",
        AlertType.arrest_campaign:   "Arrest Campaign",
    }
    TYPE_LABEL_AR = {
        AlertType.west_bank_siren:   "تنبيه الضفة الغربية",
        AlertType.regional_attack:   "هجوم إقليمي",
        AlertType.idf_raid:          "اقتحام",
        AlertType.settler_attack:    "اعتداء مستوطنين",
        AlertType.road_closure:      "إغلاق طريق",
        AlertType.flying_checkpoint: "حاجز طيار",
        AlertType.injury_report:     "إصابة",
        AlertType.demolition:        "هدم",
        AlertType.arrest_campaign:   "حملة اعتقالات",
    }
    label_en = TYPE_LABEL_EN.get(alert_type, "Alert")
    label_ar = TYPE_LABEL_AR.get(alert_type, "تنبيه")
    built_title = title or (f"{label_en} — {area}" if area else label_en)
    built_title_ar = f"{label_ar} — {area}" if area else label_ar

    confidence, source_reliability = _compute_confidence(
        severity, source, area, zone, text, alert_type
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
        "status":             "active",
    }

    # 3-tier coordinate resolution: location KB → checkpoint KB → zone center
    _resolve_coordinates(result, area, zone)

    return result


def _resolve_coordinates(result: dict, area: Optional[str], zone: Optional[str]):
    """Attach lat/lng using best available source."""
    from .location_knowledge_base import get_location_kb

    # Tier 1: location knowledge base (per-city coordinates)
    loc_kb = get_location_kb()
    if loc_kb and area and area != "West Bank":
        loc_key = loc_kb.find_location(area)
        if not loc_key:
            # Try English name lookup
            loc_key = loc_kb.by_english.get(area.lower())
        if loc_key:
            coords = loc_kb.get_coordinates(loc_key)
            if coords:
                result["latitude"], result["longitude"] = coords
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
                return

    # Tier 3: zone center fallback
    if zone and zone in WB_ZONES:
        lat, lon = WB_ZONES[zone]["center"]
        result["latitude"] = lat
        result["longitude"] = lon


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

    # Israel attacking outward (bombing Lebanon/Syria) → not an incoming threat
    if _has(normed, ISRAEL_ATTACKING_OUT):
        return None

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

    if _is_israel_interior(normed) or has_siren:
        area = _extract_area(normed) or "West Bank"
        zone = _extract_zone(normed) or "west_bank"
        return _build(AlertType.west_bank_siren, Severity.high, clean, source, area, zone=zone)

    # MENA country as source of incoming attack (Iran/Yemen/Lebanon → Israel/WB)
    if _is_mena_zone(normed):
        has_urgency = _has_urgent_marker(normed)
        has_israel_target = _has(normed, ISRAEL_AS_TARGET)
        if has_urgency or has_israel_target:
            area = _extract_area(normed) or "West Bank"
            zone = _extract_zone(normed) or "west_bank"
            return _build(AlertType.west_bank_siren, Severity.high, clean, source, area, zone=zone)
        # MENA event without clear Israel/WB target → medium severity
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

    return None
