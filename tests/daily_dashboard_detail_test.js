const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(content, name) {
    const start = content.indexOf(`function ${name}`);
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

const AKRA_CASE_MARKER = '[AKRA_CASE:';
const TRD_CASE_MARKER = '[TRD_CASE:';
const AKRA_CORE_CATALOG = [
    { core: 'outbound', coreLabel: 'จ่ายออก', type: 'หยิบผิด ถึงลูกค้าแล้ว', penalty: 20 }
];
const HP_PENALTY = { 'จัดบิลผิด': 5, 'คิดเงินพลาด': 15 };
const BRANCH_CONFIG = {
    AKRA: { errorTypes: [] },
    TRD: { errorTypes: [{ group: '1. แคชเชียร์/แอดมิน', options: ['จัดบิลผิด', 'คิดเงินพลาด'] }] }
};
const TRD_DEPARTMENTS = { 'แคชเชียร์/แอดมิน': ['ท็อป'], 'หน้าร้าน / ในร้าน': ['บอย'] };
let activeNames = new Set(['A', 'B', 'ท็อป', 'บอย']);
let GLOBAL_CONFIG_LIST = [];

function isEmployeeActive(name) {
    return activeNames.has(normalizeEmpName(name));
}

const dashboardFunctionNames = [
    'esc',
    'formatDisplayDate',
    'normalizeEmpName',
    'getAkraCatalogItem',
    'parseAkraCaseNote',
    'parseTrdCaseNote',
    'isNoErrorsConfirmation',
    'getRealErrorEntries',
    'getLegacyPenaltyDetail',
    'getErrorDetail',
    'getErrorProcess',
    'getTRDDept',
    'normalizeWorkloadEntry',
    'resolveWorkloadEmployee',
    'getCanonicalWorkloadEntry',
    'getCanonicalWorkloadEntries',
    'getAuthoritativeRoster',
    'getDailyWorkloadState',
    'normalizeVendorBills',
    'normalizeEndOfShiftBrief',
    'hasEndOfShiftContent',
    'parseDateKeyLocal',
    'formatDateKeyLocal',
    'normalizeClientDateKey',
    'selectDailyDashboardActions',
    'buildDailyDashboardErrorState',
    'buildDailyDashboardViewModel',
    'formatDailyDashboardTimestamp',
    'renderDailyDashboardStatus',
    'renderDailyDashboardSection',
    'renderDetailedDailyDashboard'
];
eval(dashboardFunctionNames.map(name => extractFunction(html, name)).join('\n'));

const dashboardElements = new Map([
    'daily-dashboard-content',
    'daily-dashboard-branch-date',
    'daily-dashboard-freshness',
    'daily-status-badge',
    'daily-completeness-details'
].map(id => [id, { innerText: '', innerHTML: '', className: '' }]));
const document = {
    getElementById(id) {
        return dashboardElements.get(id) || null;
    }
};

function akraNote(meta, note) {
    return `${AKRA_CASE_MARKER}${encodeURIComponent(JSON.stringify(meta))}] ${note}`;
}

function trdNote(meta, note) {
    return `${note} ${TRD_CASE_MARKER}${encodeURIComponent(JSON.stringify(meta))}]`;
}

const selectedDate = '2026-07-18';
const longText = 'รายละเอียดบรรทัดแรกที่ต้องแสดงทั้งหมด\nรายละเอียดบรรทัดที่สองซึ่งยาวมากและห้ามถูกตัดทอนเพื่อให้ภาพจับหน้าจอมีหลักฐานครบถ้วน';

const akraMeta = {
    v: 1,
    caseId: 'AKRA-CASE-1',
    core: 'outbound',
    coreLabel: 'จ่ายออก',
    type: 'หยิบผิด ถึงลูกค้าแล้ว',
    penalty: 20,
    participants: ['A', 'B'],
    onDuty: ['A', 'B'],
    updatedBy: 'หัวหน้ากะ',
    updatedAt: '2026-07-18T10:15:00.000Z'
};

const actions = [
    { actionId: 'ACTIVE-SOURCE', branch: 'AKRA', sourceDate: selectedDate, dueDate: '2026-07-20', status: 'Open', title: 'ตรวจสต๊อก', owner: 'A', lastUpdated: '2026-07-18T08:00:00Z' },
    { actionId: 'ACTIVE-DUE', branch: 'AKRA', sourceDate: '2026-07-17', dueDate: selectedDate, status: 'Blocked', title: 'รอเอกสาร', owner: 'B', lastUpdated: '2026-07-18T08:00:00Z' },
    { actionId: 'RESOLVED-TODAY', branch: 'AKRA', sourceDate: '2026-07-16', dueDate: '2026-07-17', status: 'Resolved', resolutionDate: '2026-07-18T09:30:00Z', title: 'ปิดเคส', owner: 'A', lastUpdated: '2026-07-18T09:30:00Z' },
    { actionId: 'RESOLVED-TODAY', branch: 'AKRA', sourceDate: '2026-07-16', status: 'Resolved', resolutionDate: '2026-07-18T09:30:00Z', title: 'ปิดเคสซ้ำเก่า', owner: 'A', lastUpdated: '2026-07-18T09:00:00Z' },
    { actionId: 'REOPENED', branch: 'AKRA', sourceDate: '2026-07-16', dueDate: selectedDate, status: 'Resolved', resolutionDate: selectedDate, title: 'รุ่นเก่า', owner: 'B', lastUpdated: '2026-07-18T07:00:00Z' },
    { actionId: 'REOPENED', branch: 'AKRA', sourceDate: '2026-07-16', dueDate: selectedDate, status: 'In Progress', resolutionDate: '', title: 'เปิดใหม่', owner: 'B', lastUpdated: '2026-07-18T11:00:00Z' },
    { actionId: 'OTHER-BRANCH', branch: 'TRD', sourceDate: selectedDate, dueDate: selectedDate, status: 'Open', title: 'ห้ามปนสาขา', owner: 'ท็อป' }
];

console.log('=== Running Detailed Daily Dashboard Tests ===');

{
    const selected = selectDailyDashboardActions(actions, 'AKRA', selectedDate);
    assert.deepStrictEqual(selected.active.map(item => item.actionId).sort(), ['ACTIVE-DUE', 'ACTIVE-SOURCE', 'REOPENED']);
    assert.deepStrictEqual(selected.resolved.map(item => item.actionId), ['RESOLVED-TODAY']);
    assert.strictEqual(selected.active.find(item => item.actionId === 'REOPENED').title, 'เปิดใหม่',
        'the latest reopened Action must replace its older Resolved duplicate');
}

{
    const dayData = {
        date: selectedDate,
        volume: { transfer: 2, pickup: 3, upcountry: 4, inmarket: 5, outmarket: 6 },
        customerNotes: 'ชื่อลูกค้า นายความลับ และรายละเอียดที่อยู่ต้องไม่ออก dashboard',
        tasks: [{ taskName: 'weekly task must stay excluded', status: 'เสร็จแล้ว' }],
        workload: [
            { employee: 'A', capacity: 10, outbound: 4, inbound: 2, transfer: 1, shared: 1, note: longText, updatedBy: 'หัวหน้ากะ', updatedAt: '2026-07-18T09:00:00Z' },
            { employee: 'B', capacity: 8, outbound: 1, inbound: 3, transfer: 2, shared: 0, note: '', updatedBy: 'หัวหน้ากะ', updatedAt: '2026-07-18T09:05:00Z' }
        ],
        errors: [
            { emp: 'A', type: akraMeta.type, note: akraNote(akraMeta, longText) },
            { emp: 'B', type: akraMeta.type, note: akraNote(akraMeta, longText) }
        ],
        endOfShift: {
            summary: longText,
            issues: 'พบความล่าช้า',
            actions: 'จัดคิวใหม่',
            followUps: 'ตรวจซ้ำพรุ่งนี้',
            vendorBills: { totalToday: 12, entryStatus: 'pending', pendingAccumulated: 3, pendingNote: longText, updatedBy: 'บัญชี', updatedAt: '2026-07-18T10:30:00Z' }
        }
    };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA', date: selectedDate, dayData, actions, actionsLoaded: true,
        activeEmployees: ['A', 'B'], fallbackRoster: [], cacheTimestamp: Date.parse('2026-07-18T10:35:00Z')
    });

    assert.strictEqual(model.completeness.isComplete, true);
    assert.deepStrictEqual(model.roster.names, ['A', 'B']);
    assert.strictEqual(model.workload.entries[0].total, 8);
    assert.strictEqual(model.workload.entries[0].primaryHours, 8);
    assert.strictEqual(model.workload.entries[0].secondaryHours, 0);
    assert.strictEqual(model.workload.entries[0].isLegacy, true);
    assert.strictEqual(model.workload.entries[0].note, longText, 'long Workload notes must remain intact');
    assert.strictEqual(model.errors.cases.length, 1, 'participant rows sharing a case ID must render as one real case');
    assert.deepStrictEqual(model.errors.cases[0].employees, ['A', 'B']);
    assert.strictEqual(model.errors.cases[0].reporter, 'หัวหน้ากะ');
    assert.strictEqual(model.vendorBills.pendingNote, longText);
    assert.strictEqual(model.brief.fields.summary, longText);
    assert.strictEqual(model.actions.active.length, 3);
    assert.strictEqual(model.actions.resolved.length, 1);
    assert.strictEqual(JSON.stringify(model).includes('นายความลับ'), false, 'customer identity/notes must never enter the view model');
    assert.strictEqual(JSON.stringify(model).includes('weekly task'), false, 'weekly Tasks must stay excluded');
    renderDetailedDailyDashboard(model);
    const rendered = dashboardElements.get('daily-dashboard-content').innerHTML;
    assert.strictEqual(rendered.includes('แสดงเฉพาะจำนวนรวม ไม่แสดงชื่อลูกค้าหรือหมายเหตุลูกค้า'), false,
        'the dashboard must not render redundant privacy guidance');
    assert.strictEqual(rendered.includes('หัวหน้ากะ'), false, 'recorder/updater names must not render');
    assert.strictEqual(rendered.includes('บัญชี'), false, 'Vendor updater names must not render');
    assert.strictEqual(rendered.includes('บันทึกโดย'), false);
    assert.strictEqual(rendered.includes('อัปเดตโดย'), false);
    assert.ok(rendered.includes('ทีมเข้ากะ &amp; Workload'), 'roster and Workload must share one section');
    assert.ok(rendered.includes('ข้อมูล Workload เดิม'), 'legacy Workload must expose its compatibility path');
}

