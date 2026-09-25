# Domain glossary · อภิธานศัพท์โดเมน

The vocabulary every spec, ticket, ADR, identifier and UI label in this repository uses.
If a word here and a word in code disagree, one of them is a bug. Add a term here **before**
using a new domain concept anywhere else.

ศัพท์ชุดเดียวที่ทุกสเปก ทิกเก็ต ADR ชื่อในโค้ด และข้อความบนหน้าจอใช้ร่วมกัน ถ้าคำในไฟล์นี้กับคำในโค้ด
ไม่ตรงกัน แปลว่าฝั่งใดฝั่งหนึ่งมีบั๊ก — เพิ่มศัพท์ที่นี่**ก่อน**ใช้แนวคิดโดเมนใหม่ที่อื่นเสมอ

## Organisation · โครงสร้างองค์กร

| Term | ไทย | Meaning |
|---|---|---|
| Company | บริษัท | The restaurant chain that owns one installation. One installation serves exactly one company. |
| Location | สถานที่เก็บสต๊อก | Anywhere stock can physically be. Every stock movement names a location. Has a **type**. |
| Location code | รหัสสถานที่ | The ecosystem-wide identifier of a location: uppercase letters, digits and hyphens, 2–32 characters (`^[A-Z0-9][A-Z0-9-]{1,31}$`). It can be corrected **until the location is first used** (a posted document, a POS master-data pull, or a mapping in another system); after that it is fixed, and a wrong code is replaced by creating a new location and deactivating the old one with a *superseded by* link. The same site has the same code in the ERP, in PaynEat POS and as a Cwork work location (ADR-0011). |
| Plant | โรงงาน | Location type: the company's own processing plant or central kitchen (called โรงงาน in Thai text either way). Receives from suppliers, produces, ships to branches. |
| Warehouse | คลัง | Location type: storage that neither produces nor sells. |
| Branch | สาขา | Location type: a restaurant that sells to guests through a POS. The ERP is the system of record for branches. |
| In-transit | ระหว่างขนส่ง | Location type, system-managed: stock that has left its origin and has not yet been received at its destination. |
| Subcontractor | โรงงานรับจ้าง | Location type, **reserved, not built in v1**: a third party that processes our stock for a fee. |

## Items and units · สินค้าและหน่วยนับ

| Term | ไทย | Meaning |
|---|---|---|
| Item | รายการสินค้า | Anything the company stocks: raw material, intermediate, or finished portion. |
| Base unit | หน่วยหลัก | The single unit an item is **valued and balanced** in (e.g. kg for whole chicken, piece for a drumstick). |
| Purchase unit | หน่วยซื้อ | A unit a supplier sells in, with a fixed conversion to the base unit (e.g. case = 10 kg). |
| Variable-weight item | รายการน้ำหนักแปรผัน | An item whose pieces differ in weight (whole birds, fish, primal cuts). Movements record both weight and count. |
| Secondary quantity | จำนวนหน่วยที่สอง | The count recorded alongside the base-unit weight for a variable-weight item (e.g. 12 birds = 21.6 kg). Informational for planning; never used for valuation. |
| Shelf life | อายุการเก็บ | Days an item stays usable from receipt or production. Determines a lot's expiry date. |

## Stock and documents · สต๊อกและเอกสาร

