# Architecture decision records · บันทึกการตัดสินใจเชิงสถาปัตยกรรม

Every domain or architecture decision is recorded here in English and Thai. Accepted ADRs are not
edited to change their meaning; a new ADR supersedes them.

ทุกการตัดสินใจเชิงโดเมนหรือสถาปัตยกรรมบันทึกไว้ที่นี่ทั้งภาษาอังกฤษและไทย ADR ที่ยอมรับแล้วจะไม่ถูกแก้ให้
ความหมายเปลี่ยน ถ้าจะเปลี่ยนต้องออก ADR ใหม่มาแทน

| # | Title | ไทย | Status |
|---|---|---|---|
| 0001 | [Product scope](0001-product-scope.md) | [ขอบเขตผลิตภัณฑ์](0001-product-scope.th.md) | Accepted |
| 0002 | [System boundaries and POS integration](0002-system-boundaries-and-pos-integration.md) | [ขอบเขตระบบและการเชื่อมต่อ POS](0002-system-boundaries-and-pos-integration.th.md) | Accepted |
| 0003 | [Append-only stock ledger](0003-append-only-stock-ledger.md) | [บัญชีเคลื่อนไหวสต๊อกแบบ append-only](0003-append-only-stock-ledger.th.md) | Accepted |
| 0004 | [Lot costing and cost allocation](0004-lot-costing-and-cost-allocation.md) | [ต้นทุนราย lot และการปันต้นทุน](0004-lot-costing-and-cost-allocation.th.md) | Accepted |
| 0005 | [Units and variable-weight items](0005-units-and-variable-weight-items.md) | [หน่วยนับและรายการน้ำหนักแปรผัน](0005-units-and-variable-weight-items.th.md) | Accepted |
| 0006 | [Lots, expiry and traceability](0006-lots-expiry-and-traceability.md) | [lot วันหมดอายุ และการย้อนรอย](0006-lots-expiry-and-traceability.th.md) | Accepted |
| 0007 | [Receiving, inspection and transfers](0007-receiving-inspection-and-transfers.md) | [การรับสินค้า การตรวจรับ และการโอน](0007-receiving-inspection-and-transfers.th.md) | Accepted |
| 0008 | [Roles and segregation of duties](0008-roles-and-segregation-of-duties.md) | [บทบาทและการแยกหน้าที่](0008-roles-and-segregation-of-duties.th.md) | Accepted |
| 0009 | [Replenishment planning v1](0009-replenishment-planning-v1.md) | [การวางแผนเติมสต๊อก v1](0009-replenishment-planning-v1.th.md) | Accepted |
| 0010 | Backend stack | — | **Pending** — awaiting a decision on aligning with Cwork's stack |

## Template

```markdown
# ADR-NNNN: <title>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **ภาษาไทย:** [NNNN-slug.th.md](NNNN-slug.th.md)

## Context
## Decision
## Consequences
## Alternatives considered
```