{
    GLOBAL_CONFIG_LIST = [{
        uid: 'AKRA12123',
        name: 'TRAINEE (SORN)',
        status: 'Active',
        aliasUids: ['TRAINEE_SORN'],
        aliasNames: ['SORN']
    }];
    activeNames.add('TRAINEE (SORN)');
    const zeroMeta = {
        v: 1,
        caseId: 'NO_ERRORS',
        onDuty: ['SORN'],
        updatedBy: 'AKRA12123',
        updatedAt: '2026-07-18T08:00:00Z'
    };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA',
        date: selectedDate,
        configList: GLOBAL_CONFIG_LIST,
        dayData: {
            date: selectedDate,
            volume: { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            workload: [{
                employeeUid: 'TRAINEE_SORN',
                employee: 'SORN',
                capacity: 10,
                primaryCore: 'คลัง W1',
                supportDuties: [{ name: 'แวะขึ้นของ', hours: 3 }]
            }],
            errors: [{ emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: akraNote(zeroMeta, 'ยืนยัน 0') }],
            endOfShift: { summary: 'ปิดงานครบ', vendorBills: { totalToday: 0, entryStatus: 'completed' } }
        },
        actions: [],
        actionsLoaded: true,
        activeEmployees: ['TRAINEE (SORN)'],
        fallbackRoster: [],
        cacheTimestamp: 1
    });

    assert.deepStrictEqual(model.roster.names, ['TRAINEE (SORN)'], 'the selected-day roster must use the exact canonical Main label');
    assert.strictEqual(model.workload.recordedCount, 1, 'the legacy UID must count once against its canonical roster row');
    assert.strictEqual(model.workload.entries[0].employeeUid, 'AKRA12123');
    assert.strictEqual(model.workload.entries[0].employee, 'TRAINEE (SORN)');
    assert.strictEqual(model.workload.entries[0].primaryHours, 7);
    assert.strictEqual(model.workload.entries[0].secondaryHours, 3);
    assert.strictEqual(model.workload.entries[0].total, 10);
    renderDetailedDailyDashboard(model);
    const rendered = dashboardElements.get('daily-dashboard-content').innerHTML;
    assert.ok(rendered.includes('งานหลัก · คลัง W1'));
    assert.ok(rendered.includes('7 ชม.'));
    assert.ok(rendered.includes('งานรอง'));
    assert.ok(rendered.includes('3 ชม.'));
    assert.ok(rendered.includes('10 / 10 ชม.'));
    assert.strictEqual(rendered.includes('จ่ายออก'), false, 'the selected-day card must not present the obsolete four-bucket model');
    GLOBAL_CONFIG_LIST = [];
}

