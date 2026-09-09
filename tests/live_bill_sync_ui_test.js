const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('=== Running Live Bill Sync UI & Details Restoration Test ===');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../version.json'), 'utf8'));

// [1] Syntax Verification: Parse all inline scripts
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let scriptIndex = 0;
let match;
while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1].trim();
    if (!scriptContent) continue;
    assert.doesNotThrow(() => {
        new vm.Script(scriptContent, { filename: `inline-script-${++scriptIndex}.js` });
    }, `Inline script ${scriptIndex} must compile cleanly`);
}
assert.ok(scriptIndex > 0, 'Must have inline scripts');
console.log(`✓ Script compilation passed (zero syntax errors across ${scriptIndex} scripts)`);

// [2] Version Parity Verification
const versionMatch = html.match(/const CURRENT_VERSION = ["']([^"']+)["'];/);
assert.ok(versionMatch, 'CURRENT_VERSION must be defined');
assert.strictEqual(versionMatch[1], versionJson.version, 'CURRENT_VERSION must match version.json');
assert.strictEqual(versionJson.version, '20260909.06', 'version.json must be 20260909.06');
assert.ok(html.includes(`KPI Suite v${versionJson.version}`), 'Drawer version text must match version.json');
assert.ok(html.includes(`js/supabase-kpi-client.js?v=${versionJson.version}`), 'supabase-kpi-client asset param must match version');
assert.ok(html.includes(`js/incident-impact.js?v=${versionJson.version}`), 'incident-impact asset param must match version');
console.log(`✓ Version parity verified: ${versionJson.version}`);

// [3] DOM Elements Verification in static HTML
const requiredElementIds = [
    'live-bill-count',
    'live-sku-count',
    'live-unit-count',
    'live-trd-count',
    'live-urgent-count',
    'live-regular-count',
    'live-bill-read-state',
    'live-bill-search',
    'live-bill-filtered-badge',
    'live-bill-filter-tabs',
    'live-bill-list-cards'
];
for (const id of requiredElementIds) {
    assert.ok(html.includes(`id="${id}"`), `HTML must contain element #${id}`);
}
console.log('✓ All 11 required Live Bill Sync DOM IDs present in markup');

// [4] Functional Controller Test in VM Context
const controller = html.slice(
    html.indexOf('        const LINE_REQUISITION_API_URL'),
    html.indexOf('        function applyAkraWorkloadDraft')
);

const domStore = new Map();
function createNode(id) {
    return {
        id,
        innerText: '',
        innerHTML: '',
        value: '',
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
        },
        getAttribute(a) { return ''; },
        setAttribute(a, v) {}
    };
}

for (const id of requiredElementIds) {
    domStore.set(id, createNode(id));
}

const sandbox = {
    document: {
        getElementById: id => domStore.get(id) || null,
        querySelectorAll: selector => []
    },
    console: { warn() {} },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    fetch: () => Promise.resolve({ ok: true, json: async () => ({ success: true, requisitions: [] }) })
};

vm.createContext(sandbox);
vm.runInContext(controller, sandbox);

// 4.0 Direct classifyRequisition unit tests
assert.strictEqual(typeof sandbox.classifyRequisition, 'function', 'classifyRequisition must be a function');
assert.strictEqual(sandbox.classifyRequisition({ billType: '⚡ บิลด่วน' }).key, 'urgent');
assert.strictEqual(sandbox.classifyRequisition({ itemsSummary: 'เบิกด่วน 1 รายการ' }).key, 'urgent');
assert.strictEqual(sandbox.classifyRequisition({ itemsSummary: '📘เบิกสินค้า(บิลจัด) 1 รายการ, จัดเตรียมไว้ก่อน' }).key, 'staged');
assert.strictEqual(sandbox.classifyRequisition({ rawText: 'เตรียมสินค้าไว้ก่อน พรุ่งนี้เช้า' }).key, 'staged');
assert.strictEqual(sandbox.classifyRequisition({ billType: '🏪 เติมหน้าร้าน TRD', itemsSummary: 'เติมเรียงหน้าร้าน' }).key, 'store');
assert.strictEqual(sandbox.classifyRequisition({}).key, 'store');
console.log('✓ Direct classifyRequisition classification rules verified');

