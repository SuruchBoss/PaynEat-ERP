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
| Location code | รหัสสถานที่ | The ecosystem-wide identifier of a location: uppercase letters, digits and hyphens, 2–32 characters (`^[A-Z0-9][A-Z0-9-]{1,31}$`). It can be corrected **until the location is first used**; each system defines its own first-use events (ERP: a posted document or a POS master-data pull; Cwork: a punch, a shift assignment or an export, per Cwork ADR-0006). After that it is fixed, and a wrong code is replaced by creating a new location and deactivating the old one with a *superseded by* link. The same site has the same code in the ERP, in PaynEat POS and as a Cwork work location (ADR-0011). |
| Plant | โรงงาน | Location type: the company's own processing plant or central kitchen (called โรงงาน in Thai text either way). Receives from suppliers, produces, ships to branches. |
| Warehouse | คลัง | Location type: storage that neither produces nor sells. |
| Branch | สาขา | Location type: a restaurant that sells to guests through a POS. The ERP is the system of record for branches. |
| In-transit | ระหว่างขนส่ง | Location type, system-managed: stock that has left its origin and has not yet been received at its destination. Every plant and warehouse gets one when it is created; its code is `IN-TRANSIT:` followed by its origin's code, a shape no person can type, and it follows its origin's code, names and active flag. Nobody edits it directly. |
| First use | การใช้งานครั้งแรก | The event that fixes a location code: in the ERP, the first posted document that names the location, or the first POS pull of a branch. The ERP records when and what it was. |
| Superseded by | แทนที่ด้วย | The link from a location whose wrong code was already in use to the new location, of the same type, that replaces it. The old one is deactivated and stays out of use; a POS receives the link. |
| Subcontractor | โรงงานรับจ้าง | Location type, **reserved, not built in v1**: a third party that processes our stock for a fee. |

## Items and units · สินค้าและหน่วยนับ

| Term | ไทย | Meaning |
|---|---|---|
| Item | รายการสินค้า | Anything the company stocks: raw material, intermediate, or finished portion. |
| Item code | รหัสสินค้า | The identifier of an item, in the same shape as a location code: uppercase letters, digits and hyphens, 2–32 characters. **Fixed once the item exists**: a POS mirrors items by it. A wrong code is replaced by creating a new item and deactivating the old one. |
| Deactivated item | สินค้าที่ปิดใช้งาน | An item no longer offered for new documents. It keeps its history and can be reactivated; **items are never deleted**. |
| Unit | หน่วยนับ | A unit of measure from the catalogue every installation ships with (kilogram, piece, case…). Each keeps its quantities to a fixed number of decimals: 3 for kg (grams), 0 for pieces and cases. |
| Base unit | หน่วยหลัก | The single unit an item is **valued and balanced** in (e.g. kg for whole chicken, piece for a drumstick). |
| Purchase unit | หน่วยซื้อ | A unit a supplier sells in, with a fixed conversion to the base unit (e.g. case = 10 kg). |
| Conversion factor | ตัวคูณแปลงหน่วย | How many base units one purchase unit holds (case → 20 kg: factor 20). An exact decimal, **always greater than zero**, at most 6 decimals. Converting rounds once, half away from zero, to the base unit's decimals (ADR-0019). |
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
| Business time | เวลาที่เกิดรายการ | When a movement actually happened: a document's business date, or a sale's sale time. Stock as of a date, counts and period close all use it (ADR-0018). |
| Posting time | เวลาที่ post | When the ERP wrote a ledger entry. Kept alongside business time on every entry; never used to decide which period an entry belongs to. |
| Period close | ปิดงวด | A per-location date before which nothing may be posted. |
| Closed-until date | วันที่ปิดงวดถึง | A location's period close: no entry with a business date on or before it can be posted there. Moves forward by closing, backward only by an audited reopen (ADR-0018). |
| Reopen | เปิดงวดใหม่ | An `admin` moving a closed-until date backward, with a reason, audited. Supersedes any export of the reopened range. |
| Late for a closed period | มาช้าสำหรับงวดที่ปิดแล้ว | Branch consumption from a sale whose time falls in a closed period, posted on the first open day and marked, keeping its original sale time (ADR-0018). |
| Supplier | ซัพพลายเออร์ | A company the chain buys from. Owned by the ERP, never sent to a POS. Managed by `admin` and `purchasing`. |
| Tax identification number | เลขประจำตัวผู้เสียภาษีอากร | The 13-digit Thai number of a company or a person, the last digit a check over the other twelve. Printed as 0-0000-00000-00-0. |
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
| Count time | เวลาตรวจนับ | The moment a stock count is compared at: its book quantities are balances as of that business time (ADR-0017). |
| Book quantity | ยอดตามระบบ | The balance the ledger holds for a count line as of the count time. Hidden from the counter until the count is submitted (blind count). |
| Blind count | การนับแบบไม่เห็นยอด | Counting without seeing the book quantity, so the count is not steered towards it (ADR-0017). |
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
| Forward trace | การย้อนรอยไปข้างหน้า | From a supplier lot to every production order, output lot, transfer, branch and consumption it reached. |
| Backward trace | การย้อนรอยย้อนกลับ | From a sale at a branch to the candidate branch lots and, through transfers and genealogy, to the supplier lots they came from. |
| Certain / inferred link | ความเชื่อมโยงที่แน่นอน / ที่อนุมาน | A trace step backed by a posted document (receipt, genealogy, transfer) is certain; a step from branch FEFO allocation is inferred. Every trace labels each step as one or the other (ADR-0006). |

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
| Supplier invoice | ใบแจ้งหนี้ซัพพลายเออร์ | The supplier's bill for goods received, recorded to match against its purchase order and goods receipts. Writes no stock and does not revalue lots in v1 (ADR-0004). |
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
| Period export | ไฟล์ export รายงวด | A file of stock value and movement value by location for a closed date range, for the accounting software (story 36, ADR-0018). |
| Export revision | ฉบับแก้ไขของไฟล์ export | A re-export of a range after it was reopened; names the revision it replaces, which is marked superseded (ADR-0018). |
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
| Master data version | เวอร์ชัน master data | A company-wide number that strictly increases, with no gaps, by one for every create or update of master data. A POS instance uses it to pull only what changed. |
| Master data change | รายการเปลี่ยนแปลง master data | One entry of the append-only change log: its version, the record's type, id and code, created or updated, and the whole record as it stood after the change. A POS instance replays them in version order. |