{
    GLOBAL_CONFIG_LIST = [
        { uid: 'A', name: 'Shared Name', roles: ['AKRA'], branches: 'AKRA', status: 'Active' },
        { uid: 'B', name: 'Shared Name', roles: ['AKRA'], branches: 'AKRA', status: 'Active' }
    ];
    activeNames.add('Shared Name');
    const rosterMeta = {
        v: 1,
        caseId: 'NO_ERRORS',
        onDuty: ['Shared Name', 'Shared Name'],
        onDutyRoster: [{ uid: 'A', name: 'Shared Name' }, { uid: 'B', name: 'Shared Name' }],
        updatedAt: '2026-07-18T08:00:00Z'
    };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA', date: selectedDate, configList: GLOBAL_CONFIG_LIST,
        dayData: {
            date: selectedDate,
            volume: { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            workload: [
                { employeeUid: 'A', employee: 'Shared Name', capacity: 10, primaryCore: 'คลัง W1', supportDuties: [] },
                { employeeUid: 'B', employee: 'Shared Name', capacity: 10, primaryCore: 'คลัง W2', supportDuties: [] }
            ],
            errors: [{ emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: akraNote(rosterMeta, 'ยืนยัน 0') }],
            endOfShift: { summary: 'ปิดงานครบ', vendorBills: { totalToday: 0, entryStatus: 'completed' } }
        },
        actions: [], actionsLoaded: true, activeEmployees: GLOBAL_CONFIG_LIST, fallbackRoster: [], cacheTimestamp: 1
    });
    assert.deepStrictEqual(model.roster.names, ['Shared Name', 'Shared Name'],
        'selected-day roster labels may repeat when their stable Main UIDs are distinct');
    assert.strictEqual(model.workload.expectedCount, 2);
    assert.strictEqual(model.workload.recordedCount, 2);
    assert.strictEqual(model.workload.entries.length, 2);
    GLOBAL_CONFIG_LIST = [];
}

