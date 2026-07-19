#!/usr/bin/env python3
"""Match OSM checkpoint nodes to catalog entries → propose coordinate upgrades to
checkpoint-precision. Name-core match (primary) + proximity (secondary). Outputs
proposals for review; does NOT write the catalog."""
import json, re, math, pathlib

BASE = pathlib.Path(__file__).parent
CATP = BASE.parent.parent / "services/westbank-alerts/data/known_checkpoints.json"
cat = json.load(open(CATP))
osm = json.load(open(BASE / "osm_checkpoints.json"))


def norm(s):
    s = s or ""
    for a, b in [("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


# strip generic checkpoint words to get the place core
_STRIP = [norm(w) for w in ("حاجز", "نقطة تفتيش", "نقطه تفتيش", "معبر", "مركز حدود",
          "العسكري", "العسكريه", "الاسرائيلي", "الاسرائيليه", "الاسرائيلية", "check point",
          "checkpoint", "crossing", "الجديد", "بوابة", "بوابه", "مفرق", "دوار")]
def core(s):
    s = norm(s)
    for w in _STRIP:
        s = s.replace(w, " ")
    return re.sub(r"\s+", " ", s).strip()


def haversine(a, b, c, d):
    R = 6371.0
    p, q = math.radians(c - a), math.radians(d - b)
    x = math.sin(p / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(q / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def tokens(s):
    return {t for t in core(s).split() if len(t) >= 3}


# index catalog: token set across all name forms
cat_tok = []
for e in cat:
    names = [e.get("canonical_key", "").replace("_", " "), e.get("name_ar", ""), e.get("name_en", "")] + e.get("aliases", [])
    tk = set()
    for n in names:
        tk |= tokens(n)
    cat_tok.append((e, tk))

proposals = []
for o in osm:
    otok = tokens(o["name_ar"]) | tokens(o["name"]) | tokens(o.get("name_en", ""))
    if not otok:
        continue
    best = None  # (entry, dist, shared_tokens)
    for e, tk in cat_tok:
        if not e.get("latitude"):
            continue
        dist = haversine(o["lat"], o["lon"], e["latitude"], e["longitude"])
        shared = otok & tk
        # high confidence requires a SHARED NAME TOKEN within 6km (proximity alone
        # is unreliable — many checkpoints cluster in Hebron/Jerusalem).
        if shared and dist < 6:
            score = (len(shared), -dist)
            if best is None or score > best[3]:
                best = (e, dist, shared, score)
    if best:
        e, dist, shared, _ = best
        old = (e.get("latitude"), e.get("longitude"))
        proposals.append({
            "catalog_key": e["canonical_key"], "catalog_name": e.get("name_ar"),
            "osm_name_ar": o["name_ar"], "osm_name_en": o.get("name_en") or o.get("name"),
            "old": [round(old[0], 4), round(old[1], 4)], "new": [o["lat"], o["lon"]],
            "shift_km": round(dist, 2), "shared_tokens": sorted(shared),
            "cur_precision": e.get("geo_precision", "(none)"),
        })

# dedup: keep the closest OSM match per catalog key
bykey = {}
for p in proposals:
    k = p["catalog_key"]
    if k not in bykey or p["shift_km"] < bykey[k]["shift_km"]:
        bykey[k] = p
proposals = sorted(bykey.values(), key=lambda p: -p["shift_km"])

json.dump(proposals, open(BASE / "osm_match_proposals.json", "w"), ensure_ascii=False, indent=1)
print(f"{len(proposals)} catalog checkpoints matched to an OSM node by name")
print(f"{'key':20} {'shift_km':>8}  osm_name  (cur_prec)")
for p in proposals:
    print(f"  {p['catalog_key'][:19]:20} {p['shift_km']:>7}km  {p['osm_name_ar'] or p['osm_name_en']}  [{p['cur_precision']}]")
