const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== RUNNING KPITRACKER NEGATIVE AUTH & RUNTIME REMEDIATION TESTS (v20260825.01) ===\n');

const htmlPath = path.join(__dirname, '../index.html');
const gasPath = path.join(__dirname, '../Code.gs.txt');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const gasContent = fs.readFileSync(gasPath, 'utf8');

function extractHtmlFunction(signature) {
    const start = htmlContent.indexOf(`function ${signature}`);
    assert(start !== -1, `Function ${signature} must exist`);
    const open = htmlContent.indexOf('{', start);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < htmlContent.length) {
        if (htmlContent[i] === '{') depth++;
        else if (htmlContent[i] === '}') depth--;
        i++;
    }
    return htmlContent.slice(start, i);
}

// =========================================================================
// TEST 1: Rule 8 - VM Script Compilation of all <script> blocks
// =========================================================================
console.log('[1/8] Compiling all inline <script> blocks with node:vm...');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptIndex = 0;
while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const code = match[1];
    if (!code.trim()) continue;
    scriptIndex++;
    new vm.Script(code, { filename: `inline-script-${scriptIndex}.js` });
}
assert(scriptIndex >= 1, 'Must find at least 1 script block in index.html');
console.log(`  -> Passed: ${scriptIndex} script blocks compiled with 0 syntax errors.`);

// =========================================================================
// TEST 2: Rule 8 - Backend Authorization Invariants (Zero Sheet calls without valid token)
// =========================================================================
console.log('\n[2/8] Testing Backend Authorization Invariants (Zero Sheet access without valid token)...');

function createGasSandbox(validTokenUser = null) {
    let sheetAccessCount = 0;
    const mockSheet = {
        insertSheet: () => { sheetAccessCount++; return mockSheet; },
        appendRow: () => { sheetAccessCount++; },
        getLastColumn: () => 11,
        getRange: () => ({ getValue: () => '', getValues: () => [['']], setValue: () => {}, setValues: () => {} }),
        getDataRange: () => ({ getValues: () => [['Header']] }),
        deleteRow: () => { sheetAccessCount++; },
        clearContents: () => { sheetAccessCount++; },
        getRangeList: () => ({ clearContent: () => {} })
    };

    const mockSpreadsheetApp = {
        openById: (id) => {
            sheetAccessCount++;
            return {
                getSheetByName: () => mockSheet,
                insertSheet: () => mockSheet
            };
        },
        flush: () => {}
    };

    const mockContentService = {
        MimeType: { JSON: 'application/json' },
        createTextOutput: (text) => ({
            setMimeType: (mime) => ({
                _text: text,
                _mime: mime,
                getContent: () => text
            })
        })
    };

    const mockLock = {
        waitLock: () => {},
        releaseLock: () => {}
    };

    const mockLockService = {
        getScriptLock: () => mockLock
    };

    const mockUtilities = {
        formatDate: (date, tz, fmt) => '2026-08-22',
        computeDigest: () => [1, 2, 3]
    };

    const sandbox = {
        SPREADSHEET_ID: 'mock_spreadsheet_id',
        SpreadsheetApp: mockSpreadsheetApp,
        ContentService: mockContentService,
        LockService: mockLockService,
        Utilities: mockUtilities,
        console: { log: () => {}, error: () => {}, warn: () => {} },
        requireAuth: (token) => {
            if (!token || token === 'invalid_token' || token === 'expired_token') {
                return { error: { success: false, message: 'กรุณาเข้าสู่ระบบใหม่', reason: 'no_token_or_invalid' } };
            }
            if (token === 'valid_token') {
                return { user: validTokenUser || { id: '250013', name: 'เฉิน', roles: ['Admin'] } };
            }
            return { error: { success: false, message: 'token invalid', reason: 'invalid' } };
        },
        getSheetAccessCount: () => sheetAccessCount
    };

    vm.createContext(sandbox);

    const authStart = gasContent.indexOf('function requireAuth(token)');
    const authEnd = gasContent.indexOf('function manualAuthorizeMainSsoConnection()');
    let gasCodeToEval = gasContent.slice(0, authStart) + gasContent.slice(authEnd);
    gasCodeToEval = gasCodeToEval.replace(/const SPREADSHEET_ID\s*=\s*"[^"]*";/, '');

    vm.runInContext(gasCodeToEval, sandbox);
    return sandbox;
}

