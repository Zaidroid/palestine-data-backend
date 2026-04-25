"""
Entity extractor — converts each classified alert into one or more rows in
the long-term databank tables (people_killed, people_injured, people_detained,
structures_damaged, actor_actions).

Heuristic rules, not ML. Same record from multiple alerts/sources collapses
via deterministic stable_id hashing in databank.py.
"""

import logging
import re
from typing import Optional

from .models import Alert, AlertType
from . import databank

log = logging.getLogger("entity_extractor")


# Cause inference: map alert type → most likely cause string.
_CAUSE_BY_TYPE = {
    AlertType.gaza_strike:       "airstrike",
    AlertType.west_bank_siren:   "missile",
    AlertType.regional_attack:   "missile",
    AlertType.idf_raid:          "raid",
    AlertType.settler_attack:    "settler_attack",
    AlertType.demolition:        "demolition",
    AlertType.injury_report:     "raid",
    AlertType.arrest_campaign:   "raid",
    AlertType.shooting:          "bullet",
    AlertType.airstrike:         "airstrike",
    AlertType.rocket_attack:     "missile",
    AlertType.explosion:         "other",
}

# Keyword → structure type, scanned in alert raw_text (already Arabic).
_STRUCTURE_KEYWORDS = [
    ("منزل", "home"), ("منازل", "home"), ("بيت", "home"), ("بيوت", "home"),
    ("مدرسه", "school"), ("مدرسة", "school"),
    ("مسجد", "mosque"), ("جامع", "mosque"),
    ("مستشفى", "infrastructure"), ("مركز صحي", "infrastructure"),
    ("شارع", "infrastructure"), ("طريق", "infrastructure"),
    ("بئر", "infrastructure"), ("خط مياه", "infrastructure"),
    ("اشجار", "agricultural"), ("زيتون", "agricultural"), ("ارض زراعيه", "agricultural"),
]


def _detect_structure_type(text: str) -> Optional[str]:
    for kw, t in _STRUCTURE_KEYWORDS:
        if kw in text:
            return t
    return None


def _detect_actor(alert_type: AlertType, text: str) -> Optional[str]:
    if alert_type == AlertType.settler_attack or "مستوطن" in text:
        return "settlers"
    if any(k in text for k in ("جيش الاحتلال", "قوات الاحتلال", "الجيش")):
        return "idf"
    if "شرطه" in text or "شرطة" in text:
        return "police"
    return None


def _detect_action(alert_type: AlertType) -> Optional[str]:
    return {
        AlertType.idf_raid:        "raid",
        AlertType.settler_attack:  "settler_attack",
        AlertType.demolition:      "demolition",
        AlertType.arrest_campaign: "arrest_campaign",
        AlertType.shooting:        "shooting",
        AlertType.injury_report:   "raid",
    }.get(alert_type)


# Rough Arabic name extraction — captures phrases like "استشهاد X" / "اعتقل X"
# where X is a 2-4-token capitalized name. This is loose; Arabic doesn't
# capitalize, so we use length + position heuristics. Future: NER model.
_NAME_AFTER_VERB = re.compile(
    r"(?:استشهاد|اعتقال|اصابه|اصابة)\s+([ء-ي][ء-ي\s]{4,40}?)(?=\s+(?:في|من|بـ|على|بعد|اثر|إثر|،|\.))",
)


def _extract_named_individual(text: str) -> Optional[str]:
    m = _NAME_AFTER_VERB.search(text)
    if not m:
        return None
    name = m.group(1).strip()
    # Reject obvious junk (too few words, contains a Latin char, common stopwords).
    if len(name.split()) < 2 or len(name.split()) > 6:
        return None
    return name


# ── Public entry point ────────────────────────────────────────────────────────