| Term | ไทย | Meaning |
|---|---|---|
| Stock ledger | บัญชีเคลื่อนไหวสต๊อก | The append-only table of every stock movement. The only source of truth for balances. |
| Ledger entry | รายการเคลื่อนไหว | One row: item, lot, location, signed quantity, (secondary quantity), cost, source document. Never updated or deleted. |
| Balance | ยอดคงเหลือ | Derived from ledger entries. May be cached as a snapshot for speed; the ledger wins on any disagreement. |
| Document | เอกสาร | A business record that, once **posted**, writes ledger entries. Examples below. |
| Draft | ร่าง | A document not yet posted. Freely editable; affects nothing. |
| Post | post (ลงรายการ) | The irreversible act that turns a draft into ledger entries, atomically. Written as "post" in Thai text too, because ลงบัญชี would be confused with accounting entries, which this system does not make. |
| Reversal | เอกสารกลับรายการ | A new document that exactly negates a posted one. The only way to correct a posting. |
| Period close | ปิดงวด | A per-location date before which nothing may be posted. |
| Supplier | ซัพพลายเออร์ | A company the chain buys from. Owned by the ERP. |
| Purchase order (PO) | ใบสั่งซื้อ | Commitment to buy from a supplier. Writes no stock. |
| Goods receipt (GRN) | ใบรับสินค้า | Receiving supplier goods into a location, creating lots. |
| Return to supplier | ใบส่งคืนสินค้า | Sending rejected or defective goods back to a supplier. |
| Production order | ใบสั่งผลิต | Consumes input lots and produces output lots at a plant. |
| Requisition | ใบขอเบิก | A branch's request for stock from a plant or warehouse. Writes no stock. |
| Transfer | ใบโอน | Moves stock between locations via in-transit: **dispatch** at the origin, **receipt** at the destination. |
| Dispatch | ส่งของ (dispatch) | The origin side of a transfer: confirms the lots and quantities that left, moving them to in-transit. Never ส่งออก, which means export. |
| Transfer receipt | การรับโอน | The destination side of a transfer: records what arrived, with inspection. |
| Issue | การเบิกจ่าย | Taking stock out of a location for use (for example into a production order). |
| Write-off | ตัดจำหน่าย | An adjustment that removes stock that is expired, damaged or lost, with a reason and an approver. |
| Stock count | ใบตรวจนับ (เอกสาร) / การตรวจนับสต๊อก (กิจกรรม) | A physical count of a location, compared to the balance. |
| Adjustment | ใบปรับยอด | Posts the difference between counted and recorded stock, or writes off waste, with a reason and an approver. |
| Opening balance | ยอดยกมา | The adjustment used once to bring existing stock into the system at go-live. |

## Lots and traceability · lot และการย้อนรอย

| Term | ไทย | Meaning |
|---|---|---|
| Lot | lot | A quantity of one item that shares an origin, a cost and an expiry date. Created by a receipt or a production output. |
| Expiry date | วันหมดอายุ | Receipt or production date plus shelf life. An expired lot cannot be issued or transferred. |
| FEFO | FEFO (หมดอายุก่อนออกก่อน) | First Expired, First Out: the rule that picks which lot a consumption comes from. |
| Lot genealogy | ผังความสัมพันธ์ lot | The recorded links from each production output lot back to the input lots it consumed. |
| Candidate lots | lot ที่เป็นไปได้ | In a recall: every lot that **could** have been in use at a branch during a time window. The ERP never claims a single lot it cannot know. |
| Recall report | รายงาน recall | Traces forwards (supplier lot → where it went) or backwards (a sale → candidate supplier lots). |

## Production and cost · การผลิตและต้นทุน

| Term | ไทย | Meaning |
|---|---|---|
| Production BOM | สูตรการผลิต | For a plant: which inputs make which outputs, the expected yield, and the cost allocation ratios. |
| Menu recipe | สูตรเมนู | For a branch: which items one menu item consumes. Versioned with an effective date. |
| Modifier recipe | สูตรของตัวเลือกเสริม | The ingredient deltas a POS modifier adds or removes. Versioned like menu recipes. |
| Yield | อัตราผลได้ | Output weight ÷ input weight of a production order. Expected yield lives on the BOM; actual yield is measured. |
| Co-product | ผลิตภัณฑ์ร่วม | One of several saleable outputs of the same input (e.g. drumstick, thigh, breast from one bird). |
| By-product | ผลิตภัณฑ์พลอยได้ | A low-value output (e.g. frames for stock). |
| Waste | ของเสีย | Input that becomes no output. |
| Allocation ratio | สัดส่วนปันต้นทุน | The share of input cost assigned to each output on a production BOM. Defaults to share of weight. |
| Lot cost | ต้นทุนราย lot | The actual unit cost carried by a lot. Consumption takes the cost of the lot FEFO picks. |
| Standard cost | ต้นทุนมาตรฐาน | A predetermined cost per item with variances reported against it. **Not used in v1** (ADR-0004). |
| Three-way match | การจับคู่สามทาง (3-way match) | Checking a supplier invoice against its purchase order and goods receipt. Stretch goal for v1. |
| Theoretical usage | การใช้ตามทฤษฎี | What sales say should have been consumed, via recipes in effect at the time of sale. |
| Actual usage | การใช้จริง | What the ledger and stock counts say was consumed. |