// 2a. doGet getConfig without token
{
    const sb = createGasSandbox();
    const res = sb.doGet({ parameter: { action: 'getConfig' } });
    const parsed = JSON.parse(res.getContent());
    assert.strictEqual(parsed.status, 'error', 'getConfig without token must return status: error');
    assert.strictEqual(sb.getSheetAccessCount(), 0, 'getConfig without token must make 0 Sheet calls');
}

// 2b. doGet getData without token
{
    const sb = createGasSandbox();
    const res = sb.doGet({ parameter: { action: 'getData', branch: 'AKRA' } });
    const parsed = JSON.parse(res.getContent());
    assert.strictEqual(parsed.status, 'error', 'getData without token must return status: error');
    assert.strictEqual(sb.getSheetAccessCount(), 0, 'getData without token must make 0 Sheet calls');
}

// 2c. doPost saveData without token
{
    const sb = createGasSandbox();
    const res = sb.doPost({ postData: { contents: JSON.stringify({ action: 'saveData', branch: 'AKRA', date: '2026-08-22' }) } });
    const parsed = JSON.parse(res.getContent());
    assert.strictEqual(parsed.status, 'error', 'saveData without token must return status: error');
    assert.strictEqual(sb.getSheetAccessCount(), 0, 'saveData without token must make 0 Sheet calls');
}

// 2d. Invalid tokens must be rejected before any Sheet read/write
for (const action of ['getConfig', 'getData']) {
    const sb = createGasSandbox();
    const parameters = { action, token: 'invalid_token' };
    if (action === 'getData') parameters.branch = 'AKRA';
    const res = sb.doGet({ parameter: parameters });
    const parsed = JSON.parse(res.getContent());
    assert.strictEqual(parsed.status, 'error', `${action} with invalid token must return status: error`);
    assert.strictEqual(sb.getSheetAccessCount(), 0, `${action} with invalid token must make 0 Sheet calls`);
}

{
    const sb = createGasSandbox();
    const res = sb.doPost({ postData: { contents: JSON.stringify({
        action: 'saveData', token: 'invalid_token', branch: 'AKRA', date: '2026-08-22'
    }) } });
    const parsed = JSON.parse(res.getContent());
    assert.strictEqual(parsed.status, 'error', 'saveData with invalid token must return status: error');
    assert.strictEqual(sb.getSheetAccessCount(), 0, 'saveData with invalid token must make 0 Sheet calls');
}

console.log('  -> Passed: Zero unauthenticated reads/writes to Google Sheets verified.');

// =========================================================================
// TEST 3: P0 - Client Admin Privilege Hardening (?uid without token CANNOT get Admin)
// =========================================================================
console.log('\n[3/8] Testing Client-side Admin Privilege Invariant (?uid without SSO token gets 0 admin rights)...');

