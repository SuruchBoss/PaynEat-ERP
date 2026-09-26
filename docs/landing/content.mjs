// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0
//
// The landing page's copy, in English and Thai (#45). build.mjs draws the page and the README
// section "The problems it solves today" from this one file, so the three never drift.
//
// Rules for this copy:
// - Every claim is true of `main` today. What is planned says so and names its issue.
// - Every "try it" step works on the public demo, with the console's own button names.
// - No real company, brand or person. The demo chain is fictional; no credential beyond the
//   published demo ones.
// - Thai terms come from docs/GLOSSARY.md.

export const SITE = 'https://suruchboss.github.io/PaynEat-ERP/';
export const REPO = 'https://github.com/SuruchBoss/PaynEat-ERP';
const issue = (n) => `${REPO}/issues/${n}`;

export const en = {
  code: 'en',
  file: 'index.html',
  readme: 'README.md',
  title: 'PaynEat ERP — from supplier to plate, every lot accounted for',
  description:
    'The open-source back office for restaurant chains that run their own supply chain: a stock ledger nothing can change, one set of master data for every branch and system, and access you can audit. Try it in your browser.',
  nav: {
    label: 'Main',
    links: [
      ['#problems', 'Problems'],
      ['#next', 'Roadmap'],
      ['#open', 'Open source'],
    ],
    other: ['index.th.html', 'ไทย', 'th'],
    cta: 'Try the demo',
  },
  hero: {
    eyebrow: 'PaynEat ERP · open source',
    title: 'From supplier to plate.',
    accent: 'Every lot accounted for.',
    lead: 'The back office for restaurant chains that run their own supply chain — built in public, starting with what everything else depends on: stock numbers you can trust.',
    cta: 'Try the demo',
    cta2: 'View the code',
    status:
      'Walking skeleton: the stock ledger, master data and access control work today. Purchasing, production and transfers are next.',
    shot: ['stock-dark', 'desktop', 'Stock on hand in dark mode: five lots at the Bang Na plant with unit cost and value'],
  },
  problemsHead: {
    kicker: 'Why PaynEat ERP',
    title: 'Built for the problems a growing chain actually has.',
    sub: 'Every answer below works today, on the public demo. Every picture is the real console, on the fictional chain’s data.',
  },
  labels: { problem: 'The problem', try: 'Try it', open: 'Open the demo', planned: 'Planned', progress: 'In progress' },
  problems: [
    {
      id: 'trust',
      kicker: 'Stock ledger',
      title: 'Stock numbers everyone believes.',
      pain: 'Spreadsheets get overwritten, the plant and the branches never agree, and nobody can say what the stock was last Tuesday.',
      body: 'Every movement is a ledger entry that nothing can change — the database itself refuses. A mistake is corrected by a reversal that stays next to the original. Stock on hand is read as of any business date, with the cost and value of every lot, in exact decimals.',
      points: [
        ['Append-only', 'Ledger entries are never updated or deleted.'],
        ['As of any date', 'Counted by when a movement happened, not when it was typed.'],
        ['Exact', 'Decimals, never floating point: 22,716.7 baht means 22,716.7.'],
      ],
      shots: [['stock', 'desktop', 'Stock on hand by item, lot and location, with unit cost, value and expiry']],
      try: 'Open “Stock on hand” and set “As of” to two days ago.',
    },
    {
      id: 'golive',
      kicker: 'Opening balances',
      title: 'Go live without the spreadsheet chaos.',
      pain: 'The first day on a new system is when bad data gets in: half a drumstick, a lot that has already expired, a number typed twice.',
      body: 'An opening balance is a draft until you post it, and it is checked line by line first. Posting turns every line into a lot in one transaction — or nothing at all. A posted document is final; a reversal, with its reason, is the only way back.',
      points: [
        ['Checked per line', 'Pieces have no decimals; an expired lot is refused.'],
        ['All or nothing', 'Every line becomes a lot in one transaction.'],
        ['Traceable from day one', 'OB-2026-00002, and its lots /1, /2.'],
      ],
      shots: [
        ['opening-refused', 'desktop', 'A new opening balance refused because 2.5 pieces has more decimals than the unit keeps'],
        ['opening-reversed', 'desktop', 'A posted opening balance reversed by RV-2026-00001, with the reason kept'],
      ],
      try: 'Sign in as plant, press “New opening balance” and enter 2.5 drumsticks.',
    },
    {
      id: 'master',
      kicker: 'Master data',
      title: 'One set of master data. Every branch, every system.',
      pain: 'Each branch names the same chicken differently, suppliers sell by the bag, the kitchen counts by the piece, and the POS keeps its own list.',
      body: 'An item has one base unit and exact purchase units — 1 bag = 25 kilograms — and a whole chicken is kept by weight and by the bird. Location codes are shared with PaynEat POS and Cwork and fixed once used; every change is a numbered master data version a POS pulls. A supplier’s tax ID is checked by its check digit.',
      points: [
        ['Units that convert exactly', 'A factor is always above zero; a base unit never changes.'],
        ['Versioned for the POS', 'Every change is the next version, in order, with no gaps.'],
        ['Caught at entry', 'A mistyped Thai tax ID fails its check digit.'],
      ],
      shots: [
        ['items', 'desktop', 'Items and units: base units, purchase units such as 1 bag = 25 kilogram, and shelf life'],
        ['supplier-tax-id', 'desktop', 'A new supplier refused because the tax identification number fails its check digit'],
      ],
      try: 'Sign in as purchasing, press “Add supplier” and mistype one digit of the tax ID.',
    },
    {
      id: 'access',
      kicker: 'Access and audit',
      title: 'The right people. Only the right people.',
      pain: 'Everyone shares one login, anyone can change anything, and when something goes wrong there is no record of who did it.',
      body: 'Seven roles, enforced by the API — not just hidden buttons. Administrators sign in with a second factor and single-use recovery codes; five wrong tries lock an account for 15 minutes; the last administrator keeps the role. Every change and every refused sign-in lands in an append-only audit trail, with who, when and the request’s correlation id.',
      points: [
        ['Seven roles', 'From purchasing to finance; a user may hold several.'],
        ['Second factor', 'An authenticator code for administrators, with recovery codes.'],
        ['Segregation of duties', 'Nobody approves their own document — arriving with the first approval.', 8],
      ],
      shots: [
        ['users', 'desktop', 'Users and roles: seven demo users, their roles and their second-factor status'],
        ['second-factor', 'desktop', 'The second-factor step of signing in, with the demo’s published recovery codes'],
      ],
      try: 'Sign in as admin with one of the recovery codes the sign-in screen shows, then open “Users and roles”.',
    },
    {
      id: 'observe',
      kicker: 'Observability',
      title: 'When something breaks, you’ll know why.',
      pain: '“The system is slow” — and nobody can find the one request that failed.',
      body: 'The console asks the API and its database whether they are healthy and, when one is not, shows the correlation id of that check — the same id as the API’s log line. Every request is one structured JSON log line under the ecosystem’s telemetry contract, and Prometheus metrics count requests, refused sign-ins and postings. Emails, passwords and codes never reach a log.',
      points: [
        ['Health at a glance', 'The API and its database, checked on demand.'],
        ['One id, end to end', 'The id on the screen is the id in the log.'],
        ['Metrics built in', 'Requests, refused sign-ins, postings by document type.'],
      ],
      shots: [['status', 'desktop', 'System status: the API and the database both healthy']],
      try: 'Open “System status”. On a Docker install, stop the database and press “Check again”.',
    },
    {
      id: 'anywhere',
      kicker: 'Any device',
      title: 'At the desk, on a tablet, in your pocket.',
      pain: 'Branch managers are on the floor, not at a desk — and not everyone reads English.',
      body: 'The console fits a desktop, narrows its menu to icons on a tablet and turns every table row into a card on a phone, in light or dark mode, in Thai or English. You can try all of it now: the public demo runs the backend’s own rules in your browser, with no server.',
      points: [
        ['One console', 'Desktop, tablet and phone.'],
        ['Light and dark', 'Follows the device.'],
        ['Thai and English', 'One click, remembered by the browser.'],
      ],
      shots: [
        ['phone-stock', 'phone', 'Stock on hand on a phone, each lot a card, in light mode'],
        ['phone-stock-dark', 'phone', 'The same screen in dark mode'],
      ],
      try: 'Open the demo on your phone.',
    },
  ],
  next: {
    kicker: 'Roadmap',
    title: 'What’s cooking next.',
    sub: 'Built in public, one GitHub issue at a time. None of this is in the demo yet.',
    items: [
      [8, 'Stock adjustments with segregation of duties', 'progress'],
      [9, 'POS integration contract and POS registration'],
      [10, 'Purchase orders with an approval threshold'],
      [11, 'Goods receipts with inspection and lots'],
      [13, 'Production orders: measured yield and lot genealogy'],
      [14, 'Transfers through in-transit'],
      [23, 'Traceability and the recall report'],
      [24, 'Stock counts'],
    ],
  },
  open: {
    kicker: 'Open source',
    title: 'Free for one chain. For good.',
    body: 'The Community edition is Apache 2.0 and complete for one chain, with no limit on users, locations or data. A paid Enterprise edition for scale and regulation starts after the first release. Food safety, data integrity, basic security, access to your own data and the upgrade path are never behind a paywall.',
    facts: [
      ['Apache 2.0', 'Community edition'],
      ['21', 'design decisions, in English and Thai'],
      ['TH · EN', 'the console and every decision record'],
    ],
    link: ['Read the editions decision', `${REPO}/blob/main/docs/adr/0015-editions-community-and-enterprise.md`],
  },
  final: {
    title: 'See it for yourself.',
    sub: 'The whole console, on the fictional chain, with nothing to install.',
    cta: 'Try the demo',
    cta2: 'Install with Docker',
    install: `${REPO}#on-your-machine-with-docker`,
  },
  footer: [
    'PaynEat ERP is open source: Apache 2.0, with <code>ee/</code> under the Elastic License 2.0.',
    'The demo chain — one plant, three branches, two suppliers — is fictional. Every screen on this page is the real console on the public demo.',
  ],
  footerLinks: [
    ['GitHub', REPO],
    ['Design decisions', `${REPO}/blob/main/docs/adr/README.md`],
    ['Issues', `${REPO}/issues`],
    ['PaynEat POS', 'https://suruchboss.github.io/PaynEat/'],
  ],
  readmeSection: {
    title: 'The problems it solves today',
    intro:
      'What works on `main` today, grouped by the problem it solves for a chain. Every picture is the real console on the [public demo](https://suruchboss.github.io/PaynEat-ERP/); the same story, laid out as a page, is on the [product page](https://suruchboss.github.io/PaynEat-ERP/about/).',
  },
};

