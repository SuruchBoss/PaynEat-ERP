// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

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

  'nav.section.administration': 'การดูแลระบบ',
  'nav.users': 'ผู้ใช้และบทบาท',
  'session.signedInAs': 'เข้าสู่ระบบในชื่อ',
  'session.signOut': 'ออกจากระบบ',
  'auth.checkingSession': 'กำลังตรวจสอบการเข้าสู่ระบบ…',
  'auth.forbidden.title': 'คุณไม่มีสิทธิ์เปิดหน้านี้',
  'auth.forbidden.body':
    'บทบาทของคุณยังไม่มีสิทธิ์ใช้หน้านี้ หากคิดว่าไม่ถูกต้อง ติดต่อผู้ดูแลระบบของบริษัท',
  'error.unreachable': 'ติดต่อ API ไม่ได้ ตรวจว่าเซิร์ฟเวอร์เปิดอยู่ แล้วลองอีกครั้ง',
  'error.rateLimited': 'มีคำขอจากเครื่องนี้มากเกินไป รอสักครู่แล้วลองอีกครั้ง',
  'error.unexpected':
    'เกิดข้อผิดพลาดที่ไม่คาดคิด ลองอีกครั้ง หากยังไม่ได้ ให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิงด้านล่าง',
  'signIn.title': 'เข้าสู่ระบบ',
  'signIn.intro': 'ใช้อีเมลและรหัสผ่านที่ผู้ดูแลระบบให้ไว้',
  'signIn.email': 'อีเมล',
  'signIn.password': 'รหัสผ่าน',
  'signIn.submit': 'เข้าสู่ระบบ',
  'signIn.working': 'กำลังตรวจสอบ…',
  'signIn.startOver': 'เริ่มใหม่',
  'signIn.code.title': 'ยืนยันตัวตนขั้นที่สอง',
  'signIn.code.intro':
    'บัญชีนี้ใช้การยืนยันตัวตนสองขั้นตอน ใส่รหัสจากแอปยืนยันตัวตนในโทรศัพท์ของคุณ',
  'signIn.code.label': 'รหัสยืนยัน',
  'signIn.code.hint': 'รหัส 6 หลักจากแอป หรือรหัสกู้คืนที่เก็บไว้ (ใช้ได้ครั้งเดียว)',
  'signIn.code.submit': 'ยืนยัน',
  'signIn.enrol.title': 'ตั้งค่าการยืนยันตัวตนสองขั้นตอน',
  'signIn.enrol.intro':
    'บัญชีผู้ดูแลระบบต้องใช้การยืนยันตัวตนขั้นที่สองก่อนเข้าใช้งาน ตั้งค่าครั้งเดียวด้วยแอปยืนยันตัวตนใดก็ได้ในโทรศัพท์',
  'signIn.enrol.stepScan': 'เปิดแอปยืนยันตัวตน แล้วสแกนคิวอาร์โค้ดนี้',
  'signIn.enrol.stepCode': 'ใส่รหัส 6 หลักที่แอปแสดง เพื่อยืนยันว่าตั้งค่าสำเร็จ',
  'signIn.enrol.qrAlt': 'คิวอาร์โค้ดสำหรับเพิ่มบัญชีนี้ในแอปยืนยันตัวตน',
  'signIn.enrol.manual': 'สแกนไม่ได้? พิมพ์รหัสลับนี้ในแอปแทน:',
  'signIn.enrol.codeHint': 'รหัส 6 หลักที่แอปแสดงตอนนี้',
  'signIn.enrol.submit': 'เปิดใช้งานและเข้าสู่ระบบ',
  'signIn.recovery.title': 'เก็บรหัสกู้คืนไว้',
  'signIn.recovery.intro':
    'หากโทรศัพท์หายหรือใช้แอปไม่ได้ ใช้รหัสกู้คืนแทนรหัสจากแอปได้ รหัสละหนึ่งครั้ง',
  'signIn.recovery.listLabel': 'รหัสกู้คืน',
  'signIn.recovery.warning':
    'รหัสเหล่านี้จะแสดงครั้งนี้ครั้งเดียว จดหรือพิมพ์เก็บไว้ในที่ปลอดภัยก่อนไปต่อ',
  'signIn.recovery.continue': 'เก็บแล้ว ไปต่อ',
  'signIn.error.credentials': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'signIn.error.locked': 'บัญชีถูกล็อกชั่วคราวเพราะใส่ผิดหลายครั้ง รอสักครู่แล้วลองอีกครั้ง',
  'signIn.error.disabled': 'บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบของบริษัท',
  'signIn.error.code': 'รหัสไม่ถูกต้อง ลองรหัสถัดไปที่แอปแสดง',
  'signIn.error.expired': 'ขั้นตอนเข้าสู่ระบบหมดเวลาแล้ว กด “เริ่มใหม่” แล้วใส่รหัสผ่านอีกครั้ง',
  'role.admin': 'ผู้ดูแลระบบ',
  'role.purchasing': 'จัดซื้อ',
  'role.purchasing_approver': 'ผู้อนุมัติการจัดซื้อ',
  'role.plant': 'โรงงาน',
  'role.logistics': 'ขนส่ง',
  'role.branch_manager': 'ผู้จัดการสาขา',
  'role.finance': 'การเงิน',
  'role.admin.description':
    'จัดการผู้ใช้ บทบาท สถานที่เก็บสต๊อก การตั้งค่า และเปิดงวดที่ปิดแล้วอีกครั้ง',
  'role.admin.secondFactor': 'ต้องใช้การยืนยันตัวตนสองขั้นตอน',
  'role.purchasing.description': 'สร้างและส่งใบสั่งซื้อ จัดการซัพพลายเออร์',
  'role.purchasing_approver.description': 'อนุมัติใบสั่งซื้อที่เกินเกณฑ์วงเงินที่ต้องอนุมัติ',
  'role.plant.description': 'รับสินค้า ดำเนินการใบสั่งผลิต จัดการสต๊อกของโรงงาน',
  'role.logistics.description': 'ส่งของตามใบโอน',
  'role.branch_manager.description': 'ออกใบขอเบิก รับโอน ตรวจนับสต๊อกสาขา',
  'role.finance.description': 'ดูต้นทุน ส่วนต่าง และมูลค่าสต๊อก export ข้อมูลทางการเงิน',
  'users.title': 'ผู้ใช้และบทบาท',
  'users.intro':
    'ทุกคนที่เข้าใช้ ERP และบทบาทที่ถืออยู่ ผู้ใช้หนึ่งคนถือได้หลายบทบาท ทุกการเปลี่ยนแปลงถูกบันทึกในบันทึกการตรวจสอบ',
  'users.loading': 'กำลังโหลดรายชื่อผู้ใช้…',
  'users.table.caption': 'รายชื่อผู้ใช้',
  'users.column.name': 'ผู้ใช้',
  'users.column.roles': 'บทบาท',
  'users.column.mfa': 'ยืนยันตัวตนสองขั้นตอน',
  'users.column.lastSignIn': 'เข้าสู่ระบบล่าสุด',
  'users.column.actions': 'การจัดการ',
  'users.noRoles': 'ยังไม่มีบทบาท',
  'users.never': 'ยังไม่เคย',
  'users.mfa.on': 'เปิดแล้ว',
  'users.mfa.off': 'ไม่ได้ใช้',
  'users.mfa.pending': 'ต้องตั้งค่าตอนเข้าสู่ระบบครั้งถัดไป',
  'users.create.open': 'เพิ่มผู้ใช้',
  'users.create.title': 'เพิ่มผู้ใช้ใหม่',
  'users.create.submit': 'สร้างผู้ใช้',
  'users.create.done': 'สร้างผู้ใช้ {email} แล้ว แจ้งรหัสผ่านเริ่มต้นกับเจ้าของบัญชีด้วยตนเอง',
  'users.field.displayName': 'ชื่อที่แสดง',
  'users.field.email': 'อีเมล',
  'users.field.password': 'รหัสผ่านเริ่มต้น',
  'users.field.passwordHint':
    'อย่างน้อย 12 ตัวอักษร ประโยคยาวๆ จำง่ายกว่าและเดายากกว่า ห้ามเป็นรหัสที่เดาง่ายหรือมีอีเมลอยู่ในนั้น',
  'users.field.locale': 'ภาษาของผู้ใช้',
  'users.field.roles': 'บทบาท',
  'users.saving': 'กำลังบันทึก…',
  'users.cancel': 'ยกเลิก',
  'users.roles.editShort': 'จัดการบทบาท',
  'users.roles.edit': 'จัดการบทบาทของ {name}',
  'users.roles.title': 'บทบาทของ {name}',
  'users.roles.intro':
    'ติ๊กเพื่อให้บทบาท เอาติ๊กออกเพื่อถอน มีผลทันทีกับคำขอถัดไปของผู้ใช้ ผู้ที่ได้บทบาทผู้ดูแลระบบแต่ยังไม่ได้ตั้งค่าการยืนยันตัวตนสองขั้นตอนจะถูกออกจากระบบ และต้องตั้งค่าตอนเข้าสู่ระบบครั้งถัดไป',
  'users.roles.legend': 'บทบาทของ {email}',
  'users.roles.granted': 'ให้บทบาท “{role}” แก่ {name} แล้ว',
  'users.roles.revoked': 'ถอนบทบาท “{role}” จาก {name} แล้ว',
  'users.roles.close': 'ปิด',
  'users.error.emailTaken': 'มีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้ว',
  'users.error.weakPassword':
    'รหัสผ่านไม่ผ่านเกณฑ์: ต้องยาวอย่างน้อย 12 ตัวอักษร ไม่ใช่รหัสที่เดาง่าย และไม่มีอีเมลอยู่ในนั้น',
  'users.error.invalid': 'ข้อมูลไม่ครบหรือไม่ถูกต้อง ตรวจอีเมล ชื่อ และรหัสผ่านอีกครั้ง',
  'users.error.lastAdmin':
    'ถอนไม่ได้: นี่คือผู้ดูแลระบบคนสุดท้ายที่ใช้งานอยู่ ให้บทบาทผู้ดูแลระบบแก่คนอื่นก่อน',

  'notFound.title': 'ไม่พบหน้านี้',
  'notFound.body': 'ลิงก์อาจไม่ถูกต้อง หรือหน้านี้ถูกย้ายไปแล้ว',
  'notFound.back': 'กลับไปหน้าสถานะระบบ',
} as const;

export type MessageKey = keyof typeof th;

/** Every other language must translate every key, and nothing more. */
export type Messages = { readonly [K in MessageKey]: string };