async function testClientAdminHardening() {
    function extractFn(src, name) {
        const start = src.indexOf(`function ${name}`);
        assert(start !== -1, `Function ${name} must exist`);
        const open = src.indexOf('{', start);
        let depth = 1, i = open + 1;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(start, i);
    }

    function extractAsyncFn(src, name) {
        const start = src.indexOf(`async function ${name}`);
        assert(start !== -1, `Async function ${name} must exist`);
        const open = src.indexOf('{', start);
        let depth = 1, i = open + 1;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(start, i);
    }

    const elementsMap = {};
    function getMockEl(id) {
        if (!elementsMap[id]) {
            elementsMap[id] = {
                id,
                classList: {
                    _classes: new Set(['hidden']),
                    add: (...cls) => { cls.forEach(c => elementsMap[id].classList._classes.add(c)); },
                    remove: (...cls) => { cls.forEach(c => elementsMap[id].classList._classes.delete(c)); },
                    contains: (c) => elementsMap[id].classList._classes.has(c)
                },
                innerText: '',
                value: ''
            };
        }
        return elementsMap[id];
    }

    const storageMap = {};
    const sandbox = {
        window: {
            location: { search: '?uid=250013' }
        },
        document: {
            getElementById: (id) => getMockEl(id),
            querySelectorAll: () => []
        },
        safeStorage: {
            getItem: (k) => storageMap[k] || null,
            setItem: (k, v) => { storageMap[k] = v; },
            removeItem: (k) => { delete storageMap[k]; }
        },
        GLOBAL_CONFIG_LIST: [
            { uid: '250013', name: 'เฉิน', dept: 'Admin', branches: 'AKRA,TRD' }
        ],
        currentUser: null,
        displayUserName: '',
        currentRoles: [],
        KPI_MAIN_VIEWER: null,
        sessionToken: null, // NO TOKEN!
        IS_ADMIN: false,
        _kpiPerms: [],
        resolveSsoAuth: async () => ({ userData: null, expired: false, attempted: false }),
        renderAdminPanel: () => {},
        syncAllBranchesForAdmin: () => {},
        startAdminStatusRefresh: () => {},
        applyRolePermissions: () => {},
        refreshActions: () => {},
        showManualLoginModal: () => {},
        getTodayBangkokDateStr: () => '2026-08-22',
        console: { log: () => {}, error: () => {}, warn: () => {} }
    };

    vm.createContext(sandbox);
    vm.runInContext(extractFn(htmlContent, 'can'), sandbox);
    vm.runInContext(extractAsyncFn(htmlContent, 'checkAuth'), sandbox);

    await sandbox.checkAuth();

    assert.strictEqual(sandbox.sessionToken, null, 'sessionToken must remain null without verified SSO');
    assert.strictEqual(sandbox.IS_ADMIN, false, 'IS_ADMIN must strictly be false when sessionToken is null');
    assert.strictEqual(sandbox.can('adminDashboard'), false, 'can("adminDashboard") must strictly return false without sessionToken');
    assert.deepStrictEqual(Array.from(sandbox.currentRoles), [], 'currentRoles must not contain Admin when logging via unauthenticated ?uid');

    // Verify Admin tabs remain hidden
    const adminTab = getMockEl('tab-admin');
    const adminDrawerBtn = getMockEl('drawer-admin-btn');
    assert.strictEqual(adminTab.classList.contains('flex'), false, 'Admin tab must NOT be made visible');
    assert.strictEqual(adminDrawerBtn.classList.contains('flex'), false, 'Admin drawer button must NOT be made visible');

    console.log('  -> Passed: ?uid query without SSO token is strictly denied Admin roles/UI.');
}

// =========================================================================
// TEST 4: P0 - Untrusted Modal Messages Must Render as Text
// =========================================================================
console.log('\n[4/8] Testing Modal XSS Defense...');

{
    let renderedText = '';
    let unsafeHtmlWrites = 0;
    const sandbox = {
        document: {
            getElementById: (id) => {
                if (id === 'custom-modal-title') return { innerText: '' };
                if (id === 'custom-modal-text') return {
                    set innerHTML(val) { unsafeHtmlWrites++; },
                    set textContent(val) { renderedText = val; }
                };
                if (id === 'custom-modal-actions') return { innerHTML: '' };
                if (id === 'custom-modal') return { classList: { remove: () => {}, add: () => {} } };
                if (id === 'custom-modal-content') return { classList: { replace: () => {} } };
                if (id === 'custom-modal-icon') return { innerHTML: '' };
                if (id === 'modal-btn-cancel' || id === 'modal-btn-confirm' || id === 'modal-btn-ok') return { onclick: null };
                return null;
            },
            activeElement: null
        },
        releaseFocusFromModal: () => {},
        trapFocusInModal: () => {},
        injectStyles: () => {},
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        _prevFocusElement: null
    };

    vm.createContext(sandbox);
    vm.runInContext(extractHtmlFunction('showModal(title, message'), sandbox);

    const hostileMessage = '<img src=x onerror="globalThis.__xss = true">';
    sandbox.showModal('บันทึกไม่สำเร็จ', hostileMessage, 'error');

    assert.strictEqual(renderedText, hostileMessage, 'Untrusted modal text must remain literal text');
    assert.strictEqual(unsafeHtmlWrites, 0, 'Untrusted modal text must never reach innerHTML');
    console.log('  -> Passed: untrusted modal messages are rendered as inert text.');
}