## Planning · การวางแผน

| Term | ไทย | Meaning |
|---|---|---|
| Par level | ระดับสต๊อกมาตรฐาน | The stock a branch should hold of an item; the basis for suggested requisition quantities. |
| Reorder point | จุดสั่งซื้อ | The balance at which a plant or warehouse should reorder from a supplier. |
| MRP-lite | MRP-lite | Consolidates open requisitions into suggested production orders and suggested purchase orders. Suggestions only; a person creates the documents. |

## Receiving and inspection · การตรวจรับ

| Term | ไทย | Meaning |
|---|---|---|
| Inspection | การตรวจรับ | Recorded at a GRN or transfer receipt: counted quantity, temperature, condition, expiry. |
| Cold chain | ห่วงโซ่ความเย็น | Keeping chilled or frozen goods within temperature from supplier to branch; evidenced by receiving temperatures. |
| Tolerance | ค่าที่ยอมรับได้ | Per-item limits (quantity variance %, maximum receiving temperature). Beyond it, a reason and an approval are required. |
| Variance | ส่วนต่าง | Difference between expected and actual (quantity received, stock counted, yield achieved). Never silently absorbed. |

## Integration · การเชื่อมระบบ

| Term | ไทย | Meaning |
|---|---|---|
| Export | export (ส่งออกข้อมูล) | Producing a file of figures for another system, such as accounting software. Not to be confused with dispatch. |
| System of record | ระบบที่เป็นเจ้าของข้อมูล | The one system allowed to create and change a kind of data. The other only mirrors it. |
| POS instance | POS instance | One installation of PaynEat POS registered with the ERP. May serve one branch or several. |
| Connected mode | โหมดเชื่อมต่อ ERP | A POS instance registered with the ERP. Master data becomes read-only on the POS. |
| Standalone mode | โหมดใช้งานเดี่ยว | A POS instance with no ERP. Everything works as it does today. |
| Sales event | event ยอดขาย | A POS sale line sent to the ERP: menu item, quantity or weighed weight, modifiers, time. |
| Outbox | outbox | A table written in the same transaction as the business change, drained to the other system afterwards. |
| Idempotency key | idempotency key | A unique key per event so a retried delivery is applied once. |
| Correlation id | correlation id | An id carried in every log line and event of one business flow across systems (a sale's idempotency key, a document number), so an investigator can follow it end to end. |
| Integration token | token ของการเชื่อมต่อ | An API token that belongs to an integration, not a person, and carries explicit scopes; it can never post or approve (ADR-0013). |
| Webhook | webhook | An event the ERP sends to an add-on's URL from the outbox: signed, retried, with an idempotency key (ADR-0013). |
| Add-on | ส่วนเสริม | A separate service that extends the ERP through the public API and webhooks; never code loaded into the ERP (ADR-0013). |
| Master data version | เวอร์ชัน master data | A monotonically increasing number a POS instance uses to pull only what changed. |

## Analysis · การวิเคราะห์

| Term | ไทย | Meaning |
|---|---|---|
| Variance investigator | ตัวสืบสวนส่วนต่าง | **Future (after v1).** An AI analyst that explains business variances (yield, usage, cost, temperature) with ranked, evidence-citing hypotheses, using read-only ERP operations only (ADR-0011). |
| Hypothesis | สมมติฐาน | A candidate explanation, ranked, that must cite the evidence supporting it. Never presented as a fact. |

## Access · สิทธิ์การใช้งาน

| Term | ไทย | Meaning |
|---|---|---|
| Role | บทบาท | `admin`, `purchasing`, `purchasing_approver`, `plant`, `logistics`, `branch_manager`, `finance`. A user may hold several. |
| Approval threshold | เกณฑ์วงเงินที่ต้องอนุมัติ | The document value above which a second person must approve. Configuration, not code. |
| Segregation of duties | การแยกหน้าที่ | Nobody approves a document they created, whatever roles they hold. |