async def extract_entities(alert: Alert) -> dict:
    """Inspect a freshly inserted alert and write any derived rows into the
    databank. Returns a dict {table: rows_written} for logging.

    Assumes alert has stable type + count + lat/lng populated by classifier.
    Failure modes are swallowed (logged) so the alert pipeline never breaks
    on entity-extraction issues.
    """
    written = {}
    try:
        atype = alert.type if isinstance(alert.type, AlertType) else AlertType(alert.type)
    except ValueError:
        return written

    text = alert.raw_text or ""
    cause = _CAUSE_BY_TYPE.get(atype)
    count = alert.count or 0
    date = alert.timestamp.isoformat()[:10] if alert.timestamp else None
    place_name = alert.area
    place_region = (
        "Gaza Strip" if (alert.zone or "").startswith("gaza")
        else ("West Bank" if alert.zone else None)
    )

    common = {
        "date": date,
        "place_name": place_name,
        "place_region": place_region,
        "lat": alert.latitude,
        "lng": alert.longitude,
        "source_alert_id": alert.id,
        "source_dataset": "classifier",
        "source_url": None,
        "attribution_text": f"Derived from real-time alert #{alert.id} (channel: {alert.source}).",
        "confidence": alert.confidence or 0.5,
    }

    # ── Killed (Gaza strike, regional attack, west_bank_siren that mentions casualties) ──
    if atype in (AlertType.gaza_strike, AlertType.airstrike) or "استشهد" in text or "شهيد" in text:
        named = _extract_named_individual(text)
        if named or count > 0:
            sid = databank.stable_id(
                "killed", atype.value, alert.id, named or f"unnamed-{count}", date
            )
            try:
                rid = await databank.upsert_person_killed({
                    "stable_id": sid,
                    "name_ar": named,
                    "name_en": None,
                    "age": None,
                    "gender": None,
                    "date_precision": "day" if date else "unknown",
                    "cause": cause or "other",
                    "notes": text[:500],
                    **common,
                })
                written["people_killed"] = rid
            except Exception as e:
                log.warning(f"people_killed upsert failed: {e}")

    # ── Injured ──
    if atype == AlertType.injury_report or count > 0 and any(k in text for k in ("اصيب", "أصيب", "جرحى")):
        sid = databank.stable_id(
            "injured", alert.id, count, place_name, date
        )
        try:
            rid = await databank.upsert_person_injured({
                "stable_id": sid,
                "count": max(1, count),
                "severity_hint": None,
                "cause": cause or "other",
                "notes": text[:500],
                **common,
            })
            written["people_injured"] = rid
        except Exception as e:
            log.warning(f"people_injured upsert failed: {e}")

    # ── Detained ──
    if atype == AlertType.arrest_campaign or "اعتقل" in text or "اعتقال" in text:
        named = _extract_named_individual(text)
        sid = databank.stable_id(
            "detained", alert.id, named or f"unnamed-{count}", date
        )
        try:
            rid = await databank.upsert_person_detained({
                "stable_id": sid,
                "name_ar": named,
                "name_en": None,
                "age": None,
                "gender": None,
                "date_arrested": date,
                "date_released": None,
                "status": "arrested",
                "detention_facility": None,
                "sentence_months": None,
                "count": max(1, count),
                "notes": text[:500],
                **common,
            })
            written["people_detained"] = rid
        except Exception as e:
            log.warning(f"people_detained upsert failed: {e}")

    # ── Structures damaged ──
    if atype == AlertType.demolition or "هدم" in text or "تجريف" in text:
        stype = _detect_structure_type(text) or "other"
        sid = databank.stable_id(
            "structure", atype.value, alert.id, stype, place_name, date
        )
        try:
            rid = await databank.upsert_structure_damaged({
                "stable_id": sid,
                "type": stype,
                "owner_name": None,
                "cause": cause or "demolition",
                "notes": text[:500],
                **common,
            })
            written["structures_damaged"] = rid
        except Exception as e:
            log.warning(f"structures_damaged upsert failed: {e}")

    # ── Actor actions ──
    actor = _detect_actor(atype, text)
    action = _detect_action(atype)
    if actor and action:
        sid = databank.stable_id(
            "action", actor, action, place_name, date, alert.id
        )
        try:
            rid = await databank.upsert_actor_action({
                "stable_id": sid,
                "actor_type": actor,
                "actor_name": None,
                "action_type": action,
                "target_count": count or None,
                "notes": text[:500],
                **common,
            })
            written["actor_actions"] = rid
        except Exception as e:
            log.warning(f"actor_actions upsert failed: {e}")

    if written:
        log.info(f"databank: alert #{alert.id} → {written}")
    return written
