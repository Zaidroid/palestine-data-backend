"""Pure aggregation for the home-screen operational stat cards.

Kept free of FastAPI / DB imports so the counting logic is unit-testable in
isolation (see test_stats_today.py).
"""
import re
from typing import Iterable, Optional

# West Bank tracker: OCHA point-in-polygon stamps each alert's admin1 when its
# coordinates resolve; Gaza-wide casualty roundups carry admin1 == "Gaza Strip"
# and must not inflate West Bank daily counts.
_NON_WB_ADMIN1 = {"Gaza Strip"}


def _is_west_bank(alert) -> bool:
    """False only when an alert is positively geofenced outside the West Bank.
    Un-geocoded alerts (admin1 is None) are kept."""
    return getattr(alert, "admin1", None) not in _NON_WB_ADMIN1


# ── dedup signatures ───────────────────────────────────────────────────────────
# These are NEWS reports, not incident records: one event (a raid, a named
# detention) is reported by many channels. Counting reports overstates reality,
# so each card counts DISTINCT events by a signature.

_URL = re.compile(r"https?://\S+")
_WS = re.compile(r"\s+")

# Honorifics that precede Arabic names — stripped so "الأسير عماد سرحان" and
# "عماد سرحان" resolve to the same person.
_HONORIFICS = {
    "الاسير", "الأسير", "الاسيرة", "الأسيرة", "الشهيد", "الشهيدة", "الطفل",
    "الطفلة", "المواطن", "المواطنة", "الشاب", "الشابة", "الحاج", "الشيخ",
    "الدكتور", "السيد", "الفتى", "الاسرى", "الأسرى",
}
_NAME_RE = re.compile(
    r"(?:اعتقال|اعتقل[تيوه]?|استشهاد|استشهد[تي]?)\s+"
    r"([؀-ۿ][؀-ۿ\s]{3,40}?)"
    r"(?=\s+(?:في|من|بـ|على|بعد|اثر|إثر|خلال|لدى|،|\.|$))"
)


def _norm(s: Optional[str]) -> str:
    s = _URL.sub("", s or "").replace("|", " ").replace("▪️", " ")
    return _WS.sub(" ", s).strip()


def _extract_name(text: str) -> Optional[str]:
    """Best-effort Arabic detainee/martyr name after an action verb. Heuristic;
    returns None on low confidence (callers fall back to a location signature)."""
    m = _NAME_RE.search(_norm(text))
    if not m:
        return None
    toks = [w for w in m.group(1).split() if w not in _HONORIFICS]
    if not 2 <= len(toks) <= 5:
        return None
    return " ".join(toks[:3])


def _loc_sig(a) -> str:
    return _norm(getattr(a, "area", None) or getattr(a, "admin2", None)
                 or getattr(a, "title", None) or "")


def _detention_key(a) -> str:
    name = _extract_name(getattr(a, "raw_text", "") or getattr(a, "title", "") or "")
    return "name:" + name if name else "loc:" + _loc_sig(a)


def _is_arrest(a) -> bool:
    return (a.type == "arrest_campaign" or a.type == "child_detention"
            or getattr(a, "event_subtype", "") == "arrest")


def aggregate_today_counts(alerts: Iterable) -> dict:
    """Count today's operational events for the four home-screen stat cards.

    Every card counts DISTINCT West-Bank events, not raw reports:
      - raids: distinct location signature over idf_raid (excluding arrests);
      - detentions: distinct detainee name, else location, over arrest_campaign
        + child_detention + idf_raid/arrest-subtype — never summing the
        classifier's free-text count;
      - injuries: distinct reports (the classifier count is routinely a
        cumulative figure — see C);
      - settler: distinct events.
    Alerts geofenced outside the West Bank are excluded from every card.
    """
    raid_sigs = set()
    detention_keys = set()
    injuries = 0
    settler = 0

    for a in alerts:
        if not _is_west_bank(a):
            continue
        if _is_arrest(a):
            detention_keys.add(_detention_key(a))
        elif a.type == "idf_raid":
            raid_sigs.add(_loc_sig(a))
        elif a.type == "injury_report":
            injuries += 1
        elif a.type == "settler_attack":
            settler += 1

    return {
        "total_arrests_today": len(detention_keys),
        "total_injuries_today": injuries,
        "settler_attacks_today": settler,
        "military_raids_today": len(raid_sigs),
    }
