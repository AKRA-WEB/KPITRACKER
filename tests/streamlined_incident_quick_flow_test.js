const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(appRoot, 'index.html');
const versionPath = path.join(appRoot, 'version.json');

console.log('=== Running Streamlined Incident Quick Flow Verification Tests ===');

// [1/5] Syntax Verification & Script Extraction
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = htmlContent.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(scriptMatch, 'Inline application script must be present in index.html');
const scriptCode = scriptMatch[1];

let scriptParsed = false;
try {
    new vm.Script(scriptCode);
    scriptParsed = true;
    console.log('✓ All inline script tags successfully parsed by vm.Script (zero syntax errors).');
} catch (err) {
    console.error('Syntax error parsing index.html script:', err);
}
assert.ok(scriptParsed, 'Script must compile without syntax errors');

// [2/5] Version Parity Verification
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const versionMatch = scriptCode.match(/const CURRENT_VERSION = ["']([^"']+)["'];/);
assert.ok(versionMatch, 'CURRENT_VERSION must be declared in index.html');
assert.equal(versionMatch[1], versionJson.version, 'index.html CURRENT_VERSION must match version.json');
assert.ok(versionJson.version >= '20260908.05', 'Release version must be updated');
console.log(`✓ Version parity verified: ${versionJson.version}`);

// [3/5] Setup mock DOM and runtime environment for functional tests
const mockElements = new Map();
function getMockElement(id) {
    if (!mockElements.has(id)) {
        mockElements.set(id, {
            id,
            value: '',
            textContent: '',
            innerHTML: '',
            className: '',
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            },
            dataset: {},
            focus() {},
            scrollIntoView() {},
            addEventListener() {},
            removeEventListener() {},
            style: {}
        });
    }
    return mockElements.get(id);
}