{
    const zeroMeta = { v: 1, caseId: 'NO_ERRORS', onDuty: ['A'], updatedBy: 'A', updatedAt: '2026-07-18T08:00:00Z' };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA', date: selectedDate,
        dayData: {
            date: selectedDate,
            volume: { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            workload: [{ employee: 'A', capacity: 0, outbound: 0, inbound: 0, transfer: 0, shared: 0 }],
            errors: [{ emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: akraNote(zeroMeta, 'ยืนยันไม่มีความผิดพลาด') }],
            endOfShift: { summary: 'ไม่มีงานค้าง', vendorBills: { totalToday: 0, entryStatus: 'completed' } }
        },
        actions: [], actionsLoaded: true, activeEmployees: ['A'], fallbackRoster: [], cacheTimestamp: 1
    });
    assert.strictEqual(model.operations.state, 'confirmed');
    assert.ok(model.operations.items.every(item => item.value === 0), 'confirmed zero operation counts must remain numeric zero');
    assert.strictEqual(model.errors.state, 'zero');
    assert.strictEqual(model.vendorBills.totalToday, 0);
    assert.strictEqual(model.brief.state, 'complete', 'blank optional Brief fields must mean no issue, not incomplete');
    assert.strictEqual(model.actions.state, 'ready');
    renderDetailedDailyDashboard(model);
    const rendered = dashboardElements.get('daily-dashboard-content').innerHTML;
    assert.ok(rendered.includes('ไม่มีปัญหา'));
    assert.ok(rendered.includes('ไม่ต้องดำเนินการเพิ่มเติม'));
    assert.ok(rendered.includes('ไม่มีเรื่องต้องติดตาม'));
    assert.strictEqual(rendered.includes('Daily Brief ('), false, 'optional blanks must not produce an incomplete x/4 label');
}

