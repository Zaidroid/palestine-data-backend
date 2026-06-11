"""
Corpus evidence miner (Tier-A rework, phase 2).

Reads /data/corpus/*.jsonl dumps and reports, per channel:
- volume + days covered + posts/day
- status-vocabulary frequencies (open/closed/congested families + emojis)
- checkpoint-name candidates: tokens that co-occur with status words but are
  NOT in known_checkpoints.json (feeds KB expansion)
- share of messages the current checkpoint parser would act on

Run locally:  python3 scripts/analyze_corpus.py <corpus-dir>
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

CORPUS = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/corpus")
KB_PATH = Path(__file__).resolve().parent.parent / "data" / "known_checkpoints.json"

_ALEF = re.compile(r"[إأآٱا]")
def norm(s):
    s = _ALEF.sub("ا", s or "")
    s = s.replace("ة", "ه")
    s = re.sub(r"[ىي]", "ي", s)
    return re.sub(r"\s+", " ", re.sub(r"[^؀-ۿa-z0-9 ]", " ", s.lower())).strip()

STATUS_FAMILIES = {
    "open": ["سالك", "سالكه", "مفتوح", "فتح", "سالكين"],
    "closed": ["مغلق", "مسكر", "اغلاق", "سكر", "مغلقه", "إغلاق"],
    "congested": ["ازمه", "أزمة", "كثافه", "مكثف", "ازدحام", "خانقه"],
    "idf": ["جيش", "تواجد", "اقتحام", "مداهمه", "دوريه", "جيب"],
    "inspection": ["تفتيش", "فحص", "تدقيق", "توقيف"],
    "settler": ["مستوطن", "مستوطنين", "اعتداء"],
}
EMOJIS = ["✅", "❌", "🔴", "🟢", "🟡", "🟣", "⚠️", "🚧", "🔵"]

STOP = set("في من الى إلى على عن مع بعد قبل عند حتى كل هذا هذه ذلك يا ما لا لم لن ان أن او أو ثم اذا إذا الآن الان اليوم صباح مساء يوجد حسب عبر بين دون غير الله محدث تحديث عاجل الاحتلال الإحتلال قوات حاجز حواجز مدخل بوابه باتجاه اتجاه طريق الطريق شارع مفرق دوار سياره سيارات مركبات شاحنات".split())


def main():
    kb = json.load(open(KB_PATH))
    kb_names = set()
    for cp in kb:
        for n in [cp["canonical_key"], cp.get("name_ar", ""), *cp.get("aliases", [])]:
            if n:
                kb_names.add(norm(n).replace(" ", ""))

    grand_candidates = Counter()
    print(f"{'channel':<26} {'msgs':>6} {'days':>5} {'msg/d':>6} {'status%':>8}  top status words")
    print("-" * 110)

    for f in sorted(CORPUS.glob("*.jsonl")):
        msgs = [json.loads(l) for l in open(f, encoding="utf-8")]
        if not msgs:
            continue
        dates = sorted(m["date"][:10] for m in msgs)
        days = max(1, (len(set(dates))))
        vocab = Counter()
        with_status = 0
        cand = Counter()
        for m in msgs:
            t = m["text"]
            nt = norm(t)
            hit = False
            for fam, words in STATUS_FAMILIES.items():
                for w in words:
                    c = nt.count(norm(w))
                    if c:
                        vocab[f"{fam}:{w}"] += c
                        hit = True
            for e in EMOJIS:
                c = t.count(e)
                if c:
                    vocab[f"emoji:{e}"] += c
                    hit = True
            if hit:
                with_status += 1
                # candidate place tokens: words adjacent to status mentions
                for tok in nt.split():
                    if len(tok) >= 3 and tok not in STOP and not tok.isdigit():
                        if tok.replace(" ", "") not in kb_names and not any(norm(w) == tok for ws in STATUS_FAMILIES.values() for w in ws):
                            cand[tok] += 1
        top_vocab = ", ".join(f"{k}×{v}" for k, v in vocab.most_common(6))
        print(f"{f.stem:<26} {len(msgs):>6} {days:>5} {len(msgs)/days:>6.1f} {with_status/len(msgs)*100:>7.0f}%  {top_vocab}")
        for tok, c in cand.items():
            if c >= 10:
                grand_candidates[tok] += c

    print("\n== checkpoint-name candidates NOT in KB (≥25 status-adjacent mentions across corpus) ==")
    for tok, c in grand_candidates.most_common(60):
        if c >= 25:
            print(f"  {c:>5}  {tok}")


if __name__ == "__main__":
    main()