const mockDoc = {
    getElementById(id) {
        return getMockElement(id);
    },
    querySelector(sel) {
        if (sel === '#pc-err-severity-list .severity-chip-active') {
            const el = getMockElement('active-sev-chip');
            el.dataset.name = el.dataset.name || 'หยิบผิด แก้ทันก่อนจัดส่ง';
            el.dataset.penalty = el.dataset.penalty || '5';
            return el;
        }
        return getMockElement(sel.replace(/[^a-zA-Z0-9_-]/g, ''));
    },
    querySelectorAll(sel) {
        return [];
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};

const locationObj = { href: 'http://localhost/', search: '' };
const sandbox = {
    console,
    window: {
        location: locationObj,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        scrollTo: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
    },
    location: locationObj,
    document: mockDoc,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    URL: global.URL,
    URLSearchParams: global.URLSearchParams,
    Date: global.Date,
    Math: global.Math,
    parseInt: global.parseInt,
    parseFloat: global.parseFloat,
    String: global.String,
    Number: global.Number,
    Array: global.Array,
    Object: global.Object,
    JSON: global.JSON,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
};

vm.createContext(sandbox);

// Execute helper extraction in sandbox
vm.runInContext(`
${scriptCode}

globalThis.QUICK_INCIDENT_TEMPLATES = QUICK_INCIDENT_TEMPLATES;
globalThis.selectQuickIncidentTemplate = selectQuickIncidentTemplate;
globalThis.selectIncidentImpact = selectIncidentImpact;
globalThis.onIncidentSearchInput = onIncidentSearchInput;
globalThis.clearIncidentSearch = clearIncidentSearch;
globalThis.selectCustomCatalogItem = selectCustomCatalogItem;
globalThis.canConfirmZeroErrors = canConfirmZeroErrors;
globalThis.confirmZeroErrors = confirmZeroErrors;
globalThis.handleZeroErrorClick = handleZeroErrorClick;
globalThis.updateIncidentMetadataSummary = updateIncidentMetadataSummary;
globalThis.showIncidentSuccessCard = showIncidentSuccessCard;
globalThis.dismissIncidentSuccessCard = dismissIncidentSuccessCard;
globalThis.resetIncidentFormForNextCase = resetIncidentFormForNextCase;
globalThis.getIncidentCategoriesForBranch = getIncidentCategoriesForBranch;
globalThis.getIncidentCategoryLabel = getIncidentCategoryLabel;
globalThis.getIncidentItemsForCategory = getIncidentItemsForCategory;

Object.defineProperty(globalThis, 'KPI_SYSTEM_CONFIG', {
    get() { return KPI_SYSTEM_CONFIG; },
    set(v) { KPI_SYSTEM_CONFIG = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'currentBranch', {
    get() { return currentBranch; },
    set(v) { currentBranch = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'errCategory', {
    get() { return errCategory; },
    set(v) { errCategory = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'currentSelectedTemplateIdx', {
    get() { return currentSelectedTemplateIdx; },
    set(v) { currentSelectedTemplateIdx = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'currentSelectedImpactIdx', {
    get() { return currentSelectedImpactIdx; },
    set(v) { currentSelectedImpactIdx = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'currentUser', {
    get() { return currentUser; },
    set(v) { currentUser = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'currentRoles', {
    get() { return currentRoles; },
    set(v) { currentRoles = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'IS_ADMIN', {
    get() { return IS_ADMIN; },
    set(v) { IS_ADMIN = v; },
    configurable: true
});
Object.defineProperty(globalThis, 'sessionToken', {
    get() { return sessionToken; },
    set(v) { sessionToken = v; },
    configurable: true
});
`, sandbox);

console.log('✓ Script initialized in runtime sandbox context.');

// [4/5] Test Quick Incident Templates & Impact Logic
const templatesAKRA = sandbox.QUICK_INCIDENT_TEMPLATES.AKRA;
const templatesTRD = sandbox.QUICK_INCIDENT_TEMPLATES.TRD;

assert.ok(Array.isArray(templatesAKRA) && templatesAKRA.length >= 5, 'AKRA must have at least 5 quick templates');
assert.ok(Array.isArray(templatesTRD) && templatesTRD.length >= 5, 'TRD must have at least 5 quick templates');

// Check AKRA "จัดสินค้าผิด" template has impacts
const pickWrongAKRA = templatesAKRA.find(t => t.id === 'pick_wrong');
assert.ok(pickWrongAKRA, 'AKRA must have pick_wrong template');
assert.equal(pickWrongAKRA.category, 'outbound');
assert.equal(pickWrongAKRA.hasImpact, true);
assert.equal(pickWrongAKRA.impacts.length, 3);
assert.equal(pickWrongAKRA.impacts[0].item, 'หยิบผิด แก้ทันก่อนจัดส่ง');
assert.equal(pickWrongAKRA.impacts[0].penalty, 5);
assert.equal(pickWrongAKRA.impacts[2].item, 'หยิบผิด ถึงลูกค้าแล้ว');
assert.equal(pickWrongAKRA.impacts[2].penalty, 20);

// Check Checker error contextual prompt
const checkerAKRA = templatesAKRA.find(t => t.id === 'checker_error');
assert.ok(checkerAKRA, 'AKRA must have checker_error template');
assert.match(checkerAKRA.workerPrompt, /Checker/i, 'Checker template must prompt specifically for Checker');

// Test selectQuickIncidentTemplate
sandbox.currentBranch = 'AKRA';
sandbox.selectQuickIncidentTemplate(0); // pick_wrong
assert.equal(sandbox.currentSelectedTemplateIdx, 0);
assert.equal(sandbox.errCategory, 'outbound');
assert.equal(mockElements.get('inc-selected-pill').textContent, 'จัดสินค้าผิด');
assert.equal(mockElements.get('inc-meta-cat').textContent, 'ขาออก');
assert.equal(mockElements.get('inc-meta-resp').textContent, 'รายบุคคล');
assert.equal(mockElements.get('inc-meta-hp').textContent, '-5 HP');

// Test selectIncidentImpact: change to "ถึงลูกค้าแล้ว" (idx 2)
sandbox.selectIncidentImpact(2);
assert.equal(sandbox.currentSelectedImpactIdx, 2);
assert.equal(mockElements.get('inc-meta-hp').textContent, '-20 HP');
console.log('✓ Quick Incident Templates, category auto-resolution, and impact calculation verified.');

// Test selectQuickIncidentTemplate for Checker error (idx 2)
sandbox.selectQuickIncidentTemplate(2); // checker_error
assert.match(mockElements.get('inc-worker-label').innerHTML, /Checker/i);
console.log('✓ Contextual worker question dynamically updates for Checker errors.');

// [5/5] Test Zero Error Permission Guard
sandbox.currentUser = 'worker1';
sandbox.currentRoles = ['OPERATOR'];
sandbox.IS_ADMIN = false;
sandbox.sessionToken = 'test-token';
assert.equal(sandbox.canConfirmZeroErrors(), false, 'Regular operator without lead/checker role cannot confirm zero errors');

sandbox.currentRoles = ['ADMIN'];
assert.equal(sandbox.canConfirmZeroErrors(), true, 'Admin can confirm zero errors');

sandbox.currentRoles = ['CHECKER'];
assert.equal(sandbox.canConfirmZeroErrors(), true, 'Checker can confirm zero errors');

sandbox.currentRoles = ['LEAD'];
assert.equal(sandbox.canConfirmZeroErrors(), true, 'Shift Lead can confirm zero errors');

console.log('✓ Zero Error role permission guard correctly restricts confirmation to Leads / Checkers / Admins.');

// Test showIncidentSuccessCard & resetIncidentFormForNextCase
sandbox.showIncidentSuccessCard({ worker: 'เอี้ยง', penalty: 5, type: 'หยิบผิด แก้ทันก่อนจัดส่ง' });
assert.equal(mockElements.get('inc-success-card').classList.contains('hidden'), false, 'Success card must be visible after save');
assert.match(mockElements.get('inc-success-summary').textContent, /เอี้ยง/);

sandbox.resetIncidentFormForNextCase();
assert.equal(mockElements.get('inc-success-card').classList.contains('hidden'), true, 'Success card must be hidden after reset');
assert.equal(sandbox.currentSelectedTemplateIdx, 0, 'Reset must restore default template');

console.log('✓ Success feedback and "+ บันทึกอีกเคส" form reset flow verified.');

// [6/6] Dynamic Custom Category Resolution & Branch Cross-Leakage Prevention
sandbox.KPI_SYSTEM_CONFIG = {
    incidentCatalog: {
        AKRA: {
            categories: [
                { key: 'outbound', label: 'ขาออก' },
                { key: 'store_stock', label: 'หน้าร้าน/สต๊อก' }
            ],
            items: {
                'outbound': [
                    { name: 'หยิบผิด แก้ทันก่อนจัดส่ง', penalty: 5, dot: 'bg-amber-500', desc: 'ตรวจเจอก่อนส่งมอบ' }
                ],
                'store_stock': [
                    { name: 'วางสินค้าผิดตำแหน่ง', penalty: 5, dot: 'bg-amber-500', desc: 'หาของไม่เจอ' }
                ]
            }
        },
        TRD: {
            categories: [
                { key: 'cat_1787719959049', label: 'หน้าร้าน / ในร้าน' },
                { key: 'trd_cashier', label: 'แคชเชียร์/แอดมิน' }
            ],
            items: {
                'cat_1787719959049': [
                    { name: 'จัดสินค้าผิด (แก้ไขทัน)', penalty: 5, dot: 'bg-amber-500', desc: 'เช็คเกอร์ตรวจเจอ' }
                ],
                'trd_cashier': [
                    { name: 'เปิดบิลผิดพลาด', penalty: 10, dot: 'bg-red-500', desc: 'คีย์ยอดไม่ตรง' }
                ]
            }
        }
    }
};

// 1. Dynamic category label resolution
const resolvedLabel = sandbox.getIncidentCategoryLabel('cat_1787719959049', 'TRD');
assert.equal(resolvedLabel, 'หน้าร้าน / ในร้าน', 'Dynamic TRD category must resolve to human-readable Thai label');

// 2. AKRA Search: TRD custom category items must NOT leak into AKRA
sandbox.currentBranch = 'AKRA';
sandbox.onIncidentSearchInput('จัดสินค้าผิด');
const akraSearchHtml = mockElements.get('inc-search-results').innerHTML;
assert.ok(
    !akraSearchHtml.includes('cat_1787719959049') && !akraSearchHtml.includes('จัดสินค้าผิด (แก้ไขทัน)'),
    'TRD custom category items must never leak into AKRA search'
);

// 3. TRD Search: TRD custom category items must appear with human-readable label, NEVER raw key
sandbox.currentBranch = 'TRD';
sandbox.onIncidentSearchInput('จัดสินค้าผิด');
const trdSearchHtml = mockElements.get('inc-search-results').innerHTML;
assert.ok(trdSearchHtml.includes('จัดสินค้าผิด (แก้ไขทัน)'), 'TRD search must find items in TRD custom category');
assert.ok(trdSearchHtml.includes('หน้าร้าน / ในร้าน'), 'TRD search item badge must display human-readable category label');
const badgeMatch = trdSearchHtml.match(/<span class="text-\[10px\] bg-slate-100[^>]*>([\s\S]*?)<\/span>/);
assert.ok(badgeMatch, 'Category badge span must exist in search result item');
assert.equal(badgeMatch[1], 'หน้าร้าน / ในร้าน', 'Category badge text must strictly be human-readable label');

// 4. Custom item selection updates metadata with human-readable category
sandbox.selectCustomCatalogItem('cat_1787719959049', 'จัดสินค้าผิด (แก้ไขทัน)', 5);
assert.equal(mockElements.get('inc-meta-cat').textContent, 'หน้าร้าน / ในร้าน', 'Selected category metadata must display human-readable label');
assert.equal(mockElements.get('inc-selected-pill').textContent, 'จัดสินค้าผิด (แก้ไขทัน)', 'Selected item pill must display item name');
assert.equal(mockElements.get('inc-meta-hp').textContent, '-5 HP', 'Penalty HP must reflect selected item penalty');

console.log('✓ Dynamic custom category resolution and branch cross-leakage prevention verified.');

console.log('\n=============================================================');
console.log('🎉 ALL STREAMLINED INCIDENT QUICK FLOW TESTS PASSED 100%! 🎉');
console.log('=============================================================\n');
