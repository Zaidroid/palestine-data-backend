# Invoice template (P5 step 3) — copy per customer into ~/lifeos/drafts/ on main

⟨FILL⟩ items only Zaid can supply. **Hard gate: register as licensed operator
(مشتغل مرخص) BEFORE sending the first real invoice** (Decision Log 2026-07-06).

---

**INVOICE**

| | |
|---|---|
| Invoice no. | PDB-2026-⟨001⟩ |
| Date | ⟨date⟩ |
| From | Zaid Salem — Palestine Data Platform · Ramallah, Palestine · licensed operator no. ⟨FILL after registration⟩ · zaidsalem@live.com |
| Bill to | ⟨Organization, contact name, address, VAT/tax ID if given⟩ |
| Terms | Net 30 · quarterly billing |

| Description | Period | Amount (USD) |
|---|---|---|
| Palestine Data Platform — ⟨Organization tier⟩ API subscription (founding rate) | ⟨Q3 2026: Jul 1 – Sep 30⟩ | ⟨$297 = 3 × $99⟩ |
| ⟨Optional: Real-time alerts add-on⟩ | ⟨same⟩ | ⟨$300 = 3 × $100⟩ |
| **Total due** | | **⟨$297⟩** |

**Payment — USD wire (SWIFT):**
Beneficiary: ⟨name as on account⟩ · Bank: ⟨Bank of Palestine / Arab Bank branch⟩ ·
IBAN: ⟨FILL⟩ · SWIFT/BIC: ⟨FILL⟩ · Reference: invoice number.
Please instruct your bank to charge sender fees "OUR" so the amount arrives in full.

**Alternative — USDT (TRC-20/ERC-20):** wallet ⟨FILL⟩ · same reference. A crypto
invoice via Request Finance is available on request.

Includes: tier terms as published at api.zaidlab.xyz/pricing.html — full-granularity
API access, priority rate limits, email support. Public data access remains free
for everyone; thank you for funding the infrastructure that keeps it that way.

---

**Issuance checklist (any model, 5 min per customer):**
1. Copy this file → fill ⟨⟩ → save as `~/lifeos/drafts/invoice-PDB-2026-NNN-<org>.md` on main.
2. Issue the key: `docker exec palestine-data-api node scripts/manage-keys.js issue <email> <tier>`.
3. Email invoice + key + QUICKSTART link. Zaid sends.
4. Log: `client | pdb key issued: <org> <tier>` and, when paid, `win | $<amount> — <org> (PDB)`.
