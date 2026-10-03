'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function source(name) {
    let start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (html.slice(start - 6, start) === 'async ') start -= 6;
    const open = html.indexOf('{', start);
    let depth = 1;
    for (let i = open + 1; i < html.length; i++) {
        if (html[i] === '{') depth++;
        if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
    }
    throw Error(`Unclosed function ${name}`);
}
function rig() {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '' });
        return nodes.get(id);
    };
    const c = vm.createContext({
        GLOBAL_CONFIG_LIST: [], USER_DB: {}, TRD_DEPARTMENTS: {},
        BRANCH_CONFIG: { AKRA: { employees: [] }, TRD: { employees: [] } },
        window: {}, document: { getElementById: node }, esc: String,
        currentBranch: 'TRD', currentUser: 'lead-a', currentRoles: ['AKRA', 'SUPERVISOR'],
        IS_ADMIN: false, selectedErrWorker: '', selectedErrCatcher: '',
        getAkraOnDutyEmployees() { return c.BRANCH_CONFIG.AKRA.employees; },
        initApp(branch, permissions) { c.navigation = { branch, permissions: Array.from(permissions) }; },
        showBranchSelector(permissions) { c.navigation = { permissions: Array.from(permissions) }; },
        showModal() { throw Error('Unexpected access rejection'); }
    });
    for (const name of ['getBranchesFromMainRoles', 'dedupeConfigList', 'normalizeMainEmployeeStatus',
        'processConfigList', 'getBranchRosterEmployees', 'getBranchActiveRoster', 'renderErrEmpChips',
        'applyRolePermissions']) vm.runInContext(source(name), c);
    return { c, node };
}
const staff = (uid, name, roles, extra = {}) => ({ uid, name, roles, status: 'Active', ...extra });
const names = (c, branch) => Array.from(c.BRANCH_CONFIG[branch].employees);

test('legacy API: Supervisor access does not add a second KPI home', () => {
    const { c } = rig();
    c.processConfigList([
        staff('lead-a', 'Warehouse Lead', ['AKRA', 'SUPERVISOR'], { branches: 'AKRA,TRD' }),
        staff('lead-t', 'Store Lead', ['CASHIER', 'SUPERVISOR'], { branches: 'AKRA,TRD' })
    ]);
    assert.deepEqual(names(c, 'AKRA'), ['Warehouse Lead']);
    assert.deepEqual(names(c, 'TRD'), ['Store Lead']);
    assert.deepEqual(Array.from(c.USER_DB['lead-a']), ['AKRA', 'TRD']);
    assert.deepEqual(Array.from(c.USER_DB['lead-t']), ['AKRA', 'TRD']);
    c.applyRolePermissions();
    assert.deepEqual(c.navigation, { branch: 'TRD', permissions: ['AKRA', 'TRD'] });
});

test('current API: authoritative roster home is distinct from access branches', () => {
    const { c } = rig();
    c.processConfigList([
        staff('legacy', 'Legacy Store Lead', ['SUPERVISOR'], { branches: 'AKRA,TRD', rosterBranches: ['TRD'] }),
        staff('dual', 'Dual Role Home', ['AKRA', 'TRD'], { branches: 'AKRA,TRD', rosterBranches: ['AKRA'] }),
        staff('denied', 'Unenrolled', ['AKRA'], { branches: 'AKRA', rosterBranches: [] })
    ]);
    assert.deepEqual(names(c, 'AKRA'), ['Dual Role Home']);
    assert.deepEqual(names(c, 'TRD'), ['Legacy Store Lead']);
    assert.deepEqual(Array.from(c.USER_DB.legacy), ['AKRA', 'TRD']);
});

test('ambiguous homes fail closed and roleless unique legacy membership survives', () => {
    const { c } = rig();
    c.processConfigList([
        staff('unknown', 'No Home', ['SUPERVISOR'], { branches: 'AKRA,TRD' }),
        staff('dual', 'Two Homes', ['AKRA', 'TRD'], { branches: 'AKRA,TRD' }),
        staff('invalid', 'Invalid Projection', ['AKRA'], { rosterBranches: ['AKRA', 'TRD'] }),
        staff('legacy', 'Roleless Store', [], { branches: 'TRD' })
    ]);
    assert.deepEqual(names(c, 'AKRA'), []);
    assert.deepEqual(names(c, 'TRD'), ['Roleless Store']);
});

test('case-normalized roles, inactive staff, Admin and verified aliases retain identity rules', () => {
    const { c } = rig();
    c.processConfigList([
        staff('canonical', 'Current Lead', [' warehouse ', ' supervisor '],
            { status: 'active', aliasUids: ['former'], aliasNames: ['Former Lead'] }),
        staff('former', 'Former Lead', ['AKRA']),
        staff('inactive', 'Inactive Staff', ['TRD'], { status: 'Inactive', rosterBranches: ['TRD'] }),
        staff('admin', 'Admin', ['ADMIN', 'AKRA'], { rosterBranches: ['AKRA'] })
    ]);
    assert.deepEqual(names(c, 'AKRA'), ['Current Lead']);
    assert.deepEqual(names(c, 'TRD'), []);
    assert.deepEqual(Array.from(c.getBranchRosterEmployees('AKRA'), row => row.uid), ['canonical']);
    assert.equal(c.GLOBAL_CONFIG_LIST.some(row => row.uid === 'former'), false);
});

