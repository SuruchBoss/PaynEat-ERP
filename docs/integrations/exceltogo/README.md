# ExcelToGo integration — draft import templates

**Draft 0 — a design sample, not a contract** (ADR-0016). The template format becomes fixed only when the
ERP ticket that builds the importer is written. · ฉบับร่าง 0 ใช้ออกแบบร่วมกับ ExcelToGo ยังไม่ใช่สัญญา

| File | What it is |
|---|---|
| `sample-import-template.xlsx` | Items, locations and opening balances for the fictional fried-chicken chain. Lists come from the hidden, locked `Ref` sheet (`Ref!$A$2:$A$9` units, `$B` location codes, `$C` item codes), as the ERP would generate it. |
| `sample-import-template-large.xlsx` | The same layout with 3,000 item codes in `Ref` and 3,000 opening-balance rows that each carry a cross-sheet list rule. For measuring size and round-trip behaviour; the `SYN-` codes are synthetic. |
| `make_sample_templates.py` | Regenerates both files (`openpyxl` 3.1.5). |

What a correct round-trip keeps: the cross-sheet list references as references (not a frozen list), the
`Ref` sheet hidden and protected, the data sheets protected with only the input cells unlocked, and the
other rules (`whole`, `decimal`, `textLength`, `date`).

**Input rows are part of the template's contract.** Draft 0 unlocks and validates rows 2–200 of `Items`,
rows 2–50 of `Locations`, and rows 2 to `max(200, pre-filled rows + 1)` of `OpeningBalance`. The importer
ticket will fix the rule the ERP generates templates by (likely: pre-filled rows plus a stated number of
blank rows), and a consumer can test that every unlocked, validated row survives a round-trip.

Date rules use an Excel date serial (`43831` = 2020-01-01), the form Excel itself writes, rather than a
`DATE(...)` formula that some libraries cannot read.

**Measured by ExcelToGo on draft 0 (2026-09-26):** the small file opens, saves and exports; the large one
does not yet, because cross-sheet list rules are currently copied into every cell. The fixes are on
ExcelToGo's side and are tracked there (`docs/payneat-erp.md` in that repository); the layout itself needs
no change.