// =========================================================================
// TEST 5: P1 - Branch Initialization Null-Safety in restoreRecordDraft()
// =========================================================================
console.log('\n[5/8] Testing Branch Initialization Null-Safety in restoreRecordDraft()...');

{
    const sandbox = {
        currentUser: '250007',
        currentBranch: 'AKRA',
        document: {
            getElementById: (id) => {
                if (id === 'record-date') return { value: '2026-08-22' };
                // DOM containers removed in redesign:
                if (id === 'error-entries-container') return null;
                if (id === 'task-entries-container') return null;
                return null;
            }
        },
        safeStorage: {
            getItem: (key) => {
                if (key.includes('_errors')) return JSON.stringify([{ caseId: 'ERR-1', type: 'ขาออก', penalty: 5 }]);
                if (key.includes('_workload')) return JSON.stringify({ akraRoster: [], akraWorkload: [] });
                return null;
            },
            setItem: () => {}
        },
        hydrateSelectedDayRecord: () => {},
        applyAkraRosterDraft: () => {},
        applyAkraWorkloadDraft: () => {},
        renderAkraWorkloadEditor: () => {},
        addErrorEntryRow: () => {},
        loadTasksForSelectedDate: () => {},
        setVendorBillsForm: () => {},
        renderRecordActionsSummary: () => {},
        renderRecordActionsTable: () => {},
        applyDraftTasks: () => {},
        ALL_ACTIONS: [],
        BRANCH_CONFIG: { AKRA: { showZone2: true } },
        _restoringDraft: false,
        formatDateKeyLocal: () => '2026-08-22',
        console: { log: () => {}, error: () => {}, warn: () => {} }
    };

    function extractFn(src, name) {
        const start = src.indexOf(`function ${name}`);
        assert(start !== -1, `Function ${name} must exist`);
        const open = src.indexOf('{', start);
        let depth = 1, i = open + 1;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(start, i);
    }

    vm.createContext(sandbox);
    vm.runInContext(extractFn(htmlContent, 'restoreRecordDraft'), sandbox);

    assert.doesNotThrow(() => {
        sandbox.restoreRecordDraft();
    }, 'restoreRecordDraft must not throw TypeError when #error-entries-container is null');
    console.log('  -> Passed: restoreRecordDraft null-guard verified successfully.');
}

// =========================================================================
// TEST 6: P2 - Real Async Live Sync Auto-load Test (using assert.doesNotReject)
// =========================================================================
console.log('\n[6/8] Testing Live Sync Auto-load with assert.doesNotReject (Real Await)...');

async function testLiveSyncAsync() {
    let datePassed = '';
    const sandbox = {
        _lastRecordDate: '2026-08-22',
        LINE_REQUISITION_API_URL: 'https://script.google.com/mock',
        liveRequisitionsList: [],
        renderLiveRequisitions: () => {},
        fetch: async (url) => {
            const m = url.match(/date=([^&]+)/);
            if (m) datePassed = m[1];
            return {
                ok: true,
                json: async () => ({ success: true, requisitions: [{ uid: 'REQ-1', status: 'done', skuCount: 2, totalUnits: 10 }] })
            };
        }
    };

    function extractAsyncFn(src, name) {
        const start = src.indexOf(`async function ${name}`);
        assert(start !== -1, `Async function ${name} must exist`);
        const open = src.indexOf('{', start);
        let depth = 1, i = open + 1;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(start, i);
    }

    vm.createContext(sandbox);
    vm.runInContext(extractAsyncFn(htmlContent, 'fetchLiveRequisitions'), sandbox);

    // Use await assert.doesNotReject
    await assert.doesNotReject(async () => {
        await sandbox.fetchLiveRequisitions();
    }, 'fetchLiveRequisitions() must resolve cleanly without Promise rejection');

    assert.strictEqual(datePassed, '2026-08-22', 'Must pass resolved date string to backend');
    console.log('  -> Passed: Real awaited Live Sync fetch completed with zero errors.');
}

