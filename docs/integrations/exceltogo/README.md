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