{
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA', date: selectedDate, dayData: null, actions: [], actionsLoaded: false,
        activeEmployees: ['A', 'B'], fallbackRoster: [], cacheTimestamp: 0
    });
    assert.strictEqual(model.completeness.isComplete, false);
    assert.strictEqual(model.operations.state, 'missing');
    assert.strictEqual(model.roster.state, 'missing');
    assert.strictEqual(model.errors.state, 'missing');
    assert.strictEqual(model.vendorBills.state, 'missing');
    assert.strictEqual(model.brief.state, 'missing');
    assert.strictEqual(model.actions.state, 'loading');
    renderDetailedDailyDashboard(model);
    const rendered = dashboardElements.get('daily-dashboard-content').innerHTML;
    assert.ok(rendered.includes('ทีมเข้ากะ &amp; Workload'));
    assert.ok(rendered.includes('ยังไม่มี roster ที่ยืนยันสำหรับวันที่เลือก'));
}

{
    const model = buildDailyDashboardViewModel({
        branch: 'TRD', date: selectedDate,
        dayData: { date: selectedDate, endOfShift: { summary: '', issues: '', actions: '', followUps: '' } },
        actions: [], actionsLoaded: true, activeEmployees: ['ท็อป'], fallbackRoster: [], cacheTimestamp: 1
    });
    assert.strictEqual(model.errors.state, 'zero', 'a saved day without Error entries must mean no problem');
    assert.strictEqual(model.errors.assumedZero, true);
    assert.strictEqual(model.completeness.missing.includes('Errors'), false);
    renderDetailedDailyDashboard(model);
    assert.ok(dashboardElements.get('daily-dashboard-content').innerHTML.includes('ไม่พบการบันทึกความผิดพลาดในวันที่เลือก'));
}

{
    const trdErrors = [
        { emp: 'ท็อป', type: 'จัดบิลผิด', note: trdNote({ v: 1, caseId: 'TRD-1', updatedBy: 'หัวหน้า TRD', updatedAt: '2026-07-18T09:00:00Z' }, '[แก้ไขได้ก่อนส่ง] แก้บิลแล้ว') },
        { emp: 'ท็อป', type: 'คิดเงินพลาด', note: trdNote({ v: 1, caseId: 'TRD-2', updatedBy: 'หัวหน้า TRD', updatedAt: '2026-07-18T10:00:00Z' }, longText) },
        { emp: 'บอย', type: 'จัดบิลผิด', note: trdNote({ v: 1, caseId: 'TRD-3' }, 'ตรวจพบหน้าร้าน') }
    ];
    const model = buildDailyDashboardViewModel({
        branch: 'TRD', date: selectedDate,
        dayData: { date: selectedDate, errors: trdErrors, endOfShift: { summary: 'ปิดงานครบ', issues: '', actions: '', followUps: '' } },
        actions: [{ actionId: 'TRD-A', branch: 'TRD', sourceDate: selectedDate, status: 'Open', title: 'ติดตามหน้าร้าน', owner: 'ท็อป' }],
        actionsLoaded: true, activeEmployees: ['ท็อป', 'บอย'], fallbackRoster: [], cacheTimestamp: 1
    });
    assert.strictEqual(model.workload, null, 'TRD must not render false Workload zeroes');
    assert.strictEqual(model.vendorBills, null, 'TRD must not render false Vendor Bills zeroes');
    assert.strictEqual(model.operations.state, 'confirmed');
    assert.strictEqual(model.operations.contract, 'trd-summary');
    assert.strictEqual(model.errors.cases.length, 3);
    assert.strictEqual(model.errors.cases[0].departments[0], 'แคชเชียร์/แอดมิน');
    assert.strictEqual(model.errors.dailyHpImpact['ท็อป'], 15, 'TRD daily HP impact must use the worst event per employee');
    assert.strictEqual(model.errors.dailyHpImpact['บอย'], 5);
    assert.strictEqual(model.errors.cases[1].note, longText, 'long TRD error detail must remain intact');
}