export const th = {
  code: 'th',
  file: 'index.th.html',
  readme: 'README.th.md',
  title: 'PaynEat ERP — จากซัพพลายเออร์ถึงจาน ทุก lot ตรวจสอบได้',
  description:
    'ระบบหลังบ้านโอเพนซอร์สสำหรับเชนร้านอาหารที่ดูแลซัพพลายเชนเอง: บัญชีเคลื่อนไหวสต๊อกที่ไม่มีใครแก้ได้ master data ชุดเดียวทุกสาขาและทุกระบบ และสิทธิ์การใช้งานที่ตรวจสอบย้อนหลังได้ ลองได้ในเบราว์เซอร์',
  nav: {
    label: 'เมนูหลัก',
    links: [
      ['#problems', 'ปัญหาที่แก้'],
      ['#next', 'แผนงาน'],
      ['#open', 'โอเพนซอร์ส'],
    ],
    other: ['index.html', 'English', 'en'],
    cta: 'ลองเดโม',
  },
  hero: {
    eyebrow: 'PaynEat ERP · โอเพนซอร์ส',
    title: 'จากซัพพลายเออร์ถึงจาน',
    accent: 'ทุก lot ตรวจสอบได้',
    lead: 'ระบบหลังบ้านสำหรับเชนร้านอาหารที่ดูแลซัพพลายเชนเอง สร้างแบบเปิดเผยต่อสาธารณะ เริ่มจากสิ่งที่ทุกอย่างต้องพึ่ง: ตัวเลขสต๊อกที่เชื่อได้',
    cta: 'ลองเดโม',
    cta2: 'ดูโค้ด',
    status: 'ระยะโครงระบบ: บัญชีเคลื่อนไหวสต๊อก master data และสิทธิ์การใช้งานใช้ได้แล้ววันนี้ งานจัดซื้อ การผลิต และการโอนตามมาถัดไป',
    shot: ['stock-dark', 'desktop', 'สต๊อกคงเหลือในโหมดมืด: lot ห้ารายการที่โรงงานบางนา พร้อมต้นทุนต่อหน่วยและมูลค่า'],
  },
  problemsHead: {
    kicker: 'ทำไมต้อง PaynEat ERP',
    title: 'ออกแบบมาเพื่อปัญหาที่เชนกำลังโตเจอจริง',
    sub: 'ทุกคำตอบด้านล่างใช้ได้แล้ววันนี้บนเดโมสาธารณะ ทุกภาพคือ console จริงบนข้อมูลเชนสมมติ',
  },
  labels: { problem: 'ปัญหา', try: 'ลองเอง', open: 'เปิดเดโม', planned: 'วางแผนไว้', progress: 'กำลังทำ' },
  problems: [
    {
      id: 'trust',
      kicker: 'บัญชีเคลื่อนไหวสต๊อก',
      title: 'ตัวเลขสต๊อกที่ทุกคนเชื่อ',
      pain: 'สเปรดชีตถูกเขียนทับ โรงงานกับสาขาตัวเลขไม่เคยตรงกัน และไม่มีใครบอกได้ว่าวันอังคารที่แล้วสต๊อกมีเท่าไร',
      body: 'ทุกการเคลื่อนไหวเป็นรายการเคลื่อนไหวที่ไม่มีใครแก้ได้ ฐานข้อมูลเองก็ปฏิเสธ ความผิดพลาดแก้ด้วยเอกสารกลับรายการที่อยู่คู่กับต้นฉบับ สต๊อกคงเหลือดูได้ ณ วันที่เกิดรายการใดก็ได้ พร้อมต้นทุนและมูลค่าของทุก lot เป็นทศนิยมแม่นยำ',
      points: [
        ['เพิ่มได้อย่างเดียว', 'รายการเคลื่อนไหวไม่ถูกแก้หรือลบเลย'],
        ['ณ วันใดก็ได้', 'นับตามวันที่เกิดรายการ ไม่ใช่วันที่พิมพ์เข้าระบบ'],
        ['แม่นยำ', 'ทศนิยมจริง ไม่ใช่ floating point: 22,716.7 บาท คือ 22,716.7'],
      ],
      shots: [['stock', 'desktop', 'สต๊อกคงเหลือตามสินค้า lot และสถานที่ พร้อมต้นทุนต่อหน่วย มูลค่า และวันหมดอายุ']],
      try: 'เปิด “สต๊อกคงเหลือ” แล้วตั้ง “ณ วันที่” เป็นสองวันก่อน',
    },
    {
      id: 'golive',
      kicker: 'ยอดยกมา',
      title: 'เริ่มใช้ระบบโดยไม่ต้องวุ่นกับสเปรดชีต',
      pain: 'วันแรกของระบบใหม่คือวันที่ข้อมูลผิดเข้ามา: น่องไก่ครึ่งชิ้น lot ที่หมดอายุไปแล้ว ตัวเลขที่พิมพ์ซ้ำ',
      body: 'ยอดยกมาเป็นร่างจนกว่าจะ post และถูกตรวจทีละบรรทัดก่อน การ post เปลี่ยนทุกบรรทัดเป็น lot ในธุรกรรมเดียว หรือไม่เปลี่ยนเลยสักบรรทัด เอกสารที่ post แล้วถือเป็นที่สุด ทางเดียวที่ย้อนได้คือเอกสารกลับรายการพร้อมเหตุผล',
      points: [
        ['ตรวจทีละบรรทัด', 'ชิ้นไม่มีทศนิยม lot ที่หมดอายุแล้วถูกปฏิเสธ'],
        ['ได้ทั้งหมดหรือไม่ได้เลย', 'ทุกบรรทัดเป็น lot ในธุรกรรมเดียว'],
        ['ย้อนรอยได้ตั้งแต่วันแรก', 'OB-2026-00002 และ lot ของมัน /1, /2'],
      ],
      shots: [
        ['opening-refused', 'desktop', 'ยอดยกมาใหม่ถูกปฏิเสธ เพราะ 2.5 ชิ้นมีทศนิยมเกินที่หน่วยเก็บได้'],
        ['opening-reversed', 'desktop', 'ยอดยกมาที่ post แล้วถูกกลับรายการด้วย RV-2026-00001 พร้อมเก็บเหตุผลไว้'],
      ],
      try: 'เข้าสู่ระบบเป็น plant กด “สร้างยอดยกมา” แล้วใส่น่องไก่ 2.5 ชิ้น',
    },
    {
      id: 'master',
      kicker: 'Master data',
      title: 'master data ชุดเดียว ทุกสาขา ทุกระบบ',
      pain: 'แต่ละสาขาเรียกไก่ตัวเดียวกันคนละชื่อ ซัพพลายเออร์ขายเป็นถุง ครัวนับเป็นชิ้น และ POS ก็มีรายการของตัวเอง',
      body: 'สินค้ามีหน่วยหลักหน่วยเดียวและหน่วยซื้อที่แปลงได้แม่นยำ 1 ถุง = 25 กิโลกรัม ไก่ทั้งตัวเก็บทั้งน้ำหนักและจำนวนตัว รหัสสถานที่ใช้ร่วมกับ PaynEat POS และ Cwork และตายตัวเมื่อถูกใช้แล้ว ทุกการเปลี่ยนแปลงเป็นเวอร์ชัน master data ที่มีเลขให้ POS ดึงไป เลขประจำตัวผู้เสียภาษีของซัพพลายเออร์ถูกตรวจด้วยหลักตรวจสอบ',
      points: [
        ['แปลงหน่วยแม่นยำ', 'ตัวคูณมากกว่าศูนย์เสมอ หน่วยหลักไม่เปลี่ยน'],
        ['มีเวอร์ชันให้ POS', 'ทุกการเปลี่ยนเป็นเวอร์ชันถัดไป เรียงลำดับ ไม่มีช่องว่าง'],
        ['จับได้ตั้งแต่ตอนกรอก', 'เลขผู้เสียภาษีที่พิมพ์ผิดไม่ผ่านหลักตรวจสอบ'],
      ],
      shots: [
        ['items', 'desktop', 'สินค้าและหน่วยนับ: หน่วยหลัก หน่วยซื้อ เช่น 1 ถุง = 25 กิโลกรัม และอายุการเก็บ'],
        ['supplier-tax-id', 'desktop', 'ซัพพลายเออร์ใหม่ถูกปฏิเสธ เพราะเลขประจำตัวผู้เสียภาษีไม่ผ่านหลักตรวจสอบ'],
      ],
      try: 'เข้าสู่ระบบเป็น purchasing กด “เพิ่มซัพพลายเออร์” แล้วพิมพ์เลขผู้เสียภาษีผิดหนึ่งหลัก',
    },
    {
      id: 'access',
      kicker: 'สิทธิ์และการตรวจสอบ',
      title: 'คนที่ใช่ และเฉพาะคนที่ใช่',
      pain: 'ทุกคนใช้บัญชีเดียวกัน ใครจะแก้อะไรก็ได้ และเมื่อมีอะไรผิดพลาดก็ไม่มีบันทึกว่าใครทำ',
      body: 'เจ็ดบทบาทที่ API บังคับจริง ไม่ใช่แค่ซ่อนปุ่ม ผู้ดูแลระบบเข้าสู่ระบบด้วยการยืนยันตัวตนขั้นที่สองและรหัสกู้คืนที่ใช้ได้ครั้งเดียว ผิดห้าครั้งติดล็อกบัญชี 15 นาที และผู้ดูแลระบบคนสุดท้ายยังคงบทบาทไว้เสมอ ทุกการเปลี่ยนแปลงและทุกการเข้าสู่ระบบที่ถูกปฏิเสธลงบันทึกการตรวจสอบแบบเพิ่มได้อย่างเดียว พร้อมผู้ทำ เวลา และ correlation id ของคำขอ',
      points: [
        ['เจ็ดบทบาท', 'ตั้งแต่จัดซื้อถึงการเงิน ผู้ใช้หนึ่งคนมีได้หลายบทบาท'],
        ['การยืนยันตัวตนขั้นที่สอง', 'รหัสจากแอป authenticator สำหรับผู้ดูแลระบบ พร้อมรหัสกู้คืน'],
        ['การแยกหน้าที่', 'ไม่มีใครอนุมัติเอกสารที่ตัวเองสร้าง มาพร้อมการอนุมัติครั้งแรก', 8],
      ],
      shots: [
        ['users', 'desktop', 'ผู้ใช้และบทบาท: ผู้ใช้เดโมเจ็ดคน บทบาท และสถานะการยืนยันตัวตนขั้นที่สอง'],
        ['second-factor', 'desktop', 'ขั้นยืนยันตัวตนขั้นที่สองตอนเข้าสู่ระบบ พร้อมรหัสกู้คืนของเดโมที่เผยแพร่ไว้'],
      ],
      try: 'เข้าสู่ระบบเป็น admin ด้วยรหัสกู้คืนที่หน้าเข้าสู่ระบบแสดงไว้ แล้วเปิด “ผู้ใช้และบทบาท”',
    },
    {
      id: 'observe',
      kicker: 'การสังเกตระบบ',
      title: 'เมื่อมีอะไรพัง คุณจะรู้ว่าเพราะอะไร',
      pain: '“ระบบช้า” แล้วไม่มีใครหาคำขอที่ล้มเหลวเจอสักรายการ',
      body: 'console ถาม API และฐานข้อมูลว่ายังปกติไหม และถ้าตัวใดไม่ปกติ จะแสดง correlation id ของการตรวจครั้งนั้น ซึ่งเป็น id เดียวกับบรรทัด log ของ API ทุกคำขอเป็น log JSON หนึ่งบรรทัดตามสัญญา telemetry ของระบบนิเวศ และ metric ของ Prometheus นับคำขอ การเข้าสู่ระบบที่ถูกปฏิเสธ และการ post อีเมล รหัสผ่าน และรหัสยืนยันไม่เคยเข้า log',
      points: [
        ['เห็นสุขภาพระบบทันที', 'API และฐานข้อมูล ตรวจได้เมื่อต้องการ'],
        ['id เดียวตลอดทาง', 'id บนจอคือ id ใน log'],
        ['มี metric ในตัว', 'คำขอ การเข้าสู่ระบบที่ถูกปฏิเสธ การ post แยกตามประเภทเอกสาร'],
      ],
      shots: [['status', 'desktop', 'สถานะระบบ: API และฐานข้อมูลปกติทั้งคู่']],
      try: 'เปิด “สถานะระบบ” ถ้าติดตั้งด้วย Docker ลองหยุดฐานข้อมูลแล้วกด “ตรวจอีกครั้ง”',
    },
    {
      id: 'anywhere',
      kicker: 'ทุกอุปกรณ์',
      title: 'ที่โต๊ะทำงาน บนแท็บเล็ต ในกระเป๋า',
      pain: 'ผู้จัดการสาขาอยู่หน้าร้าน ไม่ได้นั่งโต๊ะ และไม่ใช่ทุกคนอ่านภาษาอังกฤษ',
      body: 'console พอดีกับจอคอมพิวเตอร์ ย่อเมนูเหลือไอคอนบนแท็บเล็ต และเปลี่ยนทุกแถวของตารางเป็นการ์ดบนมือถือ ทั้งโหมดสว่างและมืด ทั้งไทยและอังกฤษ และลองได้ทั้งหมดตอนนี้: เดโมสาธารณะรันกฎของ backend เองในเบราว์เซอร์ของคุณ ไม่มีเซิร์ฟเวอร์',
      points: [
        ['console เดียว', 'คอมพิวเตอร์ แท็บเล็ต และมือถือ'],
        ['สว่างและมืด', 'ตามการตั้งค่าของเครื่อง'],
        ['ไทยและอังกฤษ', 'คลิกเดียว เบราว์เซอร์จำไว้ให้'],
      ],
      shots: [
        ['phone-stock', 'phone', 'สต๊อกคงเหลือบนมือถือ แต่ละ lot เป็นการ์ด ในโหมดสว่าง'],
        ['phone-stock-dark', 'phone', 'หน้าจอเดียวกันในโหมดมืด'],
      ],
      try: 'เปิดเดโมบนมือถือของคุณ',
    },
  ],
  next: {
    kicker: 'แผนงาน',
    title: 'สิ่งที่กำลังจะมา',
    sub: 'สร้างแบบเปิดเผยทีละ GitHub issue ทั้งหมดนี้ยังไม่อยู่ในเดโม',
    items: [
      [8, 'การปรับปรุงสต๊อกพร้อมการแยกหน้าที่', 'progress'],
      [9, 'สัญญาการเชื่อมต่อ POS และการลงทะเบียน POS'],
      [10, 'ใบสั่งซื้อพร้อมเกณฑ์วงเงินที่ต้องอนุมัติ'],
      [11, 'ใบรับสินค้าพร้อมการตรวจรับและ lot'],
      [13, 'ใบสั่งผลิต: yield ที่วัดจริงและผังความสัมพันธ์ lot'],
      [14, 'ใบโอนผ่านระหว่างขนส่ง'],
      [23, 'การย้อนรอยและรายงาน recall'],
      [24, 'การตรวจนับสต๊อก'],
    ],
  },
  open: {
    kicker: 'โอเพนซอร์ส',
    title: 'ฟรีสำหรับหนึ่งเชน ตลอดไป',
    body: 'รุ่น Community เป็น Apache 2.0 และครบสำหรับหนึ่งเชน ไม่จำกัดผู้ใช้ สถานที่ หรือข้อมูล รุ่น Enterprise แบบเสียเงินสำหรับขนาดใหญ่และข้อกำหนดเฉพาะเริ่มหลังรุ่นแรก ความปลอดภัยของอาหาร ความถูกต้องของข้อมูล ความปลอดภัยพื้นฐาน การเข้าถึงข้อมูลของตัวเอง และทางอัปเกรด ไม่เคยถูกกั้นด้วยค่าใช้จ่าย',
    facts: [
      ['Apache 2.0', 'รุ่น Community'],
      ['21', 'บันทึกการตัดสินใจ ทั้งไทยและอังกฤษ'],
      ['ไทย · EN', 'ทั้ง console และบันทึกการตัดสินใจทุกฉบับ'],
    ],
    link: ['อ่านการตัดสินใจเรื่องรุ่นของระบบ', `${REPO}/blob/main/docs/adr/0015-editions-community-and-enterprise.th.md`],
  },
  final: {
    title: 'ลองดูด้วยตัวเอง',
    sub: 'console ทั้งระบบบนข้อมูลเชนสมมติ ไม่ต้องติดตั้งอะไร',
    cta: 'ลองเดโม',
    cta2: 'ติดตั้งด้วย Docker',
    install: `${REPO}/blob/main/README.th.md`,
  },
  footer: [
    'PaynEat ERP เป็นโอเพนซอร์ส: Apache 2.0 ส่วน <code>ee/</code> ใช้ Elastic License 2.0',
    'เชนเดโม ซึ่งมีโรงงานหนึ่งแห่ง สามสาขา และซัพพลายเออร์สองราย เป็นข้อมูลสมมติ ทุกหน้าจอในหน้านี้คือ console จริงบนเดโมสาธารณะ',
  ],
  footerLinks: [
    ['GitHub', REPO],
    ['บันทึกการตัดสินใจ', `${REPO}/blob/main/docs/adr/README.md`],
    ['Issues', `${REPO}/issues`],
    ['PaynEat POS', 'https://suruchboss.github.io/PaynEat/'],
  ],
  readmeSection: {
    title: 'ปัญหาที่แก้ได้แล้ววันนี้',
    intro:
      'สิ่งที่ใช้ได้บน `main` วันนี้ จัดกลุ่มตามปัญหาที่แก้ให้เชน ทุกภาพคือ console จริงบน[เดโมสาธารณะ](https://suruchboss.github.io/PaynEat-ERP/) เรื่องเดียวกันในรูปแบบหน้าเว็บอยู่ที่[หน้าแนะนำผลิตภัณฑ์](https://suruchboss.github.io/PaynEat-ERP/about/index.th.html)',
  },
};

export const LANGUAGES = [en, th];
export { issue };