// 4.1 Sample data with the 3 operational categories
const mockRequisitions = [
    {
        uid: 'REQ-001',
        billNo: '#1',
        time: '08:12 น.',
        billType: '⚡ บิลด่วน',
        requester: 'หน้าร้าน TRD',
        itemsSummary: '📕เบิกสินค้า(บิลด่วน) 1 รายการ, กิเลนเหลือง 3 กส.ใส่ถุง 1 รายการ, ว่าว(22) 2 กส.ใส่ถุง 1 รายการ',
        skuCount: 3,
        totalUnits: 5,
        rawText: 'LINE raw text 001'
    },
    {
        uid: 'REQ-002',
        billNo: '#2',
        time: '08:34 น.',
        billType: '🏪 เติมหน้าร้าน TRD',
        requester: 'หน้าร้าน TRD',
        itemsSummary: '📘เบิกสินค้า(บิลจัด) 1 รายการ, ทาร์ตไข่206 : 1 ลัง, อลาวรี่ย์เค็ม(1) 6 กล่อง, 🆗จัดเตรียมไว้ก่อน❗ 1 รายการ',
        skuCount: 4,
        totalUnits: 7,
        rawText: 'LINE raw text 002'
    },
    {
        uid: 'REQ-003',
        billNo: '#3',
        time: '09:00 น.',
        billType: '🏪 เติมหน้าร้าน TRD',
        requester: 'ฝ่ายขาย',
        itemsSummary: 'เนยสด 10 ลัง, เบิกเรียงของหน้าร้าน @PeTer',
        skuCount: 2,
        totalUnits: 10,
        rawText: 'LINE raw text 003'
    },
    // Duplicate UID to verify deduplication
    {
        uid: 'REQ-001',
        billNo: '#1',
        time: '08:12 น.',
        billType: '⚡ บิลด่วน',
        requester: 'หน้าร้าน TRD',
        itemsSummary: 'duplicate',
        skuCount: 3,
        totalUnits: 5
    }
];

sandbox.mockRequisitions = mockRequisitions;
vm.runInContext(`liveRequisitionsList = mockRequisitions; renderLiveRequisitions();`, sandbox);

// Verify Summary Statistics Banner
const totalBills = domStore.get('live-bill-count').innerText;
const totalSKU = domStore.get('live-sku-count').innerText;
const totalUnits = domStore.get('live-unit-count').innerText;
const trdBreakdown = domStore.get('live-trd-count').innerText;
const urgentBreakdown = domStore.get('live-urgent-count').innerText;
const regularBreakdown = domStore.get('live-regular-count').innerText;

assert.strictEqual(totalBills, '3', 'Total unique bills must be 3');
assert.strictEqual(totalSKU, '9', 'Total SKU must be 3 + 4 + 2 = 9');
assert.strictEqual(totalUnits, '22', 'Total units must be 5 + 7 + 10 = 22');
assert.ok(urgentBreakdown.includes('1 บิล (5 ชิ้น)'), `Urgent breakdown must match: ${urgentBreakdown}`);
assert.ok(trdBreakdown.includes('1 บิล (7 ชิ้น)'), `Staged breakdown must match: ${trdBreakdown}`);
assert.ok(regularBreakdown.includes('1 บิล (10 ชิ้น)'), `Store breakdown must match: ${regularBreakdown}`);
console.log('✓ Summary statistics computation and 3-category breakdown verified');

// Verify Cards Rendering
const cardsHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(cardsHtml.includes('#1'), 'Must include bill #1');
assert.ok(cardsHtml.includes('#2'), 'Must include bill #2');
assert.ok(cardsHtml.includes('#3'), 'Must include bill #3');
assert.ok(cardsHtml.includes('1. บิลด่วน / เบิกด่วน'), 'Must include category 1 label for bill #1');
assert.ok(cardsHtml.includes('2. บิลจัด / เตรียมสินค้าไว้ก่อน'), 'Must include category 2 label for bill #2');
assert.ok(cardsHtml.includes('3. บิลเบิกเรียงของหน้าร้าน'), 'Must include category 3 label for bill #3');
assert.ok(cardsHtml.includes('3 SKU'), 'Must include SKU badge for bill 1');
assert.ok(cardsHtml.includes('5 ชิ้น'), 'Must include units badge for bill 1');
assert.ok(cardsHtml.includes('4 SKU'), 'Must include SKU badge for bill 2');
assert.ok(cardsHtml.includes('7 ชิ้น'), 'Must include units badge for bill 2');
assert.ok(cardsHtml.includes('ทาร์ตไข่206 : 1 ลัง'), 'Must render item pill for ทาร์ตไข่206');
assert.ok(cardsHtml.includes('จัดเตรียมไว้ก่อน'), 'Must render instruction badge');
assert.ok(cardsHtml.includes('LINE raw text 001'), 'Must include rawText in details');
assert.ok(!cardsHtml.includes('จัดเสร็จแล้ว') && !cardsHtml.includes('รอจัดสินค้า'), 'Must NOT track or render completion statuses');
console.log('✓ Cards rendering with 3-category titles, SKU, units, item pills, and instruction badges verified');

// Verify Filtering by category
sandbox.setLiveBillFilter('urgent');
const urgentHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(urgentHtml.includes('#1'), 'Urgent filter must include bill #1');
assert.ok(!urgentHtml.includes('#2'), 'Urgent filter must NOT include bill #2');
assert.ok(!urgentHtml.includes('#3'), 'Urgent filter must NOT include bill #3');

sandbox.setLiveBillFilter('staged');
const stagedHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(stagedHtml.includes('#2'), 'Staged filter must include bill #2');
assert.ok(!stagedHtml.includes('#1'), 'Staged filter must NOT include bill #1');
assert.ok(!stagedHtml.includes('#3'), 'Staged filter must NOT include bill #3');

sandbox.setLiveBillFilter('trd'); // Backward compatibility alias
assert.strictEqual(stagedHtml, domStore.get('live-bill-list-cards').innerHTML, 'trd alias must match staged filter');