{
    const noError = { v: 1, caseId: 'NO_ERRORS', updatedBy: 'หัวหน้า TRD', updatedAt: '2026-07-18T08:00:00Z' };
    const state = buildDailyDashboardErrorState([
        { emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: trdNote(noError, 'ยืนยันไม่มีความผิดพลาด') }
    ], 'TRD');
    assert.strictEqual(state.state, 'zero');
    assert.strictEqual(state.cases.length, 0);
    assert.strictEqual(state.updatedBy, 'หัวหน้า TRD');
}

{
    const zeroMeta = { v: 1, caseId: 'NO_ERRORS', onDuty: ['A'], updatedBy: 'A', updatedAt: '2026-07-18T08:00:00Z' };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA',
        date: selectedDate,
        dayData: {
            date: selectedDate,
            volume: { transfer: 0 },
            workload: [{ employee: 'A', capacity: 10, outbound: 1, inbound: 0, transfer: 0, shared: 0 }],
            errors: [{ emp: 'SYSTEM', type: 'ไม่มีความผิดพลาด', note: akraNote(zeroMeta, 'ยืนยัน 0') }],
            endOfShift: {
                summary: 'สรุปเฉพาะผลงาน',
                vendorBills: { totalToday: 3, entryStatus: 'pending', pendingAccumulated: 1, pendingNote: '' }
            }
        },
        actions: [],
        actionsLoaded: true,
        activeEmployees: ['A'],
        fallbackRoster: [],
        cacheTimestamp: 1
    });
    assert.strictEqual(model.operations.state, 'partial', 'a partial volume object must not be called confirmed');
    assert.strictEqual(model.vendorBills.state, 'partial', 'pending Vendor Bills require count and note');
    assert.strictEqual(model.brief.state, 'complete', 'blank optional Brief fields must be treated as no issue');
    assert.ok(model.completeness.missing.includes('จำนวนงานประจำวัน'));
    assert.ok(model.completeness.missing.includes('Vendor Bills'));
    assert.strictEqual(model.completeness.missing.includes('Daily Brief'), false);
}

{
    const model = buildDailyDashboardViewModel({
        branch: 'TRD',
        date: selectedDate,
        dayData: null,
        actions: [],
        actionsLoaded: true,
        dailyDataError: '<โหลดล้มเหลว>',
        activeEmployees: ['ท็อป'],
        fallbackRoster: [],
        cacheTimestamp: 1
    });
    assert.strictEqual(model.dataState.state, 'error');
    assert.strictEqual(model.dataState.hasCachedDay, false);
    assert.ok(model.completeness.missing.includes('การซิงค์ข้อมูลล่าสุด'));
    renderDetailedDailyDashboard(model);
    assert.ok(dashboardElements.get('daily-dashboard-content').innerHTML.includes('&lt;โหลดล้มเหลว&gt;'),
        'daily-data errors must render distinctly and remain escaped');
}