// =========================================================================
// TEST 7: P2 - Honest Metrics Semantics & Live Sync Completion Rate
// =========================================================================
console.log('\n[7/8] Testing Metric Semantics & Live Sync Completion Rate...');

{
    let displayedRate = '';
    let displayedSub = '';
    const sandbox = {
        liveRequisitionsList: [],
        document: {
            getElementById: (id) => {
                if (id === 'live-bill-count') return { innerText: '' };
                if (id === 'live-sku-count') return { innerText: '' };
                if (id === 'live-unit-count') return { innerText: '' };
                if (id === 'live-ontime-rate') return { set innerText(v) { displayedRate = v; } };
                if (id === 'live-ontime-sub') return { set innerText(v) { displayedSub = v; } };
                if (id === 'live-trd-count') return { innerText: '' };
                if (id === 'live-urgent-count') return { innerText: '' };
                if (id === 'live-regular-count') return { innerText: '' };
                if (id === 'live-bill-list-cards') return { innerHTML: '' };
                return null;
            }
        },
        esc: (s) => s
    };

    function extractFn(src, name) {
        const start = src.indexOf(`function ${name}`);
        const open = src.indexOf('{', start);
        let depth = 1, i = open + 1;
        while (depth > 0 && i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(start, i);
    }

    vm.createContext(sandbox);
    vm.runInContext(extractFn(htmlContent, 'renderLiveRequisitions'), sandbox);

    // Case A: 0 bills -> rate must be '-', NOT 100%
    sandbox.liveRequisitionsList = [];
    sandbox.renderLiveRequisitions();
    assert.strictEqual(displayedRate, '-', 'Empty requisitions list must show - rather than misleading 100%');

    // Case B: 10 bills, 7 done -> 70.0%
    sandbox.liveRequisitionsList = [
        { uid: '1', status: 'จัดเสร็จแล้ว' }, { uid: '2', status: 'จัดเสร็จแล้ว' },
        { uid: '3', status: 'จัดเสร็จแล้ว' }, { uid: '4', status: 'จัดเสร็จแล้ว' },
        { uid: '5', status: 'จัดเสร็จแล้ว' }, { uid: '6', status: 'จัดเสร็จแล้ว' },
        { uid: '7', status: 'จัดเสร็จแล้ว' }, { uid: '8', status: 'สินค้าหมด ❌' },
        { uid: '9', status: 'รอจัดสินค้า' }, { uid: '10', status: 'รอจัดสินค้า' }
    ];
    sandbox.renderLiveRequisitions();
    assert.strictEqual(displayedRate, '70.0%', 'Completion rate must be 70.0%');
    assert.strictEqual(displayedSub, '7/10 บิลจัดเสร็จ', 'Subtext must state exact completed count');
    console.log('  -> Passed: Metric semantics reflect true completion rate.');
}

// =========================================================================
// TEST 8: P1/P2 - Drawer Runtime, Accessibility State & Version Parity
// =========================================================================
console.log('\n[8/8] Testing Drawer Runtime, Accessibility State & Version Parity...');

{
    let focusedElement = null;
    function mockElement(initialClasses = []) {
        const classes = new Set(initialClasses);
        const attributes = new Map();
        return {
            textContent: '',
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name)
            },
            setAttribute: (name, value) => attributes.set(name, value),
            removeAttribute: name => attributes.delete(name),
            hasAttribute: name => attributes.has(name),
            getAttribute: name => attributes.get(name),
            focus() { focusedElement = this; }
        };
    }

    const elements = {
        'drawer-panel': mockElement(['translate-x-full']),
        'drawer-backdrop': mockElement(['opacity-0', 'pointer-events-none']),
        'btn-open-drawer': mockElement(),
        'app-content': mockElement(),
        'drawer-user-name': mockElement(),
        'drawer-user-role': mockElement(),
        'drawer-branch-badge': mockElement(),
        'drawer-admin-dash-btn': mockElement(['hidden']),
        'drawer-admin-btn': mockElement(['hidden'])
    };
    const header = mockElement();
    const firstDrawerButton = mockElement();
    elements['drawer-panel'].setAttribute('aria-hidden', 'true');
    elements['drawer-panel'].setAttribute('inert', '');
    elements['drawer-panel'].querySelector = () => firstDrawerButton;
    elements['btn-open-drawer'].setAttribute('aria-expanded', 'false');

    const sandbox = {
        document: {
            getElementById: id => elements[id] || null,
            querySelector: selector => selector === '.app-header' ? header : null
        },
        displayUserName: 'หมูหยอง',
        currentUser: '250007',
        currentBranch: 'AKRA',
        currentRoles: [],
        sessionToken: null,
        IS_ADMIN: false,
        can: () => false
    };
    vm.createContext(sandbox);
    vm.runInContext([
        extractHtmlFunction('openDrawer()'),
        extractHtmlFunction('closeDrawer()'),
        extractHtmlFunction('canAccessAdminSettings(roles, hasAuthenticatedToken)'),
        extractHtmlFunction('updateDrawerUserInfo()')
    ].join('\n'), sandbox);

    assert.doesNotThrow(() => sandbox.openDrawer(), 'Opening the drawer must not throw');
    assert.strictEqual(elements['drawer-panel'].hasAttribute('inert'), false, 'Open drawer must be interactive');
    assert.strictEqual(elements['drawer-panel'].hasAttribute('aria-hidden'), false, 'Open drawer must be exposed to assistive technology');
    assert.strictEqual(elements['app-content'].hasAttribute('inert'), true, 'Background content must be inert while drawer is open');
    assert.strictEqual(header.hasAttribute('aria-hidden'), true, 'Header must be hidden from assistive technology while drawer is open');
    assert.strictEqual(elements['btn-open-drawer'].getAttribute('aria-expanded'), 'true');
    assert.strictEqual(focusedElement, firstDrawerButton, 'Focus must move into the opened drawer');

    sandbox.closeDrawer();
    assert.strictEqual(elements['drawer-panel'].hasAttribute('inert'), true, 'Closed drawer must be inert');
    assert.strictEqual(elements['drawer-panel'].getAttribute('aria-hidden'), 'true', 'Closed drawer must be hidden from assistive technology');
    assert.strictEqual(elements['app-content'].hasAttribute('inert'), false, 'Background content must be restored after close');
    assert.strictEqual(header.hasAttribute('aria-hidden'), false, 'Header accessibility must be restored after close');
    assert.strictEqual(elements['btn-open-drawer'].getAttribute('aria-expanded'), 'false');
    assert.strictEqual(focusedElement, elements['btn-open-drawer'], 'Focus must return to the drawer trigger');

    // Metadata and content lint checks
    const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8'));
    assert.strictEqual(versionJson.version, '20260825.03', 'version.json must be 20260825.03');
    assert.match(htmlContent, /const CURRENT_VERSION = "20260825\.03";/, 'CURRENT_VERSION in index.html must be 20260825.03');
    assert.match(htmlContent, /id="drawer-version-text">KPI Suite v20260825\.03<\/span>/, 'Drawer footer must display 20260825.03');
    assert.match(htmlContent, /supabase-kpi-client\.js\?v=20260825\.03/, 'Incident client asset cache key must match 20260825.03');

    // Check Zero emojis in key areas
    assert.doesNotMatch(htmlContent, /⚡ บิลด่วน \(แป้ง/, 'No raw lightning emoji in live bill title');
    assert.doesNotMatch(htmlContent, /🚛 แวะช่วยขึ้นของ/, 'No raw truck emoji in Pareto list');

    console.log('  -> Passed: Drawer accessibility tree isolation, inertness, and version parity verified.');
}

(async () => {
    await testClientAdminHardening();
    await testLiveSyncAsync();
    console.log('\n=============================================================');
    console.log('🎉 ALL 8 ADVANCED REMEDIATION & INVARIANT SUITES PASSED 100%! 🎉');
    console.log('=============================================================');
})().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