sandbox.setLiveBillFilter('store');
const storeHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(storeHtml.includes('#3'), 'Store filter must include bill #3');
assert.ok(!storeHtml.includes('#1'), 'Store filter must NOT include bill #1');
assert.ok(!storeHtml.includes('#2'), 'Store filter must NOT include bill #2');

sandbox.setLiveBillFilter('regular'); // Backward compatibility alias
assert.strictEqual(storeHtml, domStore.get('live-bill-list-cards').innerHTML, 'regular alias must match store filter');

sandbox.setLiveBillFilter('all');
const allHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(allHtml.includes('#1') && allHtml.includes('#2') && allHtml.includes('#3'), 'All filter must include all bills');
console.log('✓ Category filters (urgent, staged, store, all, aliases) verified');

// Verify Search input
domStore.get('live-bill-search').value = 'ทาร์ตไข่';
sandbox.filterLiveRequisitions();
const searchHtml = domStore.get('live-bill-list-cards').innerHTML;
assert.ok(searchHtml.includes('#2'), 'Search for ทาร์ตไข่ must show bill #2');
assert.ok(!searchHtml.includes('#1'), 'Search for ทาร์ตไข่ must NOT show bill #1');

domStore.get('live-bill-search').value = '';
sandbox.filterLiveRequisitions();

// Verify Empty and Error states
sandbox.renderLiveRequisitions('loading');
assert.strictEqual(domStore.get('live-bill-count').innerText, '—');
assert.strictEqual(domStore.get('live-sku-count').innerText, '—');

sandbox.renderLiveRequisitions('error');
assert.strictEqual(domStore.get('live-bill-count').innerText, '—');
assert.ok(domStore.get('live-bill-read-state').innerText.includes('ไม่สำเร็จ'));

vm.runInContext(`liveRequisitionsList = []; renderLiveRequisitions('ready');`, sandbox);
assert.strictEqual(domStore.get('live-bill-count').innerText, '0');
assert.strictEqual(domStore.get('live-sku-count').innerText, '0');
assert.strictEqual(domStore.get('live-unit-count').innerText, '0');

console.log('✓ Loading, error, and empty states verified');

// [5] Supabase Client Integration & Async Fetch Tests
const kpiClient = require('../js/supabase-kpi-client.js');
assert.strictEqual(typeof kpiClient.getLiveRequisitions, 'function', 'AkraSupabaseKPI must export getLiveRequisitions');
console.log('✓ AkraSupabaseKPI.getLiveRequisitions export verified');

// Test fetchLiveRequisitions using AkraSupabaseKPI
let supabaseCalledWithDate = null;
sandbox.AkraSupabaseKPI = {
    getLiveRequisitions: async (date) => {
        supabaseCalledWithDate = date;
        return {
            success: true,
            date: date,
            requisitions: [
                {
                    uid: 'REQ-SP-001',
                    billNo: '#1',
                    time: '08:00',
                    billType: '⚡ บิลด่วน',
                    itemsSummary: 'Supabase item 1',
                    skuCount: 1,
                    totalUnits: 3
                }
            ]
        };
    }
};

(async () => {
    await sandbox.fetchLiveRequisitions('2026-09-09');
    assert.strictEqual(supabaseCalledWithDate, '2026-09-09', 'fetchLiveRequisitions must route through AkraSupabaseKPI');
    assert.strictEqual(domStore.get('live-bill-count').innerText, '1');
    assert.strictEqual(domStore.get('live-sku-count').innerText, '1');
    assert.strictEqual(domStore.get('live-unit-count').innerText, '3');
    console.log('✓ fetchLiveRequisitions routed through Supabase client with verified DOM rendering');

    // Test fallback to fetch when AkraSupabaseKPI is undefined
    sandbox.AkraSupabaseKPI = undefined;
    let fetchFallbackUrl = null;
    sandbox.fetch = async (url) => {
        fetchFallbackUrl = url;
        return {
            ok: true,
            json: async () => ({
                success: true,
                date: '2026-09-09',
                requisitions: [
                    {
                        uid: 'REQ-FB-001',
                        billNo: '#1',
                        time: '09:00',
                        billType: '🏪 เติมหน้าร้าน TRD',
                        itemsSummary: 'Fallback item',
                        skuCount: 2,
                        totalUnits: 4
                    }
                ]
            })
        };
    };
    await sandbox.fetchLiveRequisitions('2026-09-09');
    assert.ok(fetchFallbackUrl.includes('date=2026-09-09'), 'Fallback must query LINE_REQUISITION_API_URL');
    assert.strictEqual(domStore.get('live-bill-count').innerText, '1');
    assert.strictEqual(domStore.get('live-unit-count').innerText, '4');
    console.log('✓ Fallback to LINE_REQUISITION_API_URL verified when AkraSupabaseKPI is absent');

    console.log('=============================================================');
    console.log('🎉 ALL LIVE BILL SYNC UI & SUPABASE TESTS PASSED 100%! 🎉');
    console.log('=============================================================');
})().catch(err => {
    console.error('Async test failed:', err);
    process.exitCode = 1;
});