{
    const hostile = '<img src=x onerror=alert(1)>';
    activeNames.add(hostile);
    const meta = {
        v: 1,
        caseId: 'HOSTILE-1',
        core: 'outbound',
        coreLabel: 'จ่ายออก',
        type: 'หยิบผิด ถึงลูกค้าแล้ว',
        penalty: 20,
        participants: [hostile],
        onDuty: [hostile],
        updatedBy: '<svg/onload=alert(2)>',
        updatedAt: '2026-07-18T10:00:00Z'
    };
    const model = buildDailyDashboardViewModel({
        branch: 'AKRA',
        date: selectedDate,
        dayData: {
            date: selectedDate,
            volume: { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            customerNotes: '<script>customer secret</script>',
            workload: [{ employee: hostile, capacity: 10, outbound: 1, inbound: 0, transfer: 0, shared: 0, note: '<script>alert(3)</script>' }],
            errors: [{ emp: hostile, type: meta.type, note: akraNote(meta, '<script>alert(4)</script>') }],
            endOfShift: {
                summary: '<script>alert(5)</script>',
                issues: 'ไม่มี',
                actions: 'ไม่มี',
                followUps: 'ไม่มี',
                vendorBills: { totalToday: 0, entryStatus: 'completed' }
            }
        },
        actions: [{ actionId: 'XSS-1', branch: 'AKRA', sourceDate: selectedDate, status: 'Open', title: '<svg/onload=alert(6)>', owner: hostile }],
        actionsLoaded: true,
        activeEmployees: [hostile],
        fallbackRoster: [],
        cacheTimestamp: 1
    });
    renderDetailedDailyDashboard(model);
    const rendered = dashboardElements.get('daily-dashboard-content').innerHTML;
    assert.strictEqual(/<(?:script|img|svg)[\s/>]/i.test(rendered), false, 'hostile values must not become executable markup');
    assert.ok(rendered.includes('&lt;script&gt;alert(5)&lt;/script&gt;'));
    assert.strictEqual(rendered.includes('customer secret'), false, 'customer notes must remain outside rendered HTML');
}

assert.ok(html.includes('id="daily-dashboard-content"'), 'dashboard must expose the new semantic rendering root');
assert.ok(!/daily-(?:workload|errors|vendor)-details[^>]*line-clamp/.test(html), 'daily detail must not be line-clamped');
assert.ok(extractFunction(html, 'updateDailyDashboard').includes('fallbackRoster: []'),
    'runtime dashboard must not confirm the unsaved/default form roster');
assert.ok(extractFunction(html, 'renderDetailedDailyDashboard').includes('xl:grid-cols-3'),
    'Workload cards should use a denser desktop grid');
assert.strictEqual(extractFunction(html, 'renderDetailedDailyDashboard').includes("renderDailyDashboardSection('ทีมเข้ากะ'"), false,
    'the dashboard must not render a separate roster section');

const recordViewStart = html.indexOf('<div id="view-record"');
const dashboardViewStart = html.indexOf('<div id="view-dashboard"');
const adminDashboardViewStart = html.indexOf('<div id="view-admin-dash"');
const dailyDashboardStart = html.indexOf('<section id="daily-dashboard-card"');
const dashboardWeekSelectorStart = html.indexOf('id="dash-week-label"', dashboardViewStart);
const dailyReportStart = html.indexOf('aria-labelledby="dash-eos-title"', dashboardViewStart);
assert.ok(dailyDashboardStart > dashboardViewStart && dailyDashboardStart < adminDashboardViewStart,
    'the detailed daily summary must live inside the Dashboard view');
assert.strictEqual(dailyDashboardStart > recordViewStart && dailyDashboardStart < dashboardViewStart, false,
    'the detailed daily summary must no longer live inside the Record view');
assert.ok(dashboardWeekSelectorStart < dailyReportStart && dailyReportStart < dailyDashboardStart,
    'the Daily Report must be the first Dashboard report section after the week selector');
assert.ok(extractFunction(html, 'updateDailyDashboard').includes("dashboardSelectedDate !== 'ALL'"),
    'an explicitly selected Dashboard day must drive the detailed daily summary');
assert.ok(extractFunction(html, 'switchTab').includes('updateDailyDashboard()'),
    'opening Dashboard must refresh the detailed daily summary');
assert.ok(extractFunction(html, 'setDashboardSelectedDate').includes('updateDailyDashboard()'),
    'selecting a Dashboard day must refresh the detailed daily summary');
assert.ok(extractFunction(html, 'changeWeek').includes('updateDailyDashboard()'),
    'changing the Dashboard week must clear any stale selected-day summary');

console.log('Detailed Daily Dashboard checks passed.');
