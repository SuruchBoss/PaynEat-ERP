# `ee/` — Enterprise edition · รุ่น Enterprise

Code in this directory is **source-available under the [Elastic License 2.0](LICENSE)**, not Apache 2.0.
Everything outside it is Apache 2.0 ([`../LICENSE`](../LICENSE)). Why there are two editions, and what may
and may never be Enterprise, is [ADR-0015](../docs/adr/0015-editions-community-and-enterprise.md).

**v1 is entirely Community: this directory holds only its license until the product owner publishes an
Enterprise issue.** When code arrives:

- the Community core never imports from `ee/`; `npm run check:architecture` fails if it does, and the core
  must build and run with this directory deleted;
- every file here starts with `SPDX-License-Identifier: Elastic-2.0`, which `scripts/license-headers.mjs`
  enforces;
- food safety, data integrity, basic security, data export and the upgrade path never move here.

โค้ดในไดเรกทอรีนี้**เปิดให้อ่านได้ภายใต้ [Elastic License 2.0](LICENSE)** ไม่ใช่ Apache 2.0 ส่วนนอกไดเรกทอรีนี้
เป็น Apache 2.0 ทั้งหมด เหตุผลของการมีสองรุ่นอยู่ใน [ADR-0015](../docs/adr/0015-editions-community-and-enterprise.th.md)
**v1 เป็น Community ทั้งหมด ไดเรกทอรีนี้จึงมีแค่ไฟล์ license จนกว่า PO จะออก issue ของ Enterprise** เมื่อมีโค้ด:
แกนหลักห้าม import จาก `ee/` (ด่าน architecture จับ) ทุกไฟล์ขึ้นต้นด้วย `SPDX-License-Identifier: Elastic-2.0`
และความปลอดภัยอาหาร ความถูกต้องของข้อมูล ความปลอดภัยพื้นฐาน การ export ข้อมูล และการอัปเกรด ไม่มีวันย้ายมาที่นี่
