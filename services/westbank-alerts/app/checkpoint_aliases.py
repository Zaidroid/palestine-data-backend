"""
Checkpoint alias table — maps variant canonical_keys to the preferred form.

Built from audit of checkpoint_directory.json. When the parser normalizes a
checkpoint name, it checks this table last to merge known spelling variants.
"""

# Maps variant key → preferred key
# All keys must already be in _normalise() form (ة→ه, أ→ا, etc.) with _ separators
CHECKPOINT_ALIASES: dict[str, str] = {
    # عين سينيا variants
    "عين_سنيا":            "عين_سينيا",
    "عين_سينا":            "عين_سينيا",

    # المربعه variants
    "المربع":              "المربعه",

    # Spelling variants — single words
    "الكونتينر":           "الكنتينر",
    "حوميش":               "حومش",
    "مرردا":               "مردا",
    "دوار_تقوع":           "دوار_طقوع",
    "فرش_الهوا":           "فرش_الهوي",
    "عيون_الحرميه":        "عيون_الحراميه",
    "عش_الغراب":           "عش_غراب",
    "ديرشرف":              "دير_شرف",
    "شقبا_شبتبن":          "شقبا_شبتين",
    "شيلو_وعيلي":          "شيلو_عيلي",

    # العيزرية — extremely common misspelling (dropped ي)
    "العزريه":             "العيزريه",
    "العزريه_لداخل":       "العيزريه",
    "العزريه_لخارج":       "العيزريه",
    "عزريه":               "العيزريه",

    # يتسهار — common letter transposition (يتهسار / يتسهار)
    "يتهسار":              "يتسهار",
    "طريق_يتهسار":         "يتسهار",
    "خط_يتهسار":           "يتسهار",
    "طريق_يتسهار":         "يتسهار",
    "خط_يتسهار":           "يتسهار",

    # Shorthand / colloquial variants
    "الكنتنر":             "الكنتينر",
    "الكونتنر":            "الكنتينر",
    "حواره":               "حواره",   # identity — ensure consistent
    "حوارا":               "حواره",
    "بيت_فورك":            "بيت_فوريك",
    "بيتفوريك":            "بيت_فوريك",
    "دير_استيا":           "ديرستيا",
    "ديراستيا":            "ديرستيا",
    "عين_شبليه":           "عين_شبلي",
    "عيون_الحرامي":        "عيون_الحراميه",
    "صره_بحري":            "صره",    # صره بحري = north Surra, same checkpoint
    "راس_الجوره":          "راس_الجوره",
    "راس_جوره":            "راس_الجوره",
    "الجوره":              "راس_الجوره",
    "مراح_رياح":           "مراح_رباح",
    "مراح_الرباح":         "مراح_رباح",
    "الظاهريه":            "الظاهريه_ابو_العرقان",  # default to main Dhahiriya
    "ترقوميا":             "ترقوميا_المصانع",
    "بيت_كاحل":            "جسر_بيت_كاحل",
    "السموع":              "السموع_السيميا",
    "المسمد":              "مسمد",
}