test('actual TRD incident worker and catcher controls exclude the warehouse Supervisor', () => {
    const { c, node } = rig();
    c.processConfigList([
        staff('lead-a', 'Warehouse Lead', ['AKRA', 'SUPERVISOR'], { branches: 'AKRA,TRD' }),
        staff('store', 'Store Staff', ['TRD'], { dept: 'หน้าร้าน/ในร้าน' })
    ]);
    c.renderErrEmpChips();
    for (const id of ['pc-err-emp-chips', 'pc-err-catcher-chips']) {
        assert.equal(node(id).innerHTML.includes('Warehouse Lead'), false);
        assert.equal(node(id).innerHTML.includes('Store Staff'), true);
    }
    assert.deepEqual(Array.from(c.TRD_DEPARTMENTS['หน้าร้าน/ในร้าน']), ['Store Staff']);
    assert.deepEqual(Array.from(c.getBranchRosterEmployees('TRD'), row => row.uid), ['store']);
});

test('refreshing current membership preserves aliases and changes no historical data', () => {
    const { c } = rig();
    const history = [{ branch: 'TRD', employeeUid: 'former', employee: 'Former Lead', penalty: 3 }];
    c.rawData = history;
    const snapshot = JSON.stringify(history);
    const row = staff('canonical', 'Current Lead', ['AKRA', 'SUPERVISOR'],
        { rosterBranches: ['AKRA'], aliasUids: ['former'], aliasNames: ['Former Lead'] });
    c.processConfigList([row]);
    c.processConfigList([{ ...row, rosterBranches: ['TRD'], roles: ['TRD', 'SUPERVISOR'] }]);
    assert.deepEqual(names(c, 'AKRA'), []);
    assert.deepEqual(names(c, 'TRD'), ['Current Lead']);
    assert.equal(JSON.stringify(c.rawData), snapshot);
    assert.deepEqual(Array.from(c.GLOBAL_CONFIG_LIST[0].aliasUids), ['former']);
});

test('reprocessing cached roleless employees retains original branch access', () => {
    const { c } = rig();
    c.processConfigList([staff('legacy', 'Roleless Lead', [], { branches: 'AKRA,TRD', rosterBranches: ['TRD'] })]);
    const cached = JSON.parse(JSON.stringify(c.GLOBAL_CONFIG_LIST));
    c.processConfigList(cached);
    assert.deepEqual(Array.from(c.USER_DB.legacy), ['AKRA', 'TRD']);
    assert.deepEqual(names(c, 'TRD'), ['Roleless Lead']);
});

async function revalidate(editing = false) {
    const { c, node } = rig();
    let finish;
    const fresh = new Promise(resolve => { finish = resolve; });
    const cachedRows = [
        staff('lead-t', 'Legacy Store Lead', ['SUPERVISOR'], { branches: 'AKRA,TRD' }),
        staff('store', 'Store Staff', ['TRD'])
    ];
    const local = new Map([['kpi_cached_config', JSON.stringify({ employees: cachedRows })]]);
    Object.assign(c, {
        kpiVerifiedSession: {}, kpiConfigRequest: 0, sessionToken: 'synthetic-token',
        getKpiPageToken: () => 'synthetic-token', isCurrentKpiSession: () => true,
        KPI_MAIN_VIEWER: null, KPI_WORKLOAD_STATUS: {}, KPI_SYSTEM_CONFIG: null,
        safeStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
        populateAdminEmpFilter() {}, applySystemConfig() {}, console: { warn() {} },
        handleKpiAuthFailure() { throw Error('unexpected denial'); },
        AkraSupabaseKPI: { getConfig: () => fresh }
    });
    c.window.AkraSupabaseKPI = c.AkraSupabaseKPI;
    if (editing) {
        c.window.KpiIncident = c.KpiIncident = { enabled: () => true,
            state: { editing: true, participantsChanged: false } };
        c.selectedErrWorker = 'Original Worker';
        c.selectedErrCatcher = 'Original Catcher';
    }
    vm.runInContext(source('loadConfig'), c);
    await c.loadConfig();
    c.renderErrEmpChips();
    finish({ employees: cachedRows.map(row => ({ ...row, rosterBranches: ['TRD'] })) });
    await new Promise(setImmediate);
    return { c, node };
}

test('fresh API membership updates already-rendered cached incident controls', async () => {
    const { node } = await revalidate();
    assert.equal(node('pc-err-emp-chips').innerHTML.includes('Legacy Store Lead'), true);
    assert.equal(node('pc-err-catcher-chips').innerHTML.includes('Legacy Store Lead'), true);
});

test('config refresh retains original worker and catcher of an incident under edit', async () => {
    const { c } = await revalidate(true);
    assert.equal(c.selectedErrWorker, 'Original Worker');
    assert.equal(c.selectedErrCatcher, 'Original Catcher');
});

test('an authoritative empty TRD roster does not invent historical default staff', () => {
    const { c, node } = rig();
    c.processConfigList([
        staff('unknown', 'ปิ่น', ['SUPERVISOR'], { branches: 'AKRA,TRD', rosterBranches: [] }),
        staff('inactive', 'ท็อป', ['TRD'], { status: 'Inactive', rosterBranches: [] })
    ]);
    assert.deepEqual(Array.from(c.getBranchActiveRoster('TRD')), []);
    c.renderErrEmpChips();
    assert.equal(node('pc-err-emp-chips').innerHTML.includes('ปิ่น'), false);
    assert.equal(node('pc-err-catcher-chips').innerHTML.includes('ท็อป'), false);
});

test('fresh roster also refreshes the detector select and preserves its selected historical value', async () => {
    const { c, node } = await revalidate();
    assert.equal(node('impact-detector').innerHTML.includes('Legacy Store Lead'), true);
    node('impact-detector').value = 'Historical Detector';
    c.renderErrEmpChips();
    assert.equal(node('impact-detector').value, 'Historical Detector');
    assert.equal(node('impact-detector').innerHTML.includes('Historical Detector'), true);
});
