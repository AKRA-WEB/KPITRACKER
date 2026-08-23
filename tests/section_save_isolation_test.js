const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '../Code.gs.txt'), 'utf8');

function extractFunction(content, name) {
    const asyncStart = content.indexOf(`async function ${name}`);
    const start = asyncStart !== -1 ? asyncStart : content.indexOf(`function ${name}`);
    if (start === -1) throw new Error(`Function ${name} not found`);
    const openBrace = content.indexOf('{', start);
    let depth = 1;
    let cursor = openBrace + 1;
    while (depth > 0 && cursor < content.length) {
        if (content[cursor] === '{') depth++;
        else if (content[cursor] === '}') depth--;
        cursor++;
    }
    return content.slice(start, cursor);
}

eval(extractFunction(backend, 'isKpiAdminUser'));
eval(extractFunction(backend, 'mergeDailyRecordSection'));
eval(extractFunction(backend, 'getKpiWeekStartKey'));
function normalizeDateKey(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
eval(extractFunction(backend, 'getWeeklyTaskRowsToClear'));

console.log('=== Running Section Save Isolation Tests ===');

{
    let currentBranch = 'AKRA';
    const getStartOfWeek = eval(`(${extractFunction(html, 'getStartOfWeek')})`);
    const formatLocalDate = date => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');

    for (const branch of ['AKRA', 'TRD']) {
        currentBranch = branch;
        assert.strictEqual(formatLocalDate(getStartOfWeek(new Date(2026, 6, 18, 12))), '2026-07-13',
            `${branch} Saturday must stay in the Monday-start week`);
        assert.strictEqual(formatLocalDate(getStartOfWeek(new Date(2026, 6, 19, 12))), '2026-07-13',
            `${branch} Sunday must close the Monday-start week`);
        assert.strictEqual(formatLocalDate(getStartOfWeek(new Date(2026, 6, 20, 12))), '2026-07-20',
            `${branch} Monday must start a new week`);
    }
}

const baseRow = [
    '2026-07-14',
    'เดิม | ผิด | หมายเหตุ',
    1, 2, 3, 4, 5,
    'หมายเหตุลูกค้าเดิม',
    'แผนเดิม | กำลังทำ | เฉิน',
    '[{"employee":"เฉิน","capacity":10}]',
    JSON.stringify({
        summary: 'เดิม', issues: 'เดิม', actions: 'เดิม', followUps: 'เดิม',
        vendorBills: { totalToday: 12, entryStatus: 'completed', updatedBy: 'เฉิน' },
        futureField: { keep: true }
    })
];

{
    const merged = mergeDailyRecordSection(baseRow, 'operations', {
        volume: { transfer: 10, pickup: 20, upcountry: 30, inmarket: 40, outmarket: 50 },
        customerNotes: 'ใหม่'
    });
    assert.deepStrictEqual(merged.slice(2, 8), [10, 20, 30, 40, 50, 'ใหม่']);
    assert.strictEqual(merged[1], baseRow[1], 'operations must preserve Errors');
    assert.strictEqual(merged[8], baseRow[8], 'operations must preserve Tasks');
    assert.strictEqual(merged[9], baseRow[9], 'operations must preserve Workload');
    assert.strictEqual(merged[10], baseRow[10], 'operations must preserve EndOfShift');
}

{
    const merged = mergeDailyRecordSection(baseRow, 'tasks', {
        tasks: [{ taskName: 'แผนใหม่', status: 'เสร็จแล้ว', assignee: 'เฉิน' }]
    });
    assert.strictEqual(merged[8], 'แผนใหม่ | เสร็จแล้ว | เฉิน');
    baseRow.forEach((value, index) => {
        if (index !== 8) assert.strictEqual(merged[index], value, `tasks must preserve column ${index + 1}`);
    });
}

{
    const merged = mergeDailyRecordSection(baseRow, 'endOfShift', {
        endOfShift: { summary: 'สรุปใหม่', issues: '', actions: 'แก้แล้ว', followUps: 'พรุ่งนี้' }
    });
    const parsed = JSON.parse(merged[10]);
    assert.deepStrictEqual(parsed.vendorBills, { totalToday: 12, entryStatus: 'completed', updatedBy: 'เฉิน' },
        'EndOfShift brief save must preserve nested Vendor Bills');
    assert.deepStrictEqual(parsed.futureField, { keep: true }, 'EndOfShift brief save must preserve unknown nested fields');
    assert.deepStrictEqual(
        { summary: parsed.summary, issues: parsed.issues, actions: parsed.actions, followUps: parsed.followUps },
        { summary: 'สรุปใหม่', issues: '', actions: 'แก้แล้ว', followUps: 'พรุ่งนี้' }
    );
    baseRow.forEach((value, index) => {
        if (index !== 10) assert.strictEqual(merged[index], value, `EndOfShift must preserve column ${index + 1}`);
    });
}

assert.strictEqual(isKpiAdminUser({ id: '250013', roles: [] }), true);
assert.strictEqual(isKpiAdminUser({ id: 'someone', roles: ['admin'] }), true);
assert.strictEqual(isKpiAdminUser({ id: 'permission-only', roles: ['User'], perms: { 'app-kpi': ['adminDashboard'] } }), true,
    'granular app-kpi adminDashboard permission must authorize config administration');
assert.strictEqual(isKpiAdminUser({ id: '250005', roles: ['User'] }), false);
assert.strictEqual(isKpiAdminUser({ id: '250005', roles: ['User'], perms: { 'app-kpi': ['record'] } }), false,
    'an ordinary authenticated user must not administer config');

{
    const weeklyRows = [
        ['Date', 'Errors', 'Transfer', 'Pickup', 'Upcountry', 'InMarket', 'OutMarket', 'Customer Notes', 'Tasks', 'Workload', 'EndOfShift'],
        ['2026-07-13', 'error-monday', 1, 2, 3, 4, 5, 'note-monday', 'งานเก่า | กำลังทำ | เฉิน', 'workload-monday', 'eos-monday'],
        ['2026-07-14', 'error-tuesday', 6, 7, 8, 9, 10, 'note-tuesday', 'งานเดิม | ยังไม่เริ่ม | ท็อป', 'workload-tuesday', 'eos-tuesday'],
        ['2026-07-20', 'error-next-week', 11, 12, 13, 14, 15, 'note-next', 'งานสัปดาห์หน้า | ยังไม่เริ่ม | เฉิน', 'workload-next', 'eos-next']
    ];
    const original = weeklyRows.map(row => row.slice());
    const rowsToClear = getWeeklyTaskRowsToClear(weeklyRows, 3, '2026-07-14', 'AKRA');
    assert.deepStrictEqual(rowsToClear, [2], 'AKRA canonicalization must clear older Monday task rows in the selected week');
    weeklyRows[2] = mergeDailyRecordSection(weeklyRows[2], 'tasks', {
        tasks: [{ taskName: 'งานแก้ไข', status: 'เสร็จแล้ว', assignee: 'เฉิน' }]
    });
    rowsToClear.forEach(rowNumber => { weeklyRows[rowNumber - 1][8] = ''; });
    assert.strictEqual(weeklyRows[1][8], '', 'removing an older-day task must persist after canonicalization');
    assert.strictEqual(weeklyRows[2][8], 'งานแก้ไข | เสร็จแล้ว | เฉิน', 'edited weekly task must be written once on selected date');
    for (const rowIndex of [1, 2, 3]) {
        weeklyRows[rowIndex].forEach((value, columnIndex) => {
            if (columnIndex !== 8) assert.strictEqual(value, original[rowIndex][columnIndex], `weekly task save must preserve row ${rowIndex + 1} column ${columnIndex + 1}`);
        });
    }

    assert.deepStrictEqual(getWeeklyTaskRowsToClear(weeklyRows, -1, '2026-07-16', 'AKRA'), [2, 3],
        'a new selected-date row must clear every existing task cell in its week before append');
    for (const branch of ['AKRA', 'TRD']) {
        assert.strictEqual(getKpiWeekStartKey('2026-07-18', branch), '2026-07-13');
        assert.strictEqual(getKpiWeekStartKey('2026-07-19', branch), '2026-07-13');
        assert.strictEqual(getKpiWeekStartKey('2026-07-20', branch), '2026-07-20');
    }
}

{
    const trdRows = [
        ['Date', 'Errors', 'Transfer', 'Pickup', 'Upcountry', 'InMarket', 'OutMarket', 'Customer Notes', 'Tasks', 'Workload', 'EndOfShift'],
        ['2026-07-19', 'error-sunday', 1, 2, 3, 4, 5, 'note-sunday', 'งานสัปดาห์ก่อน', 'workload-sunday', 'eos-sunday'],
        ['2026-07-20', 'error-monday', 6, 7, 8, 9, 10, 'note-monday', 'งานวันจันทร์', 'workload-monday', 'eos-monday'],
        ['2026-07-25', 'error-saturday', 11, 12, 13, 14, 15, 'note-saturday', 'งานวันเสาร์', 'workload-saturday', 'eos-saturday']
    ];
    const original = trdRows.map(row => row.slice());
    const rowsToClear = getWeeklyTaskRowsToClear(trdRows, 4, '2026-07-25', 'TRD');
    assert.deepStrictEqual(rowsToClear, [3],
        'TRD Saturday save must clear Monday Tasks in the same week without crossing into the preceding Sunday');
    rowsToClear.forEach(rowNumber => { trdRows[rowNumber - 1][8] = ''; });
    for (const rowIndex of [1, 2, 3]) {
        trdRows[rowIndex].forEach((value, columnIndex) => {
            if (columnIndex !== 8) assert.strictEqual(value, original[rowIndex][columnIndex],
                `TRD weekly canonicalization must preserve row ${rowIndex + 1} column ${columnIndex + 1}`);
        });
    }
}

{
    let currentUser = '250013';
    let currentBranch = 'AKRA';
    let _draftTimer = null;
    let _lastRecordDate = '';
    const BRANCH_CONFIG = { AKRA: { showZone2: true } };
    const storage = new Map();
    const safeStorage = {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
    };
    const elements = {};
    const document = {
        getElementById(id) {
            if (!elements[id]) elements[id] = { value: '' };
            return elements[id];
        }
    };
    let vendorBillsForm = null;
    function setVendorBillsForm(value) { vendorBillsForm = value; }
    function syncLegacyFollowUpsDisplay() {}
    const dateSwitchCalls = [];
    function clearTimeout(timer) { dateSwitchCalls.push(timer ? 'clear' : 'clear-empty'); }
    function saveRecordDraft(date) { dateSwitchCalls.push(`save:${date}`); }
    function loadTasksForSelectedDate() { dateSwitchCalls.push('load-tasks'); }
    function restoreRecordDraft() { dateSwitchCalls.push('restore'); }
    function updateDailyDashboard() { dateSwitchCalls.push('dashboard'); }
    function normalizeEndOfShiftBrief(brief) {
        const source = brief && typeof brief === 'object' ? brief : {};
        return {
            summary: source.summary || '',
            issues: source.issues || '',
            actions: source.actions || '',
            followUps: source.followUps || '',
            vendorBills: source.vendorBills || { totalToday: '', entryStatus: '' }
        };
    }

    eval(extractFunction(html, 'parseCustomerNotesForForm'));
    eval(extractFunction(html, 'parseDateKeyLocal'));
    eval(extractFunction(html, 'formatDateKeyLocal'));
    eval(extractFunction(html, 'normalizeClientDateKey'));
    eval(extractFunction(html, 'getSelectedServerDay'));
    eval(extractFunction(html, 'hydrateSelectedDayRecord'));
    eval(extractFunction(html, 'reconcileSavedMainDraft'));
    eval(extractFunction(html, 'handleRecordDateChange'));

    const date = '2026-07-14';
    safeStorage.setItem('kpiData_AKRA', JSON.stringify([{
        date,
        volume: { transfer: 1, pickup: 2, upcountry: 3, inmarket: 4, outmarket: 5 },
        customerNotes: '- รับที่ร้าน: ลูกค้า A\n- ส่งตจว.: เชียงใหม่\n- ส่งในตลาด: ร้าน B\n- ส่งนอกตลาด: ร้าน C',
        endOfShift: {
            summary: 'เสร็จแล้ว', issues: 'รถช้า', actions: 'เปลี่ยนรอบ', followUps: 'ติดตามพรุ่งนี้',
            vendorBills: { totalToday: 9, entryStatus: 'completed' }
        }
    }]));

    const hydrated = hydrateSelectedDayRecord(date);
    assert.deepStrictEqual(hydrated, { main: true, vendorBills: true });
    assert.deepStrictEqual(
        ['vol-transfer', 'vol-pickup', 'vol-upcountry', 'vol-inmarket', 'vol-outmarket'].map(id => elements[id].value),
        ['1', '2', '3', '4', '5']
    );
    assert.strictEqual(elements['note-pickup'].value, 'ลูกค้า A');
    assert.strictEqual(elements['note-upcountry'].value, 'เชียงใหม่');
    assert.strictEqual(elements['eos-summary'].value, 'เสร็จแล้ว');
    assert.strictEqual(elements['eos-followups'].value, 'ติดตามพรุ่งนี้');
    assert.deepStrictEqual(vendorBillsForm, { totalToday: 9, entryStatus: 'completed' });

    safeStorage.setItem(`kpiDraft_${currentUser}_${currentBranch}_${date}_main`, JSON.stringify({
        volume: { 'vol-transfer': '77' }, notes: {}, endOfShift: { summary: 'ฉบับร่าง' }
    }));
    safeStorage.setItem(`kpiDraft_${currentUser}_${currentBranch}_${date}_vendorBills`, JSON.stringify({ totalToday: 99, entryStatus: 'pending' }));
    elements['vol-transfer'].value = '77';
    elements['eos-summary'].value = 'ฉบับร่างที่ยังไม่บันทึก';
    vendorBillsForm = { totalToday: 99, entryStatus: 'pending' };
    const draftProtected = hydrateSelectedDayRecord(date);
    assert.deepStrictEqual(draftProtected, { main: false, vendorBills: false });
    assert.strictEqual(elements['vol-transfer'].value, '77', 'server hydration must not overwrite a local operations draft');
    assert.strictEqual(elements['eos-summary'].value, 'ฉบับร่างที่ยังไม่บันทึก', 'server hydration must not overwrite a local EoS draft');
    assert.deepStrictEqual(vendorBillsForm, { totalToday: 99, entryStatus: 'pending' }, 'server hydration must not overwrite a Vendor Bills draft');

    safeStorage.removeItem(`kpiDraft_${currentUser}_${currentBranch}_${date}_main`);
    safeStorage.removeItem(`kpiDraft_${currentUser}_${currentBranch}_${date}_vendorBills`);
    _draftTimer = { pending: true };
    elements['vol-transfer'].value = '88';
    const pendingProtected = hydrateSelectedDayRecord(date);
    assert.deepStrictEqual(pendingProtected, { main: false, vendorBills: false });
    assert.strictEqual(elements['vol-transfer'].value, '88', 'pending autosave input must not be clobbered by sync hydration');

    _lastRecordDate = date;
    _draftTimer = { pending: true };
    document.getElementById('record-date').value = '2026-07-15';
    handleRecordDateChange();
    assert.deepStrictEqual(dateSwitchCalls.slice(0, 4), ['clear', `save:${date}`, 'load-tasks', 'restore'],
        'date switching must cancel the prior timer, save visible fields under the prior date, then hydrate the new date');
    assert.strictEqual(_draftTimer, null);
    assert.strictEqual(_lastRecordDate, '2026-07-15');

    safeStorage.setItem('kpiData_AKRA', JSON.stringify([
        { date: '2026-07-14T00:00:00.000Z', marker: 'iso-first' },
        { date: 'Tue Jul 14 2026 00:00:00 GMT+0700', marker: 'legacy-last' }
    ]));
    assert.strictEqual(getSelectedServerDay('2026-07-14').marker, 'legacy-last',
        'selected server day must normalize ISO/legacy date strings and keep the last matching row');

    const mainKey = `kpiDraft_${currentUser}_${currentBranch}_${date}_main`;
    safeStorage.setItem(mainKey, JSON.stringify({
        tasks: [{ name: 'งานค้าง', assignees: ['เฉิน'] }],
        volume: { 'vol-transfer': '7' },
        notes: { 'note-pickup': 'ลูกค้า draft' },
        endOfShift: { summary: 'EoS draft' },
        actions: [{ actionId: 'A-1' }]
    }));
    reconcileSavedMainDraft(date, 'operations');
    let reconciled = JSON.parse(safeStorage.getItem(mainKey));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(reconciled, 'volume'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(reconciled, 'notes'), false);
    assert.strictEqual(reconciled.tasks[0].name, 'งานค้าง');
    assert.strictEqual(reconciled.endOfShift.summary, 'EoS draft');
    assert.strictEqual(reconciled.actions[0].actionId, 'A-1');

    safeStorage.setItem(mainKey, JSON.stringify({ volume: { 'vol-transfer': '3' }, notes: {}, actions: [] }));
    reconcileSavedMainDraft(date, 'operations');
    assert.strictEqual(safeStorage.getItem(mainKey), null, 'a draft containing only the saved section must be removed');
}

{
    let currentBranch = 'AKRA';
    let _lastRecordDate = '2026-07-14';
    let _draftTimer = { pending: true };
    const calls = [];
    let recordDateValue = '2026-07-14';
    const document = {
        getElementById(id) {
            assert.strictEqual(id, 'record-date', 'cross-branch deep link must not dereference a nonexistent branch indicator');
            return {
                get value() { return recordDateValue; },
                set value(value) { recordDateValue = value; calls.push(`date:${value}`); }
            };
        }
    };
    function clearTimeout() { calls.push('clear'); }
    function saveRecordDraft(date) { calls.push(`save:${currentBranch}:${date}`); }
    function selectBranch(branch) { calls.push(`select:${branch}`); currentBranch = branch; calls.push(`init:${branch}`); }
    function switchTab(tab) { calls.push(`tab:${tab}`); }
    function loadTasksForSelectedDate() { calls.push('load-tasks'); }
    function restoreRecordDraft() { calls.push('restore'); }
    eval(extractFunction(html, 'deepLinkToActionSource'));
    deepLinkToActionSource('2026-07-15', 'TRD');
    assert.deepStrictEqual(calls.slice(0, 6), [
        'clear', 'save:AKRA:2026-07-14', 'select:TRD', 'init:TRD', 'tab:record', 'date:2026-07-15'
    ], 'cross-branch action deep link must preserve the source draft and initialize destination before selecting its date');
    assert.strictEqual(currentBranch, 'TRD');
    assert.strictEqual(_lastRecordDate, '2026-07-15');
    assert.doesNotMatch(extractFunction(html, 'deepLinkToActionSource'), /branch-indicator/);
}

for (const [buttonId, label] of [
    ['btn-save-operations', 'บันทึกข้อมูลงานประจำวัน'],
    ['btn-save-end-of-shift', 'บันทึกสรุปรายงานประจำวัน']
]) {
    const buttonPattern = new RegExp(`<button[^>]+id="${buttonId}"[^>]*>[\\s\\S]*?${label}`);
    assert.match(html, buttonPattern, `${buttonId} must be a labelled button`);
    assert.match(html, new RegExp(`id="${buttonId}"[^>]+data-skip-draft-autosave`), `${buttonId} click must not schedule a new draft timer`);
}
for (const cardId of ['zone-2-container', 'daily-eos-card']) {
    assert.match(html, new RegExp(`id="${cardId}"[^>]+data-scoped-save-card`), `${cardId} must define its scoped control-lock boundary`);
}

const operationsHandler = extractFunction(html, 'saveOperationsCard');
const tasksHandler = extractFunction(html, 'saveTasksCard');
const endOfShiftHandler = extractFunction(html, 'saveEndOfShiftCard');
assert.match(operationsHandler, /section: 'operations'/);
assert.doesNotMatch(operationsHandler, /validateVendorBills|workload|errors/);
assert.match(tasksHandler, /section: 'tasks'/);
assert.doesNotMatch(tasksHandler, /validateVendorBills|workload|errors/);
assert.match(endOfShiftHandler, /section: 'endOfShift'/);
assert.doesNotMatch(endOfShiftHandler, /validateVendorBills|workload|errors|vendorBills/);

const postFunction = extractFunction(html, 'postToAppScript');
assert.match(postFunction, /token: sessionToken/, 'section requests must carry the current SSO token');
assert.match(postFunction, /'Content-Type': 'text\/plain;charset=UTF-8'/,
    'authenticated GAS POSTs must use a CORS-safelisted content type so the browser does not send an unsupported OPTIONS preflight');
assert.doesNotMatch(postFunction, /'Content-Type': 'application\/json'/,
    'authenticated GAS POSTs must not trigger an application/json CORS preflight');
const saveConfigStart = backend.indexOf('if (action === "saveConfig")');
const saveConfigEnd = backend.indexOf('// 1.5 สำหรับ Admin/พนักงาน', saveConfigStart);
const saveConfigBlock = backend.slice(saveConfigStart, saveConfigEnd);
assert.match(saveConfigBlock, /requireAuth\(data\.token\)/, 'saveConfig must verify Main SSO before mutation');
assert.match(saveConfigBlock, /isKpiAdminUser\(configAuth\.user\)/, 'saveConfig must require the existing KPI admin contract');
assert.ok(saveConfigBlock.indexOf('requireAuth(data.token)') < saveConfigBlock.indexOf('LockService.getScriptLock()'),
    'authorization must happen before the config mutation lock and Sheet access');

(async () => {
    let _draftTimer = { pending: true };
    let currentBranch = 'AKRA';
    const calls = [];
    const sameCardInput = { disabled: false };
    const preDisabledInput = { disabled: true };
    const unrelatedCardInput = { disabled: false };
    const card = { querySelectorAll() { return [button, sameCardInput, preDisabledInput]; } };
    const button = {
        innerHTML: '<i></i> บันทึกเดิม',
        disabled: false,
        closest(selector) {
            assert.strictEqual(selector, '[data-scoped-save-card]');
            return card;
        }
    };
    const document = { getElementById() { return button; } };
    let postShouldFail = false;
    async function postToAppScript() {
        assert.strictEqual(button.disabled, true, 'save button must lock before POST');
        assert.strictEqual(sameCardInput.disabled, true, 'owning-card control must lock before POST');
        assert.strictEqual(preDisabledInput.disabled, true, 'pre-disabled owning-card control remains disabled during POST');
        assert.strictEqual(unrelatedCardInput.disabled, false, 'unrelated card controls must remain editable');
        calls.push('post');
        if (postShouldFail) return { status: 'error', message: 'network' };
        return { status: 'success' };
    }
    function clearTimeout(timer) { calls.push(timer ? 'clear' : 'clear-empty'); }
    function saveMainRecordDraft(date) { calls.push(`flush-main:${date}`); }
    function reconcileSavedMainDraft(date, section) { calls.push(`reconcile:${date}:${section}`); }
    function showToast() { calls.push('toast'); }
    function showModal() { calls.push('modal'); }
    function sendAppLog() { calls.push('log'); }
    async function syncDataFromSheet() {
        assert.strictEqual(_draftTimer, null, 'success sync must not remain blocked by a pending click timer');
        assert.ok(calls.includes('reconcile:2026-07-14:operations'), 'saved section draft must be reconciled before sync hydration');
        calls.push('sync');
    }
    function loadDashboardData() { calls.push('dashboard'); }
    function updateDailyDashboard() { calls.push('daily-dashboard'); }
    eval(extractFunction(html, 'lockScopedSaveControls'));
    eval(extractFunction(html, 'submitDailySection'));
    const saved = await submitDailySection('btn-save-operations', 'บันทึก', {
        date: '2026-07-14', section: 'operations'
    }, 'สำเร็จ', 'บันทึก');
    assert.strictEqual(saved, true);
    assert.deepStrictEqual(calls.slice(0, 4), [
        'post', 'clear', 'flush-main:2026-07-14', 'reconcile:2026-07-14:operations'
    ], 'confirmed success must cancel pending autosave, flush unrelated input, and reconcile only the saved section');
    assert.strictEqual(button.disabled, false, 'save button must restore after success');
    assert.strictEqual(sameCardInput.disabled, false, 'owning-card control must restore after success');
    assert.strictEqual(preDisabledInput.disabled, true, 'pre-disabled control must remain disabled after success');
    assert.strictEqual(unrelatedCardInput.disabled, false, 'unrelated card control must remain untouched after success');
    assert.match(button.innerHTML, /บันทึก$/, 'save button label must restore after success');

    postShouldFail = true;
    _draftTimer = { pending: true };
    const failed = await submitDailySection('btn-save-operations', 'บันทึก', {
        date: '2026-07-14', section: 'operations'
    }, 'สำเร็จ', 'บันทึก');
    assert.strictEqual(failed, false);
    assert.strictEqual(button.disabled, false, 'save button must restore after error');
    assert.strictEqual(sameCardInput.disabled, false, 'owning-card control must restore after error');
    assert.strictEqual(preDisabledInput.disabled, true, 'pre-disabled control must remain disabled after error');
    assert.strictEqual(unrelatedCardInput.disabled, false, 'unrelated card control must remain untouched after error');
    assert.match(button.innerHTML, /บันทึก$/, 'save button label must restore after error');
    assert.ok(calls.includes('modal'), 'error flow must show feedback');
    assert.doesNotMatch(extractFunction(html, 'submitDailySection'), /saveRecordDraft\(/,
        'scoped success must not create Workload, Errors, or Vendor Bills drafts from hydrated values');
    console.log('Section save isolation checks passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
