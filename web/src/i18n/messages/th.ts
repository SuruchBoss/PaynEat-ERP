/**
 * The source catalogue: every string the console shows, in Thai (the default language).
 * `en.ts` is typed against this object, so a key missing from either side fails the
 * typecheck, and `catalogue.test.ts` fails the test run as well.
 *
 * Keys name where a string is used, not what it says. Placeholders are `{name}`.
 */
export const th = {
  'app.name': 'PaynEat ERP',

  'shell.skipToContent': 'ข้ามไปยังเนื้อหาหลัก',
  'shell.mainNavigation': 'เมนูหลัก',
  'shell.openNavigation': 'เปิดเมนู',
  'shell.closeNavigation': 'ปิดเมนู',

  'nav.section.system': 'ระบบ',
  'nav.status': 'สถานะระบบ',

  'language.label': 'ภาษา',
  'language.th': 'ไทย',
  'language.en': 'English',

  'status.title': 'สถานะระบบ',
  'status.intro': 'ตรวจว่า API และฐานข้อมูลของ ERP ตอบสนองตามปกติหรือไม่',
  'status.refresh': 'ตรวจอีกครั้ง',
  'status.checking': 'กำลังตรวจสอบ…',
  'status.checkedAt': 'ตรวจล่าสุด {time}',
  'status.components': 'ส่วนประกอบของระบบ',
  'status.column.component': 'ส่วนประกอบ',
  'status.column.state': 'สถานะ',
  'status.component.api': 'API',
  'status.component.database': 'ฐานข้อมูล',
  'status.state.up': 'ปกติ',
  'status.state.down': 'ขัดข้อง',
  'status.state.unknown': 'ไม่ทราบ',
  'status.overall.ok': 'ทุกส่วนทำงานปกติ',
  'status.overall.degraded': 'มีบางส่วนทำงานไม่ปกติ',
  'status.overall.unreachable': 'ติดต่อ API ไม่ได้',
  'status.error.unreachable': 'ไม่ได้รับคำตอบจาก API ตรวจว่าเซิร์ฟเวอร์เปิดอยู่ แล้วลองอีกครั้ง',
  'status.error.http': 'API ตอบกลับด้วยข้อผิดพลาด (HTTP {status})',
  'status.error.invalid': 'API ตอบกลับในรูปแบบที่ระบบไม่รู้จัก',
  'status.correlationId': 'รหัสอ้างอิง (correlation ID)',
  'status.correlationIdHint':
    'แจ้งรหัสนี้เมื่อรายงานปัญหา ผู้ดูแลระบบใช้รหัสนี้ค้น log ของคำขอครั้งนี้ได้ตรงตัว',

  'notFound.title': 'ไม่พบหน้านี้',
  'notFound.body': 'ลิงก์อาจไม่ถูกต้อง หรือหน้านี้ถูกย้ายไปแล้ว',
  'notFound.back': 'กลับไปหน้าสถานะระบบ',
} as const;

export type MessageKey = keyof typeof th;

/** Every other language must translate every key, and nothing more. */
export type Messages = { readonly [K in MessageKey]: string };
