# KPI Lite Phase 1

เป้าหมายของรอบนี้คือ ลดภาระการกรอก KPI โดยไม่เปลี่ยน schema และไม่แตะกติกา Penalty / Daily Cap เดิม

## สิ่งที่เปลี่ยน

1. **Explicit Error Confirmation**
   - `missing` ต้องคงเป็น `missing`
   - ระบบจะไม่ถือว่า `0 Error` เพียงเพราะมี Daily Record ส่วนอื่นแล้ว
   - `0 Error` ต้องมาจาก flow `NO_ERRORS` ที่ผู้ใช้ยืนยันเดิมเท่านั้น

2. **Workload Quick Fill**
   - เพิ่มปุ่มกรอกเร็วสำหรับงานหลักเต็มวัน: ขาออก / ขาเข้า / ย้าย / อื่น ๆ
   - ยังคง Capacity = 10 และ validation เดิม
   - ไม่เปลี่ยนรูปแบบข้อมูลที่ backend รับ

3. **Safe Preview**
   - เปิด `kpi-lite-preview.html` เพื่อทดสอบ compatibility layer ครอบหน้าเดิม
   - หน้า `index.html` production ยังไม่ถูกแก้ใน PR ระยะทดลองนี้

## เหตุผลที่ยังไม่แก้ Roster ใน Phase 1

Roster ปัจจุบันผูกกับ metadata ใน Error Case และ Shared Penalty ใช้รายชื่อ on-duty จาก flow นี้ การเปลี่ยน default roster โดยยังไม่มี Shift/Roster record แยกอาจทำให้ Shared Penalty ผิดคน จึงเลื่อนไป Phase 2 ซึ่งควรเพิ่ม authoritative Shift Record ก่อน

## Phase 2 ที่แนะนำ

- สร้าง Shift/Roster record แยกจาก Error
- Shared Penalty อ่าน roster จาก Shift Record
- เชื่อม attendance/clock-in ถ้ามี source ที่เชื่อถือได้
- ลด Workload จากการแบ่ง 10 คะแนนด้วยมือไปเป็น primary role + exception
- แยก process denominators สำหรับ Outbound / Inbound / Transfer error rate

## Rollout guardrail

- ห้าม merge compatibility behavior เข้าหน้า production ก่อนทดสอบ `kpi-lite-preview.html` กับข้อมูลจริงอย่างน้อยหนึ่งรอบกะ
- ตรวจว่า Missing Error แสดงเป็น “ยังไม่ได้สรุป” และ explicit NO_ERRORS แสดงเป็น 0 เคส
- ตรวจ quick fill ว่าผลรวมยังเท่ากับ Capacity และ save ผ่าน backend เดิม