## Analysis · การวิเคราะห์

| Term | ไทย | Meaning |
|---|---|---|
| Variance investigator | ตัวสืบสวนส่วนต่าง | **Future (after v1).** An AI analyst that explains business variances (yield, usage, cost, temperature) with ranked, evidence-citing hypotheses, using read-only ERP operations only (ADR-0011). |
| Hypothesis | สมมติฐาน | A candidate explanation, ranked, that must cite the evidence supporting it. Never presented as a fact. |

## Access · สิทธิ์การใช้งาน

| Term | ไทย | Meaning |
|---|---|---|
| User | ผู้ใช้ | A person who signs in to the ERP, identified by an email. Never deleted, only disabled, so the audit trail always names who acted. |
| Role | บทบาท | `admin`, `purchasing`, `purchasing_approver`, `plant`, `logistics`, `branch_manager`, `finance`. A user may hold several. |
| Permission | สิทธิ์ | One thing the API allows, named `<resource>:<action>` (e.g. `user:manage`). A role is a fixed bundle of permissions; endpoints declare the permissions they need. |
| Second factor | การยืนยันตัวตนขั้นที่สอง | A time-based code from an authenticator app (TOTP), asked for after the password. Required for every account holding `admin`. |
| Recovery code | รหัสกู้คืน | A single-use code that works in place of the second factor when the phone is lost. Shown once, stored only as a digest. |
| Audit trail | บันทึกการตรวจสอบ | The append-only record of who did what and when — user and role changes, sign-ins and refused sign-ins — each with the request's correlation id. Never updated or deleted. |
| Demo account | บัญชีเดโม | A user the demo seed creates with a published password (and, for `admin`, a published second-factor secret), marked as a demo account by the seed — never recognised by its email. Signs in only on a demo installation. Evaluation only. |
| Installable console | console ที่ติดตั้งลงเครื่องได้ | The web console installed from the browser as a Progressive Web App on a phone, tablet or PC. Caches only the application shell, never data (ADR-0020). |
| First-run setup | การตั้งค่าครั้งแรก | The console's guided setup on an empty database: company, first admin with a second factor, first locations. No command line (ADR-0020, post-v1). |
| PaynEat Cloud | PaynEat Cloud | The paid hosting service that runs the same Community software for a chain (ADR-0015, ADR-0020). A chain can always export and move to its own server. |
| Demo installation | ระบบเดโม | An installation started with `ERP_DEMO=1`: the only kind where the demo seed runs and demo accounts sign in. Says so in the log at every start and on every console screen. Without the flag, a production API refuses to start while a demo account is enabled. |
| Approval threshold | เกณฑ์วงเงินที่ต้องอนุมัติ | The document value above which a second person must approve. Configuration, not code. |
| Segregation of duties | การแยกหน้าที่ | Nobody approves a document they created, whatever roles they hold. |

## Editions · รุ่นของระบบ

| Term | ไทย | Meaning |
|---|---|---|
| Community edition | รุ่น Community | The free Apache 2.0 edition: everything outside `ee/`. Complete for one chain; never limited by users, locations or data (ADR-0015). |
| Enterprise edition | รุ่น Enterprise | The paid edition: Community plus the modules in `ee/`, activated by a license key (ADR-0015). |
| License key | license key | A signed key verified offline that turns on Enterprise modules. When it expires, Enterprise screens become read-only; core work and data access never stop. |
| Active location | สถานที่ที่ใช้งาน | A plant, warehouse or branch with postings in the billing month; the unit Enterprise is priced by. |
