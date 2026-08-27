(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.AkraStoreSkillMatrix = api;
        api.autoInstall();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const BLUEPRINT_VERSION = '20260827.01';

    // Level 0 intentionally has no certification row. Existing employee-skill rows remain Lv.1-Lv.3.
    const LEVEL_LABELS = {
        0: 'Lv.0 ยังไม่ได้ฝึก/ยังไม่ได้รับรอง',
        1: 'Lv.1 กำลังฝึก / ทำได้เมื่อมีคนดู',
        2: 'Lv.2 ทำเองได้ตามมาตรฐาน',
        3: 'Lv.3 ชำนาญ / ตรวจงานและสอนคนอื่นได้'
    };

    const SKILLS = [
        // Foundation skills shared across departments.
        {
            code: 'FND_PRODUCT', name: 'รู้จักสินค้า (Product Knowledge)', category: 'general', icon: 'fa-box-open',
            department: 'foundation', critical: true,
            description: 'รู้จักชื่อสินค้า ยี่ห้อ ขนาด หน่วยบรรจุ ลักษณะสินค้า และแยกสินค้าที่คล้ายกันได้',
            levels: [
                'ระดับ 1: รู้จักสินค้าหลักและหาได้เมื่อมีคนแนะนำ',
                'ระดับ 2: รู้จักสินค้าที่เกี่ยวข้องกับงานของตนและแยกยี่ห้อ/ขนาด/หน่วยได้เอง',
                'ระดับ 3: รู้จักสินค้าครอบคลุม แก้ความสับสนสินค้า และสอนผู้อื่นได้'
            ]
        },
        {
            code: 'FND_BILL_READ', name: 'อ่านบิลและเอกสารงาน', category: 'general', icon: 'fa-file-lines',
            department: 'foundation', critical: true,
            description: 'อ่านรายการสินค้า จำนวน หน่วย หมายเหตุ และเข้าใจว่าบิลต้องดำเนินการต่ออย่างไร',
            levels: [
                'ระดับ 1: อ่านบิลพื้นฐานได้โดยมีผู้แนะนำ',
                'ระดับ 2: อ่านบิลและดำเนินงานตามรายการ/หมายเหตุได้เอง',
                'ระดับ 3: อ่านบิลซับซ้อน ตรวจความผิดปกติ และสอนวิธีอ่านบิลให้ผู้อื่นได้'
            ]
        },
        {
            code: 'FND_COUNT', name: 'ตรวจนับจำนวนสินค้า', category: 'general', icon: 'fa-calculator',
            department: 'foundation', critical: true,
            description: 'ตรวจนับจำนวนสินค้าและหน่วยบรรจุได้ถูกต้องก่อนรับ ส่ง หรือย้ายสินค้า',
            levels: [
                'ระดับ 1: นับสินค้าทั่วไปได้เมื่อมีผู้ตรวจซ้ำ',
                'ระดับ 2: ตรวจนับและยืนยันจำนวนได้เองอย่างสม่ำเสมอ',
                'ระดับ 3: ตรวจนับงานซับซ้อน หาเหตุจำนวนคลาดเคลื่อนเบื้องต้น และตรวจงานผู้อื่นได้'
            ]
        },
        {
            code: 'FND_LOCATION', name: 'รู้ Location และพื้นที่จัดเก็บ', category: 'warehouse', icon: 'fa-location-dot',
            department: 'foundation', critical: false,
            description: 'รู้ตำแหน่งสินค้าและหลักการวางสินค้าในพื้นที่ที่กำหนด ลดเวลาหาและลดการวางผิดที่',
            levels: [
                'ระดับ 1: หา Location หลักได้โดยมีผู้แนะนำ',
                'ระดับ 2: หาและจัดเก็บตาม Location ได้เอง',
                'ระดับ 3: รู้พื้นที่ครอบคลุม ช่วยแก้ปัญหา Location และแนะนำการจัดพื้นที่ได้'
            ]
        },
        {
            code: 'FND_FEFO', name: 'FEFO / Lot / วันหมดอายุ', category: 'warehouse', icon: 'fa-calendar-check',
            department: 'foundation', critical: true,
            description: 'เลือกและจัดสินค้าโดยคำนึงถึง Lot และวันหมดอายุ ให้สินค้าที่หมดอายุก่อนถูกใช้หรือขายก่อน',
            levels: [
                'ระดับ 1: เข้าใจหลัก FEFO และทำได้เมื่อมีผู้กำกับ',
                'ระดับ 2: เลือก Lot และจัดสินค้า FEFO ได้เองในงานปกติ',
                'ระดับ 3: ตรวจพบความเสี่ยง Lot/Expiry แก้ปัญหา และสอนผู้อื่นได้'
            ]
        },
        {
            code: 'FND_HANDLING', name: 'หยิบยกและเคลื่อนย้ายสินค้า', category: 'warehouse', icon: 'fa-dolly',
            department: 'foundation', critical: true,
            description: 'หยิบ ยก เคลื่อนย้าย และวางสินค้าโดยปลอดภัย ไม่ทำสินค้า/บรรจุภัณฑ์เสียหาย',
            levels: [
                'ระดับ 1: หยิบยกงานทั่วไปได้ตามคำแนะนำ',
                'ระดับ 2: เลือกวิธียก/ขนย้ายที่เหมาะสมและทำได้เองอย่างปลอดภัย',
                'ระดับ 3: จัดการของหนัก/งานซับซ้อน ตรวจความเสี่ยง และสอนวิธีทำงานปลอดภัยได้'
            ]
        },
        {
            code: 'FND_5S', name: 'ดูแลพื้นที่และ 5S', category: 'safety', icon: 'fa-broom',
            department: 'foundation', critical: false,
            description: 'รักษาความสะอาด ทางเดิน พื้นที่จัดเก็บ และความพร้อมของพื้นที่ทำงานตามมาตรฐาน',
            levels: [
                'ระดับ 1: ดูแลพื้นที่ของตนตาม Checklist ได้',
                'ระดับ 2: รักษามาตรฐานพื้นที่และแก้สิ่งผิดปกติที่พบได้เอง',
                'ระดับ 3: ตรวจมาตรฐานพื้นที่ ชี้จุดปรับปรุง และสอนทีมได้'
            ]
        },
        {
            code: 'FND_REPORT', name: 'การแจ้งปัญหาและความผิดปกติ', category: 'general', icon: 'fa-triangle-exclamation',
            department: 'foundation', critical: true,
            description: 'เมื่อพบสินค้าไม่ตรง ขาด เกิน ชำรุด Lot ผิด หรือระบบผิดปกติ รู้ว่าต้องหยุดงานส่วนใดและแจ้งใคร',
            levels: [
                'ระดับ 1: รู้ว่าปัญหาหลักต้องแจ้งหัวหน้างาน',
                'ระดับ 2: แยกประเภทปัญหา เก็บข้อมูลอ้างอิง และแจ้งตามขั้นตอนได้เอง',
                'ระดับ 3: ช่วยวิเคราะห์สาเหตุเบื้องต้น ประสานแก้ไข และสอน Flow ให้ผู้อื่นได้'
            ]
        },

        // W1 storefront / counter roles.
        {
            code: 'W1_POS', name: 'W1 แคชเชียร์ — เปิดบิลและรับชำระ', category: 'storefront', icon: 'fa-cash-register',
            department: 'w1_front', critical: true,
            description: 'เปิดบิล ตรวจรายการ รับเงิน/ช่องทางชำระเงิน และทอนเงินได้ถูกต้อง',
            levels: [
                'ระดับ 1: เปิดบิลและรับชำระรายการทั่วไปโดยมีผู้ดู',
                'ระดับ 2: เปิดบิล รับเงิน ทอนเงิน และตรวจรายการได้เอง',
                'ระดับ 3: แก้กรณีบิล/การชำระซับซ้อน ตรวจงาน และสอนแคชเชียร์ใหม่ได้'
            ]
        },
        {
            code: 'W1_CASH_CTRL', name: 'W1 แคชเชียร์ — ดูแลเงินในกะ', category: 'storefront', icon: 'fa-money-bill-transfer',
            department: 'w1_front', critical: true,
            description: 'ดูแลเงินในกะ ตรวจยอด ส่งมอบเงิน และปฏิบัติตามขั้นตอนเมื่อยอดไม่ตรง',
            levels: [
                'ระดับ 1: รู้ขั้นตอนดูแลและส่งมอบเงินโดยมีผู้ตรวจ',
                'ระดับ 2: ดูแลเงินและตรวจยอดในกะได้เองตามขั้นตอน',
                'ระดับ 3: ตรวจสอบความคลาดเคลื่อน ปิดกะ และสอนมาตรฐาน Cash Control ได้'
            ]
        },
        {
            code: 'W1_ADMIN_ORDER', name: 'W1 แอดมิน — รับ Order และเปิดบิล', category: 'storefront', icon: 'fa-headset',
            department: 'w1_front', critical: true,
            description: 'ตอบลูกค้า รับรายละเอียด Order เลือกสินค้าให้ถูก เปิดบิล และประสานงานกับหน้าร้าน/คลัง',
            levels: [
                'ระดับ 1: รับ Order และเปิดบิลทั่วไปโดยมีผู้ตรวจ',
                'ระดับ 2: รับข้อมูลลูกค้า เปิดบิล และประสานงานได้เองอย่างถูกต้อง',
                'ระดับ 3: จัดการ Order ซับซ้อน แก้ข้อมูลไม่ครบ และสอนแอดมินใหม่ได้'
            ]
        },
        {
            code: 'W1_FRONT_PICK', name: 'W1 หน้าร้าน — จัดบิลและหยิบสินค้า', category: 'storefront', icon: 'fa-cart-flatbed',
            department: 'w1_front', critical: true,
            description: 'อ่านบิล หา หยิบ และจัดสินค้าแยกตามบิล พร้อมช่วย Checker ตรวจสินค้า',
            levels: [
                'ระดับ 1: หยิบและจัดบิลทั่วไปเมื่อมีผู้แนะนำ',
                'ระดับ 2: จัดบิล หยิบ และแยกสินค้าได้เองถูกต้อง',
                'ระดับ 3: จัดบิลซับซ้อน ช่วยตรวจความผิดปกติ และสอนพนักงานใหม่ได้'
            ]
        },
        {
            code: 'W1_REPLENISH', name: 'W1 ในร้าน — เติมและจัดสินค้าภายในร้าน', category: 'storefront', icon: 'fa-boxes-stacked',
            department: 'w1_front', critical: true,
            description: 'เติมสินค้า หยิบของย่อย จัดบิลภายในร้าน รักษา FEFO และความพร้อมของชั้นสินค้า',
            levels: [
                'ระดับ 1: เติมสินค้าตามที่ได้รับมอบหมายได้',
                'ระดับ 2: ดูสินค้าขาด เติมตาม Location/FEFO และช่วยจัดบิลได้เอง',
                'ระดับ 3: มองภาพรวมการเติม คาดจุดขาด และสอนมาตรฐานการจัดร้านได้'
            ]
        },
        {
            code: 'W1_CHECKER', name: 'W1 Checker — ตรวจสินค้าตามบิล', category: 'storefront', icon: 'fa-clipboard-check',
            department: 'w1_front', critical: true,
            description: 'เป็น Quality Gate ตรวจสินค้า ยี่ห้อ ขนาด หน่วย จำนวน สภาพ และรายการในบิลก่อนส่งมอบ',
            levels: [
                'ระดับ 1: ช่วยตรวจบิลทั่วไปโดยมี Checker หลักกำกับ',
                'ระดับ 2: ตรวจบิลและหยุดรายการผิดปกติได้เองตามมาตรฐาน',
                'ระดับ 3: ตรวจงานซับซ้อน แยกสินค้าคล้ายกัน แก้เคสผิดปกติ และสอน Checker ได้'
            ]
        },

        // Outbound.
        {
            code: 'OUT_PICK', name: 'ขาออก — Picking ตามบิล', category: 'logistics', icon: 'fa-boxes-packing',
            department: 'outbound', critical: true,
            description: 'อ่านบิล รู้จักสินค้า หา Location และหยิบสินค้าขาออกได้ถูกต้อง',
            levels: [
                'ระดับ 1: Picking บิลทั่วไปโดยมีผู้ตรวจ',
                'ระดับ 2: Picking ตามบิลได้เองอย่างถูกต้องและรักษา FEFO',
                'ระดับ 3: จัดการบิลซับซ้อน ช่วยแก้ของหาไม่เจอ และสอนเส้นทาง Picking ได้'
            ]
        },
        {
            code: 'OUT_VERIFY', name: 'ขาออก — ตรวจนับและยืนยันสินค้า', category: 'logistics', icon: 'fa-list-check',
            department: 'outbound', critical: true,
            description: 'ตรวจสินค้าและจำนวนก่อนส่งออก ลดสินค้าขาด/เกิน/ผิดรายการ',
            levels: [
                'ระดับ 1: ช่วยตรวจจำนวนเมื่อมีผู้กำกับ',
                'ระดับ 2: ตรวจนับและยืนยันบิลขาออกได้เอง',
                'ระดับ 3: ตรวจงานซับซ้อน หาเหตุความต่าง และเป็นผู้ตรวจหลักได้'
            ]
        },
        {
            code: 'OUT_STAGE', name: 'ขาออก — จัดรอส่ง / Staging', category: 'logistics', icon: 'fa-layer-group',
            department: 'outbound', critical: false,
            description: 'แยกและจัดสินค้าตามบิล ลูกค้า หรือรอบส่งในพื้นที่รอส่งอย่างชัดเจน',
            levels: [
                'ระดับ 1: จัดสินค้าเข้าพื้นที่รอส่งตามคำแนะนำ',
                'ระดับ 2: แยกบิล/รอบส่งและจัดพื้นที่ Staging ได้เอง',
                'ระดับ 3: วาง Flow พื้นที่รอส่ง ลดของปน และสอนทีมได้'
            ]
        },
        {
            code: 'OUT_HANDOVER', name: 'ขาออก — ส่งมอบหน้าร้าน / ขึ้นรถลูกค้า', category: 'logistics', icon: 'fa-truck-loading',
            department: 'outbound', critical: true,
            description: 'ส่งมอบสินค้าให้หน้าร้านหรือขึ้นรถลูกค้าโดยตรวจปลายทาง จำนวน และความพร้อมก่อนจบงาน',
            levels: [
                'ระดับ 1: ช่วยส่งมอบตามคำสั่งและมีผู้ตรวจ',
                'ระดับ 2: ส่งมอบและยืนยันปลายทาง/จำนวนได้เอง',
                'ระดับ 3: คุมการส่งมอบหลายบิล แก้เคสผิดปกติ และสอนทีมได้'
            ]
        },

        // Inbound.
        {
            code: 'IN_DOC_FLOW', name: 'ขาเข้า — รับและส่งต่อเอกสาร Vendor', category: 'warehouse', icon: 'fa-file-import',
            department: 'inbound', critical: true,
            description: 'รับบิล/เอกสาร Vendor ตรวจข้อมูลพื้นฐาน และส่งให้หัวหน้างานตามขั้นตอน',
            levels: [
                'ระดับ 1: รู้ Flow เอกสารและส่งต่อได้เมื่อมีผู้แนะนำ',
                'ระดับ 2: ตรวจพื้นฐานและส่งเอกสารตามขั้นตอนได้เอง',
                'ระดับ 3: ตรวจความผิดปกติของเอกสาร ประสานแก้ไข และสอน Flow ได้'
            ]
        },
        {
            code: 'IN_RECEIVE_QC', name: 'ขาเข้า — ตรวจรับสินค้า Vendor', category: 'warehouse', icon: 'fa-truck-ramp-box',
            department: 'inbound', critical: true,
            description: 'ตรวจรายการ จำนวน สภาพ Lot/Expiry และแจ้งเมื่อสินค้าไม่ตรง ขาด เกิน หรือชำรุด',
            levels: [
                'ระดับ 1: ช่วยตรวจรับสินค้าทั่วไปโดยมีผู้ตรวจซ้ำ',
                'ระดับ 2: ตรวจรับ จำนวน สภาพ และ Lot ได้เองตามมาตรฐาน',
                'ระดับ 3: จัดการเคส discrepancy/ชำรุด ประสานหัวหน้า และสอนการตรวจรับได้'
            ]
        },
        {
            code: 'IN_SYSTEM', name: 'ขาเข้า — ลงรับสินค้าในระบบ', category: 'warehouse', icon: 'fa-computer',
            department: 'inbound', critical: true,
            description: 'ลงข้อมูลรับสินค้าให้รายการ จำนวน และข้อมูลอ้างอิงตรงกับของที่ตรวจรับจริง',
            levels: [
                'ระดับ 1: ลงรับรายการทั่วไปโดยมีผู้ตรวจ',
                'ระดับ 2: ลงรับในระบบได้เองและตรวจทานก่อนยืนยัน',
                'ระดับ 3: แก้เคสข้อมูลซับซ้อน ตรวจความต่าง และสอนการลงระบบได้'
            ]
        },
        {
            code: 'IN_PUTAWAY', name: 'ขาเข้า — จัดเก็บสินค้าเข้าคลัง', category: 'warehouse', icon: 'fa-warehouse',
            department: 'inbound', critical: true,
            description: 'นำสินค้าที่รับแล้วเข้าพื้นที่จัดเก็บที่ถูกต้อง โดยรักษา Location และ FEFO',
            levels: [
                'ระดับ 1: จัดเก็บตาม Location ที่กำหนดโดยมีผู้แนะนำ',
                'ระดับ 2: Putaway ได้เองและจัด Lot/FEFO ถูกต้อง',
                'ระดับ 3: วางแผน Putaway เมื่อพื้นที่จำกัด แก้ Location และสอนทีมได้'
            ]
        },
        {
            code: 'IN_SPACE_PREP', name: 'ขาเข้า — เตรียมพื้นที่ก่อน Vendor ลงสินค้า', category: 'warehouse', icon: 'fa-border-all',
            department: 'inbound', critical: false,
            description: 'จัดคลังและเตรียม Location/พื้นที่รับให้พร้อมก่อนสินค้ามาถึง ลดการวางชั่วคราวและของกีดขวาง',
            levels: [
                'ระดับ 1: เคลียร์พื้นที่ตามที่หัวหน้ากำหนด',
                'ระดับ 2: ประเมินพื้นที่และเตรียม Location ตามรายการที่จะเข้าได้เอง',
                'ระดับ 3: วางแผนพื้นที่รับหลาย Vendor/สินค้าปริมาณมาก และช่วยจัด Flow ได้'
            ]
        },

        // Inter-warehouse transfer.
        {
            code: 'TR_PICK', name: 'ขาย้าย — จัดรายการตามบิลเบิกย้าย', category: 'logistics', icon: 'fa-arrow-right-arrow-left',
            department: 'transfer', critical: true,
            description: 'อ่านบิลเบิกย้าย หา หยิบ และจัดสินค้าสำหรับย้ายระหว่างคลังให้ถูกต้อง',
            levels: [
                'ระดับ 1: จัดรายการย้ายทั่วไปโดยมีผู้ตรวจ',
                'ระดับ 2: จัดบิลย้ายและรักษา FEFO ได้เอง',
                'ระดับ 3: จัดงานย้ายซับซ้อน แก้ของไม่ครบ และสอนทีมได้'
            ]
        },
        {
            code: 'TR_HANDOVER', name: 'ขาย้าย — ส่งมอบและตรวจจำนวนระหว่างคลัง', category: 'logistics', icon: 'fa-people-carry-box',
            department: 'transfer', critical: true,
            description: 'ยืนยันจำนวนต้นทาง-ปลายทางให้ตรงกัน และแจ้งทันทีเมื่อจำนวนหรือรายการคลาดเคลื่อน',
            levels: [
                'ระดับ 1: ช่วยนับและส่งมอบโดยมีผู้กำกับ',
                'ระดับ 2: ตรวจและส่งมอบระหว่างคลังได้เอง',
                'ระดับ 3: คุมการส่งมอบหลายรอบ หาเหตุความต่าง และสอนทีมได้'
            ]
        },
        {
            code: 'TR_PUTAWAY', name: 'ขาย้าย — จัดเก็บสินค้าที่ปลายทาง', category: 'warehouse', icon: 'fa-box-archive',
            department: 'transfer', critical: true,
            description: 'นำสินค้าที่ย้ายมาจัดเก็บเข้าพื้นที่ถูกต้อง พร้อมรักษา Location และ FEFO',
            levels: [
                'ระดับ 1: จัดเก็บตามพื้นที่ที่กำหนดโดยมีผู้แนะนำ',
                'ระดับ 2: Putaway สินค้าย้ายได้เองและรักษา FEFO',
                'ระดับ 3: แก้ปัญหาพื้นที่ปลายทาง วางแผนจัดเก็บ และสอนทีมได้'
            ]
        },
        {
            code: 'TR_SPACE_PREP', name: 'ขาย้าย — เตรียมพื้นที่รับสินค้าย้าย', category: 'warehouse', icon: 'fa-border-none',
            department: 'transfer', critical: false,
            description: 'จัดพื้นที่และเตรียม Location ก่อนสินค้าย้ายมาถึงเพื่อให้รับและจัดเก็บได้ทันที',
            levels: [
                'ระดับ 1: เคลียร์พื้นที่ตามที่ได้รับมอบหมาย',
                'ระดับ 2: เตรียมพื้นที่ตามรายการและปริมาณที่จะย้ายได้เอง',
                'ระดับ 3: วางแผนพื้นที่สำหรับรอบย้ายใหญ่และช่วยปรับ Layout ได้'
            ]
        },

        // W1 warehouse.
        {
            code: 'WH1_STOCK_COUNT', name: 'คลัง W1 — ตรวจนับสต๊อก', category: 'warehouse', icon: 'fa-clipboard-list',
            department: 'w1_warehouse', critical: true,
            description: 'ตรวจนับ Stock ตาม Location/รายการ บันทึกผล และแจ้งเมื่อพบความคลาดเคลื่อน',
            levels: [
                'ระดับ 1: นับ Stock ตามรายการโดยมีผู้ตรวจซ้ำ',
                'ระดับ 2: นับและบันทึก Stock ได้เองอย่างเป็นระบบ',
                'ระดับ 3: คุม Cycle Count ไล่หาสาเหตุความต่างเบื้องต้น และตรวจงานทีมได้'
            ]
        },
        {
            code: 'WH1_REPLENISH_REQ', name: 'คลัง W1 — เบิกสินค้าเพื่อเติมคลัง', category: 'warehouse', icon: 'fa-file-circle-plus',
            department: 'w1_warehouse', critical: true,
            description: 'ตรวจความต้องการเติมและเบิกสินค้าในระบบเพื่อให้คลังต้นทางนำมาเติมได้ถูกต้อง',
            levels: [
                'ระดับ 1: ทำรายการเบิกตามที่หัวหน้ากำหนด',
                'ระดับ 2: ดู Stock และสร้างรายการเบิกเติมได้เองตามหลักที่กำหนด',
                'ระดับ 3: วางแผนรอบเติม ตรวจความผิดปกติ และสอนการเบิกเติมได้'
            ]
        },
        {
            code: 'WH1_PUTAWAY', name: 'คลัง W1 — หยิบยกและจัดเก็บสินค้า', category: 'warehouse', icon: 'fa-cubes-stacked',
            department: 'w1_warehouse', critical: true,
            description: 'หยิบยกและจัดเก็บสินค้าเข้าพื้นที่ W1 ให้ถูก Location ปลอดภัย และรักษา FEFO',
            levels: [
                'ระดับ 1: จัดเก็บตามจุดที่กำหนดโดยมีผู้แนะนำ',
                'ระดับ 2: จัดเก็บได้เอง ถูก Location และ FEFO',
                'ระดับ 3: แก้พื้นที่ซ้อน/เต็ม ปรับการจัดเก็บ และสอนทีมได้'
            ]
        },
        {
            code: 'WH1_STOCK_CTRL', name: 'คลัง W1 — ควบคุม Stock และความผิดปกติ', category: 'warehouse', icon: 'fa-chart-column',
            department: 'w1_warehouse', critical: false,
            description: 'มองเห็น Stock ต่ำ จำนวนผิด Location ผิด หรือ Lot เสี่ยง และดำเนินการแจ้ง/ตรวจสอบตามขั้นตอน',
            levels: [
                'ระดับ 1: สังเกตและแจ้งความผิดปกติพื้นฐานได้',
                'ระดับ 2: ตรวจซ้ำและเก็บข้อมูลเพื่อส่งต่อปัญหาได้เอง',
                'ระดับ 3: ไล่ Movement/สาเหตุเบื้องต้น เสนอการแก้ และสอนทีมได้'
            ]
        }
    ];

    const DEPARTMENTS = [
        {
            id: 'w1_front', name: 'W1 หน้าร้าน / เคาน์เตอร์', icon: 'fa-store',
            mission: 'รับ Order เปิดบิล เตรียม ตรวจ และส่งมอบสินค้าให้ลูกค้าอย่างถูกต้อง',
            duties: ['แคชเชียร์เปิดบิล รับเงิน ทอนเงิน และดูแลเงินในกะ', 'แอดมินตอบลูกค้า รับ Order และเปิดบิล', 'หน้าร้านจัดบิล หยิบสินค้า และช่วย Checker', 'พนักงานในร้านเติมสินค้า/หยิบของย่อย/จัดบิล', 'Checker ตรวจสินค้าในบิลให้ถูกต้องก่อนส่งมอบ'],
            roles: [
                { id: 'w1_cashier', name: 'แคชเชียร์', requirements: { FND_PRODUCT: 1, FND_BILL_READ: 2, FND_REPORT: 2, W1_POS: 2, W1_CASH_CTRL: 2 } },
                { id: 'w1_admin', name: 'แอดมิน', requirements: { FND_PRODUCT: 2, FND_BILL_READ: 2, FND_REPORT: 2, W1_ADMIN_ORDER: 2 } },
                { id: 'w1_front_staff', name: 'พนักงานหน้าร้าน', requirements: { FND_PRODUCT: 2, FND_BILL_READ: 2, FND_COUNT: 2, FND_LOCATION: 2, FND_HANDLING: 2, W1_FRONT_PICK: 2 } },
                { id: 'w1_store_staff', name: 'พนักงานในร้าน', requirements: { FND_PRODUCT: 2, FND_LOCATION: 2, FND_FEFO: 2, FND_HANDLING: 2, FND_5S: 2, W1_REPLENISH: 2 } },
                { id: 'w1_checker', name: 'Checker', requirements: { FND_PRODUCT: 3, FND_BILL_READ: 3, FND_COUNT: 3, FND_FEFO: 2, FND_REPORT: 2, W1_CHECKER: 3 } }
            ]
        },
        {
            id: 'outbound', name: 'ขาออก', icon: 'fa-truck-fast',
            mission: 'จัดสินค้าให้ถูกต้อง ครบ และส่งมอบถูกปลายทาง',
            duties: ['อ่านบิลและรู้จักสินค้า', 'จัด/หยิบยกสินค้าตามบิล', 'ตรวจนับจำนวนสินค้า', 'ส่งสินค้าให้หน้าร้านหรือขึ้นรถลูกค้า'],
            roles: [
                { id: 'outbound_operator', name: 'พนักงานขาออก', requirements: { FND_PRODUCT: 2, FND_BILL_READ: 2, FND_COUNT: 2, FND_FEFO: 2, FND_HANDLING: 2, FND_REPORT: 2, OUT_PICK: 2, OUT_VERIFY: 2, OUT_STAGE: 2, OUT_HANDOVER: 2 } }
            ]
        },
        {
            id: 'inbound', name: 'ขาเข้า', icon: 'fa-truck-ramp-box',
            mission: 'รับสินค้าเข้าให้จำนวน ข้อมูล Lot และการจัดเก็บถูกต้อง',
            duties: ['รับบิลและส่งบิลให้หัวหน้างานตามขั้นตอน', 'ตรวจนับและเช็กรายการ', 'ลงรับในระบบ', 'จัดเก็บสินค้าที่ Vendor มาลง', 'เตรียมพื้นที่ก่อนรับสินค้า', 'ดู FEFO และความผิดปกติของสินค้า'],
            roles: [
                { id: 'inbound_operator', name: 'พนักงานขาเข้า', requirements: { FND_PRODUCT: 2, FND_BILL_READ: 2, FND_COUNT: 2, FND_FEFO: 3, FND_HANDLING: 2, FND_REPORT: 2, IN_DOC_FLOW: 2, IN_RECEIVE_QC: 2, IN_SYSTEM: 2, IN_PUTAWAY: 2, IN_SPACE_PREP: 2 } }
            ]
        },
        {
            id: 'transfer', name: 'ขาย้าย', icon: 'fa-arrow-right-arrow-left',
            mission: 'ย้าย Stock ระหว่างคลังให้ถูกสินค้า ถูกจำนวน และปลายทางรับครบ',
            duties: ['จัดรายการตามบิลเบิกย้าย', 'หยิบยกและเคลื่อนย้ายสินค้า', 'ส่งมอบ/ตรวจจำนวนระหว่างคลัง', 'เตรียมพื้นที่ปลายทาง', 'จัดเก็บและรักษา FEFO'],
            roles: [
                { id: 'transfer_operator', name: 'พนักงานขาย้าย', requirements: { FND_PRODUCT: 2, FND_BILL_READ: 2, FND_COUNT: 2, FND_FEFO: 2, FND_HANDLING: 2, FND_REPORT: 2, TR_PICK: 2, TR_HANDOVER: 2, TR_PUTAWAY: 2, TR_SPACE_PREP: 2 } }
            ]
        },
        {
            id: 'w1_warehouse', name: 'คลัง W1', icon: 'fa-warehouse',
            mission: 'รักษา Stock W1 ให้พร้อมใช้ ถูก Location ถูกจำนวน และหมุนสินค้าอย่างถูกต้อง',
            duties: ['ตรวจนับ Stock', 'เบิกสินค้าในระบบเพื่อให้คลังนำมาเติม', 'หยิบยกและจัดเก็บสินค้า', 'ดูแลความสะอาดและความเรียบร้อย', 'ดูแล FEFO และแจ้ง Stock ผิดปกติ'],
            roles: [
                { id: 'w1_warehouse_operator', name: 'พนักงานคลัง W1', requirements: { FND_PRODUCT: 2, FND_COUNT: 2, FND_LOCATION: 2, FND_FEFO: 3, FND_HANDLING: 2, FND_5S: 2, FND_REPORT: 2, WH1_STOCK_COUNT: 2, WH1_REPLENISH_REQ: 2, WH1_PUTAWAY: 2, WH1_STOCK_CTRL: 1 } },
                { id: 'w1_warehouse_senior', name: 'Senior คลัง W1', requirements: { FND_PRODUCT: 3, FND_COUNT: 3, FND_LOCATION: 3, FND_FEFO: 3, FND_HANDLING: 2, FND_5S: 3, FND_REPORT: 3, WH1_STOCK_COUNT: 3, WH1_REPLENISH_REQ: 3, WH1_PUTAWAY: 3, WH1_STOCK_CTRL: 3 } }
            ]
        }
    ];

    const SKILL_MAP = new Map(SKILLS.map(skill => [skill.code, skill]));
    const ROLE_MAP = new Map();
    DEPARTMENTS.forEach(dept => dept.roles.forEach(role => ROLE_MAP.set(role.id, { ...role, departmentId: dept.id, departmentName: dept.name })));

    function getEmployeeCertMap(certifications, employeeUid, employeeName) {
        const uid = String(employeeUid || '').trim().toLowerCase();
        const name = String(employeeName || '').trim().toLowerCase();
        const map = new Map();
        (Array.isArray(certifications) ? certifications : []).forEach(cert => {
            const certUid = String(cert.employeeUid || '').trim().toLowerCase();
            const certName = String(cert.employeeName || '').trim().toLowerCase();
            if ((uid && certUid === uid) || (name && certName === name)) {
                const current = map.get(cert.skillCode);
                if (!current || Number(cert.level || 0) > Number(current.level || 0)) map.set(cert.skillCode, cert);
            }
        });
        return map;
    }

    function calculateRoleReadiness(certifications, employeeUid, employeeName, roleId) {
        const role = ROLE_MAP.get(roleId);
        if (!role) return null;
        const certMap = getEmployeeCertMap(certifications, employeeUid, employeeName);
        const entries = Object.entries(role.requirements || {}).map(([skillCode, requiredLevel]) => {
            const cert = certMap.get(skillCode);
            const currentLevel = Math.max(0, Math.min(3, Number(cert?.level || 0)));
            const skill = SKILL_MAP.get(skillCode) || { code: skillCode, name: skillCode, critical: false };
            return {
                skillCode,
                skillName: skill.name,
                critical: !!skill.critical,
                currentLevel,
                requiredLevel,
                met: currentLevel >= requiredLevel,
                gap: Math.max(0, requiredLevel - currentLevel)
            };
        });
        const met = entries.filter(item => item.met).length;
        const certified = entries.filter(item => item.currentLevel > 0).length;
        const required = entries.length;
        const status = required > 0 && met === required ? 'qualified' : (certified > 0 ? 'training' : 'not_trained');
        return {
            roleId,
            roleName: role.name,
            departmentId: role.departmentId,
            departmentName: role.departmentName,
            status,
            met,
            required,
            coveragePct: required ? Math.round((met / required) * 100) : 0,
            entries,
            gaps: entries.filter(item => !item.met).sort((a, b) => b.gap - a.gap || Number(b.critical) - Number(a.critical))
        };
    }

    function calculateEmployeeReadiness(certifications, employeeUid, employeeName) {
        return Array.from(ROLE_MAP.keys()).map(roleId => calculateRoleReadiness(certifications, employeeUid, employeeName, roleId));
    }

    function getPersistableSkill(skill) {
        return {
            code: skill.code,
            name: skill.name,
            category: skill.category,
            icon: skill.icon,
            description: skill.description,
            levels: skill.levels.slice(0, 3),
            isActive: true
        };
    }

    function statusBadge(status) {
        if (status === 'qualified') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">พร้อมทำงาน (Qualified)</span>';
        if (status === 'training') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">กำลังฝึก (Training)</span>';
        return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-200">ยังไม่ได้ฝึก</span>';
    }

    function ensureBlueprintSection() {
        if (typeof document === 'undefined') return;
        const panel = document.getElementById('admin-panel-skills');
        if (!panel || document.getElementById('store-skill-blueprint-section')) return;
        const section = document.createElement('div');
        section.id = 'store-skill-blueprint-section';
        section.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4';
        section.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                    <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-sitemap text-indigo-600"></i><span>โครงสร้างทักษะตามงานจริงของร้าน</span></h3>
                    <p class="text-xs text-slate-500 mt-1">Foundation + W1 หน้าร้าน + ขาออก + ขาเข้า + ขาย้าย + คลัง W1 • Lv.0 คือยังไม่ได้รับรอง และใช้ Certification เดิม Lv.1–3</p>
                </div>
                <button type="button" id="btn-sync-store-skill-blueprint" class="py-2.5 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs shadow flex items-center justify-center gap-1.5 transition-all shrink-0">
                    <i class="fa-solid fa-arrows-rotate"></i><span>ซิงก์ชุดทักษะร้าน</span>
                </button>
            </div>
            <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                <strong>หลักการ:</strong> Lv.2 = ทำงานตำแหน่งนั้นได้ด้วยตัวเอง, Lv.3 = ชำนาญ/ตรวจงาน/สอนคนอื่นได้ และ Incident ไม่ลด Skill อัตโนมัติ
            </div>
            <div id="store-skill-department-grid" class="grid grid-cols-1 md:grid-cols-2 gap-3"></div>
        `;
        panel.insertBefore(section, panel.firstChild);
        const syncBtn = document.getElementById('btn-sync-store-skill-blueprint');
        if (syncBtn) syncBtn.addEventListener('click', syncCatalogToExistingSystem);
        renderDepartmentBlueprint();
    }

    function renderDepartmentBlueprint() {
        if (typeof document === 'undefined') return;
        const container = document.getElementById('store-skill-department-grid');
        if (!container) return;
        container.innerHTML = DEPARTMENTS.map(dept => `
            <article class="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                <div class="flex items-center gap-2">
                    <span class="w-8 h-8 rounded-xl bg-white border border-slate-200 text-indigo-600 flex items-center justify-center"><i class="fa-solid ${dept.icon}"></i></span>
                    <div><h4 class="text-xs font-black text-slate-900">${dept.name}</h4><p class="text-[11px] text-slate-500">${dept.mission}</p></div>
                </div>
                <ul class="list-disc pl-5 text-[11px] text-slate-600 space-y-1">${dept.duties.map(duty => `<li>${duty}</li>`).join('')}</ul>
                <div class="flex flex-wrap gap-1.5 pt-1">${dept.roles.map(role => `<span class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-700">${role.name}</span>`).join('')}</div>
            </article>
        `).join('');
    }

    function ensureReadinessSection() {
        if (typeof document === 'undefined') return;
        const panel = document.getElementById('admin-panel-skills');
        if (!panel || document.getElementById('store-skill-readiness-section')) return;
        const section = document.createElement('div');
        section.id = 'store-skill-readiness-section';
        section.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3';
        section.innerHTML = `
            <div class="border-b border-slate-100 pb-2.5">
                <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-user-check text-emerald-600"></i><span>ความพร้อมทำงานตามตำแหน่ง (Role Readiness)</span></h3>
                <p class="text-xs text-slate-500 mt-1">ใช้ Certification ที่มีอยู่แล้วเทียบกับ Required Level ของแต่ละตำแหน่ง เพื่อดู Skill Gap โดยไม่เพิ่มฟอร์มกรอกให้พนักงาน</p>
            </div>
            <div id="store-skill-readiness-content"></div>
        `;
        panel.appendChild(section);
        const empSelect = document.getElementById('admin-skill-emp-select');
        if (empSelect && !empSelect.dataset.storeSkillBound) {
            empSelect.dataset.storeSkillBound = '1';
            empSelect.addEventListener('change', renderSelectedEmployeeReadiness);
        }
        renderSelectedEmployeeReadiness();
    }

    function renderSelectedEmployeeReadiness() {
        if (typeof document === 'undefined') return;
        const target = document.getElementById('store-skill-readiness-content');
        const empSelect = document.getElementById('admin-skill-emp-select');
        if (!target || !empSelect) return;
        const employeeUid = String(empSelect.value || '').trim();
        const employees = typeof GLOBAL_CONFIG_LIST !== 'undefined' && Array.isArray(GLOBAL_CONFIG_LIST) ? GLOBAL_CONFIG_LIST : [];
        const emp = employees.find(item => String(item.uid || item.name) === employeeUid) || {};
        const employeeName = emp.name || employeeUid || 'พนักงาน';
        const certs = typeof GLOBAL_EMPLOYEE_SKILLS !== 'undefined' && Array.isArray(GLOBAL_EMPLOYEE_SKILLS) ? GLOBAL_EMPLOYEE_SKILLS : [];
        const readiness = calculateEmployeeReadiness(certs, employeeUid, employeeName);

        target.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-3">
                <div><p class="text-xs font-black text-slate-900">${employeeName}</p><p class="text-[11px] text-slate-500">ดูว่าแผนก/ตำแหน่งไหนทำแทนได้ และควรฝึกอะไรต่อ</p></div>
                <span class="text-[10px] font-bold text-slate-500">Blueprint ${BLUEPRINT_VERSION}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                ${readiness.map(item => {
                    const gaps = item.gaps.slice(0, 3).map(gap => `<li>${gap.skillName}: Lv.${gap.currentLevel} → Lv.${gap.requiredLevel}</li>`).join('');
                    return `<article class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div class="flex items-start justify-between gap-2"><div><p class="text-xs font-black text-slate-900">${item.roleName}</p><p class="text-[10px] text-slate-500">${item.departmentName}</p></div>${statusBadge(item.status)}</div>
                        <div class="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${item.coveragePct}%"></div></div>
                        <div class="mt-1 flex justify-between text-[10px] font-bold text-slate-500"><span>ผ่าน ${item.met}/${item.required} Skill</span><span>${item.coveragePct}%</span></div>
                        ${gaps ? `<div class="mt-2 rounded-lg bg-white border border-slate-200 p-2"><p class="text-[10px] font-black text-amber-700">Next Skill Gap</p><ul class="mt-1 list-disc pl-4 text-[10px] text-slate-600 space-y-0.5">${gaps}</ul></div>` : '<p class="mt-2 text-[10px] font-bold text-emerald-700">✓ ผ่าน Required Level ครบแล้ว</p>'}
                    </article>`;
                }).join('')}
            </div>
        `;
    }

    async function syncCatalogToExistingSystem() {
        if (typeof document === 'undefined') return;
        const token = typeof sessionToken !== 'undefined' ? sessionToken : null;
        const isAdmin = typeof IS_ADMIN !== 'undefined' ? IS_ADMIN : false;
        if (!token || !isAdmin || !root.AkraSupabaseKPI?.saveSkillCatalogItem) {
            if (typeof showToast === 'function') showToast('ต้องการสิทธิ์ Admin เพื่อซิงก์ชุดทักษะร้าน', true);
            return;
        }
        if (!root.confirm(`ซิงก์ Store Skill Blueprint จำนวน ${SKILLS.length} ทักษะเข้ากับ Skill Catalog เดิมหรือไม่?\n\nระบบจะเพิ่ม/อัปเดตตาม Code เดิม และจะไม่ลบทักษะเดิมหรือ Certification ของพนักงาน`)) return;

        const btn = document.getElementById('btn-sync-store-skill-blueprint');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>กำลังซิงก์ 0/' + SKILLS.length + '</span>';
        }
        try {
            let lastSkills = null;
            for (let index = 0; index < SKILLS.length; index += 1) {
                const result = await root.AkraSupabaseKPI.saveSkillCatalogItem(token, getPersistableSkill(SKILLS[index]));
                if (Array.isArray(result?.skills)) lastSkills = result.skills;
                if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>กำลังซิงก์ ${index + 1}/${SKILLS.length}</span>`;
            }
            if (lastSkills && typeof GLOBAL_SKILL_CATALOG !== 'undefined') GLOBAL_SKILL_CATALOG = lastSkills;
            if (typeof renderAdminSkillsSettings === 'function') renderAdminSkillsSettings();
            renderDepartmentBlueprint();
            renderSelectedEmployeeReadiness();
            if (typeof showToast === 'function') showToast(`ซิงก์ชุดทักษะร้าน ${SKILLS.length} รายการสำเร็จแล้ว`);
        } catch (error) {
            console.error('[Store Skill Matrix] sync failed:', error);
            if (typeof showToast === 'function') showToast('ซิงก์ Skill Blueprint ไม่สำเร็จ: ' + (error?.message || ''), true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><span>ซิงก์ชุดทักษะร้าน</span>';
            }
        }
    }

    let installed = false;
    function install() {
        if (installed || typeof document === 'undefined') return false;
        const panel = document.getElementById('admin-panel-skills');
        if (!panel) return false;
        installed = true;
        ensureBlueprintSection();
        ensureReadinessSection();

        const originalRender = typeof root.renderAdminSkillsSettings === 'function' ? root.renderAdminSkillsSettings : null;
        if (originalRender && !originalRender.__storeSkillWrapped) {
            const wrapped = function (...args) {
                const value = originalRender.apply(this, args);
                root.setTimeout(() => {
                    ensureBlueprintSection();
                    ensureReadinessSection();
                    renderDepartmentBlueprint();
                    renderSelectedEmployeeReadiness();
                }, 0);
                return value;
            };
            wrapped.__storeSkillWrapped = true;
            root.renderAdminSkillsSettings = wrapped;
        }
        return true;
    }

    function autoInstall() {
        if (typeof document === 'undefined') return;
        const tryInstall = () => {
            if (install()) return;
            let attempts = 0;
            const timer = root.setInterval(() => {
                attempts += 1;
                if (install() || attempts >= 40) root.clearInterval(timer);
            }, 250);
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryInstall, { once: true });
        else tryInstall();
    }

    return {
        BLUEPRINT_VERSION,
        LEVEL_LABELS,
        SKILLS,
        DEPARTMENTS,
        calculateRoleReadiness,
        calculateEmployeeReadiness,
        getPersistableSkill,
        syncCatalogToExistingSystem,
        install,
        autoInstall
    };
}));
