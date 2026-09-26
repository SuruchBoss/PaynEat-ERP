# PaynEat ERP — logo

**English** · ภาษาไทยอยู่ด้านล่าง

The mark is a **lot tag**: the label tied to a crate that makes every lot traceable (ADR-0006), with
three ledger lines of falling length — the oldest lot goes first (FEFO, ADR-0004). It is the ERP's
own world, not a generic "business" symbol.

| File | Use |
|---|---|
| `payneat-erp-logo.svg` | Logo on a light background (README, documents) |
| `payneat-erp-logo-dark.svg` | Logo on a dark background |
| `payneat-erp-mark.svg` | The mark alone, on a light background |
| `web/public/favicon.svg` | Browser tab: two lines instead of three (three blur at 16 px), follows the browser's light/dark theme |
| `web/public/apple-touch-icon.png` | Home-screen icon on a phone or tablet (180 × 180, opaque) |
| `web/src/components/Brand.tsx` | The mark inside the console, drawn inline so it takes the theme's colours |

- **Colours:** rust `#a4480f` with cream `#fbeee4` on light grounds; accent `#f29a5c` with the rail
  colour `#1e231f` on dark grounds. Never recolour the mark to a status colour.
- **Wordmark:** "PaynEat" bold, "ERP" medium and quieter, in IBM Plex Sans (SIL Open Font License),
  converted to outlines in the SVG files so they look the same everywhere. The console itself shows
  the name in the system font; it makes no third-party requests.
- **Clear space:** at least the height of the tag's hole on every side. Do not stretch, rotate,
  outline or put the mark on a photograph.

---

## ภาษาไทย

สัญลักษณ์คือ **ป้ายล็อต** — ป้ายที่ผูกกับลังสินค้าซึ่งทำให้ย้อนรอยได้ทุก lot (ADR-0006) พร้อมเส้นบัญชีสามเส้นที่สั้นลง
ตามลำดับ คือ lot ที่เก่าที่สุดออกก่อน (FEFO, ADR-0004) มาจากงานของ ERP เอง ไม่ใช่สัญลักษณ์ "ธุรกิจ" ทั่วไป

- **สี:** สีสนิม `#a4480f` คู่สีครีม `#fbeee4` บนพื้นสว่าง และสี `#f29a5c` คู่สีแถบเมนู `#1e231f` บนพื้นมืด
  ห้ามเปลี่ยนสีสัญลักษณ์เป็นสีสถานะ (เขียว/เหลือง/แดง)
- **ตัวอักษร:** "PaynEat" ตัวหนา "ERP" น้ำหนักกลางสีอ่อนกว่า ใช้ฟอนต์ IBM Plex Sans (สัญญาอนุญาต SIL Open Font
  License) แปลงเป็นเส้นในไฟล์ SVG แล้ว จึงแสดงเหมือนกันทุกเครื่อง ส่วนใน console ชื่อแสดงด้วยฟอนต์ของระบบ
  เพราะ console ไม่เรียกทรัพยากรภายนอก
- **ระยะว่างรอบโลโก้:** อย่างน้อยเท่ากับความสูงของรูป้ายทุกด้าน ห้ามยืด หมุน ใส่เส้นขอบ หรือวางบนภาพถ่าย
