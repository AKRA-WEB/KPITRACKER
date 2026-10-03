// Actual page/cache/refresh functions and Incident renderer. Synthetic storage,
// DOM and API replies only; no network, live tokens or operational records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.KPI_SOURCE || path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(source => source.trim());
const incidentScript = fs.readFileSync(path.join(root, 'js/incident-impact.js'), 'utf8');
const clientScript = fs.readFileSync(path.join(root, 'js/supabase-kpi-client.js'), 'utf8');
const tick = () => new Promise(setImmediate);
const original = {
    identityId: '10000000-0000-4000-8000-000000000001', id: 'fixture-admin',
    sessionVersion: 1, authorizationRevision: 'fixture-revision', roles: ['ADMIN']
};
const incident = {
    schemaVersion: 3, scoringMode: 'none', kind: 'case', caseId: 'ERR-FIXTURE-1',
    typeId: 'fixture', type: 'Fixture incident', category: 'C1', impact: '',
    penalty: 0, worker: 'Fixture Worker', emp: 'Fixture Worker',
    participants: ['Fixture Worker'], responsibility: 'individual', note: 'Synthetic fixture'
};
const dailyReply = () => [{
    date: '2026-10-02', branch: 'TRD',
    volume: {transfer: 0, pickup: 1, upcountry: 0, inmarket: 0, outmarket: 0}, tasks: []
}];
const incidentReply = () => ({records: [{
    date: '2026-10-02', errors: [{...incident}], incidents: [{...incident}], zeroConfirmed: false
}]});

function fixture({failWrites = false, stale = false} = {}) {
    const nodes = new Map(), errors = [], calls = [];
    const node = id => {
        if (!nodes.has(id)) {
            const classes = new Set(id.startsWith('view-') && id !== 'view-dashboard' ? ['hidden'] : []);
            const parent = {hidden: false};
            nodes.set(id, {
                value: id.startsWith('record-date') ? '2026-10-02' : '',
                textContent: '', innerText: '', innerHTML: '', disabled: false,
                parentElement: parent, hidden: false, style: {setProperty() {}},
                classList: {
                    add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name),
                    toggle(name, force) {
                        if (force === undefined ? !classes.has(name) : force) classes.add(name);
                        else classes.delete(name);
                    }
                },
                addEventListener() {}, setAttribute() {}, removeAttribute() {},
                querySelectorAll: () => [], closest: () => parent
            });
        }
        return nodes.get(id);
    };
    const storage = () => {
        const data = new Map();
        const control = {failWrites, failReads: false, failRemoves: false};
        const api = {
            getItem(key) {
                if (control.failReads) throw Error('Synthetic read unavailable');
                return data.get(key) ?? null;
            },
            setItem(key, value) {
                if (control.failWrites === true || (typeof control.failWrites === 'function' && control.failWrites(key))) {
                    const error = Error('Synthetic capacity reached');
                    error.name = 'QuotaExceededError';
                    throw error;
                }
                data.set(key, String(value));
            },
            removeItem(key) {
                if (control.failRemoves) throw Error('Synthetic removal unavailable');
                data.delete(key);
            },
            get length() {return data.size;}, key: index => [...data.keys()][index]
        };
        return {data, control, api};
    };
    const local = storage(), tab = storage();
    class FixtureDate extends Date {
        constructor(...args) {super(...(args.length ? args : ['2026-10-03T05:00:00Z']));}
        static now() {return Date.parse('2026-10-03T05:00:00Z');}
    }
    const c = {
        console: {log() {}, warn() {}, error: (...args) => errors.push(args)},
        document: {getElementById: node, querySelectorAll: () => [], addEventListener() {}, body: node('body')},
        location: {search: '', hostname: 'localhost'}, navigator: {},
        localStorage: local.api, sessionStorage: tab.api,
        setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
        URL, URLSearchParams, Date: FixtureDate, alert() {}, confirm: () => true
    };
    c.window = c;
    c.addEventListener = () => {};
    vm.createContext(c);
    vm.runInContext(incidentScript, c);
    for (const source of scripts) new vm.Script(source).runInContext(c);
    const run = source => vm.runInContext(source, c);
    const user = (value = original, token = 'fixture-token') => {
        c.fixtureOwner = {user: {...value}, token};
        run('kpiVerifiedSession=fixtureOwner;sessionToken=fixtureOwner.token;currentUser=fixtureOwner.user.id;');
    };
    user();
    run("currentBranch='TRD';viewOffsetWeek=0;dashboardSelectedDate='ALL';GLOBAL_CONFIG_LIST=[{uid:'fixture-worker',name:'Fixture Worker',status:'Active',branches:'TRD',dept:'Cashier'}];KPI_SYSTEM_CONFIG={incidentModel:{schemaVersion:3,active:true,branches:{TRD:{types:[],impacts:[]},AKRA:{types:[],impacts:[]}}}};");
    // Only unrelated panels/forms are stubbed. Cache, refresh sequencing,
    // Incident hydration/timeline and weekly Dashboard renderer stay actual.
    run('renderEndOfShiftDashboard=()=>{};renderVendorBillsDashboard=()=>{};renderEmpBreakdown=()=>{};renderWorkloadTrend=()=>{};loadTasksForSelectedDate=()=>{};hydrateSelectedDayRecord=()=>{};updateDailyDashboard=()=>{};showToast=()=>{};');
    // Real API client transport/session guards; only fetch is synthetic.
    c.fetch = (_url, request) => new Promise(resolve => {
        const payload = JSON.parse(request.body);
        const kind = {'getIncidentData': 'incident', 'getDailyData': 'daily'}[payload.action];
        assert.ok(kind, `Unexpected fixture API action: ${payload.action}`);
        calls.push({kind, ...payload, resolve: reply => resolve({
            ok: true, json: async () => ({status: 'success', ...(kind === 'daily' ? {records: reply} : reply)})
        })});
    });
    vm.runInContext(clientScript, c);
    const key = name => {c.fixtureKey = name; return run('kpiStorageKey(fixtureKey)');};
    if (stale) local.data.set(key('kpiData_TRD'), '[]');
    const cache = () => JSON.parse(run("safeStorage.getItem('kpiData_TRD')") || '[]');
    const previewCount = () => Number.parseInt(node('err-case-count').textContent, 10);
    const weeklyCount = () => Number(node('dash-total-errors').innerText);
    const resolve = kind => {
        const call = calls.find(item => item.kind === kind && !item.settled);
        assert.ok(call, `Expected pending ${kind} request`);
        call.settled = true;
        call.resolve(kind === 'incident' ? incidentReply() : dailyReply());
    };
    return {c, run, user, node, errors, calls, local, tab, key, cache, previewCount, weeklyCount, resolve};
}

async function completeReads(f, order) {
    const incidentRead = f.run("ScopedRefresher.refreshIncident('TRD')");
    const dailyRead = f.run("ScopedRefresher.refreshDaily('TRD',3)");
    await tick();
    for (const kind of order) {
        f.resolve(kind);
        await (kind === 'incident' ? incidentRead : dailyRead);
    }
    // Assert the real public render paths after all authoritative reads.
    f.run("hydrateIncidentPreview('2026-10-02');loadDashboardData();");
}

test('control: actual Incident and Daily consumers show one persisted case', async () => {
    const f = fixture();
    await completeReads(f, ['incident', 'daily']);
    assert.equal(f.previewCount(), 1);
    assert.equal(f.weeklyCount(), 1);
    assert.equal(f.cache()[0].volume.pickup, 1);
    assert.equal(f.calls.find(call => call.kind === 'daily').includeActivity, false);
    assert.equal(f.errors.length, 0);
});

for (const stale of [false, true]) for (const order of [['incident', 'daily'], ['daily', 'incident']]) {
    test(`quota SET/working GET ${stale ? 'stale []' : 'null'} retains Incident across ${order.join(' then ')}`, async () => {
        const f = fixture({failWrites: true, stale});
        await completeReads(f, order);
        assert.equal(f.previewCount(), 1, 'Incident QC must show the fetched case');
        assert.equal(f.weeklyCount(), 1, 'Dashboard must read the same fetched case');
        assert.equal(f.cache()[0].incidentCases[0].caseId, incident.caseId);
        assert.equal(f.cache()[0].volume.pickup, 1, 'Daily sections must coexist with Incident');
        assert.equal(f.errors.length, 0);
    });
}

test('small timestamp can persist while failed payload remains readable', async () => {
    const f = fixture({failWrites: key => key.endsWith('kpiData_TRD')});
    const pending = f.run("ScopedRefresher.refreshIncident('TRD')");
    await tick(); f.resolve('incident'); await pending;
    assert.ok(f.local.data.has(f.key('kpiData_TRD_ts')), 'Timestamp write succeeded');
    assert.equal(f.run("isKpiCacheStale('TRD')"), false);
    assert.equal(f.previewCount(), 1, 'A fresh timestamp must not hide the memory payload');
    assert.equal(f.cache()[0].incidentCases.length, 1);
});

test('safeStorage: failed write overrides readable stale persistent value', () => {
    const f = fixture({failWrites: true});
    f.local.data.set(f.key('kpiData_TRD'), 'old persisted value');
    f.run("safeStorage.setItem('kpiData_TRD','latest value')");
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), 'latest value');
});

test('safeStorage: successful write recovery retires prior memory override', () => {
    const f = fixture({failWrites: true});
    f.run("safeStorage.setItem('kpiData_TRD','old fallback')");
    f.local.control.failWrites = false;
    f.run("safeStorage.setItem('kpiData_TRD','new persisted value')");
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), 'new persisted value');
    f.local.control.failReads = true;
    assert.notEqual(f.run("safeStorage.getItem('kpiData_TRD')"), 'old fallback', 'Old memory must not reappear after recovery');
});

test('safeStorage: removal succeeds even if only the failed write had a memory value', () => {
    const f = fixture({failWrites: true});
    f.run("safeStorage.setItem('kpiData_TRD','fallback');safeStorage.removeItem('kpiData_TRD');");
    f.local.control.failReads = true;
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), null);
});

test('failed persistent removal hides the stale value until a new write succeeds', () => {
    const f = fixture();
    f.local.data.set(f.key('kpiData_TRD'), 'stale persisted value');
    f.local.control.failRemoves = true;
    f.run("safeStorage.removeItem('kpiData_TRD')");
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), null);
    f.run("safeStorage.setItem('kpiData_TRD','new persisted value')");
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), 'new persisted value');
});

for (const [name, owner] of [
    ['identity', {...original, identityId: '10000000-0000-4000-8000-000000000002'}],
    ['session version', {...original, sessionVersion: 2}],
    ['authorization revision', {...original, authorizationRevision: 'new-revision'}]
]) {
    test(`memory fallback respects ${name} cache isolation and UUID-owned drafts`, () => {
        const f = fixture({failWrites: true});
        f.local.control.failReads = true;
        f.run("safeStorage.setItem('kpiData_TRD','original cache');safeStorage.setItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors','owned draft');");
        f.user(owner, 'new-fixture-token');
        assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), null);
        assert.equal(f.run("safeStorage.getItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors')"), name === 'identity' ? null : 'owned draft');
        f.user();
        assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), 'original cache');
    });
}

test('cache reset clears fallback read caches while preserving owned drafts and other apps', () => {
    const f = fixture({failWrites: true});
    f.local.control.failReads = true;
    f.local.data.set('akra_sso_token', 'synthetic Main state');
    f.local.data.set('other_app_cache', 'synthetic other app state');
    f.run("safeStorage.setItem('kpiData_TRD','fallback');safeStorage.setItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors','draft');clearKpiReadCaches();");
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), null);
    assert.equal(f.run("safeStorage.getItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors')"), 'draft');
    assert.equal(f.local.data.get('akra_sso_token'), 'synthetic Main state');
    assert.equal(f.local.data.get('other_app_cache'), 'synthetic other app state');
});

test('missing authorization revision cannot reuse a private cache but retains owned draft', () => {
    const f = fixture({failWrites: true});
    f.local.control.failReads = true;
    f.run("safeStorage.setItem('kpiData_TRD','private');safeStorage.setItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors','draft');");
    f.user({...original, authorizationRevision: null});
    assert.equal(f.run("safeStorage.getItem('kpiData_TRD')"), null);
    assert.equal(f.run("safeStorage.getItem('kpiDraft_fixture-admin_TRD_2026-10-02_errors')"), 'draft');
});

test('visible weekly Dashboard rerenders when delayed Incident follows Daily completion', async () => {
    const f = fixture();
    const pending = f.run('syncDataFromSheet(false)');
    await tick(); f.resolve('daily'); await tick();
    assert.equal(f.weeklyCount(), 0, 'Daily sections alone contain no Incident');
    f.resolve('incident'); await pending;
    assert.equal(f.previewCount(), 1);
    assert.equal(f.cache()[0].incidentCases.length, 1);
    assert.equal(f.weeklyCount(), 1, 'No explicit render or navigation after Incident completion');
    assert.equal(f.errors.length, 0);
});

test('a background branch response cannot rerender the selected branch Dashboard', async () => {
    const f = fixture();
    const pending = f.run("ScopedRefresher.refreshIncident('TRD')");
    await tick();
    f.run("currentBranch='AKRA';loadDashboardData();");
    f.node('dash-total-errors').innerText = 'selected-branch-marker';
    f.resolve('incident'); await pending;
    assert.equal(f.node('dash-total-errors').innerText, 'selected-branch-marker');
    assert.equal(f.cache()[0].incidentCases.length, 1, 'Background cache is still hydrated for later navigation');
});

test('a delayed old session response cannot write a replacement identity cache', async () => {
    const f = fixture({failWrites: true});
    const pending = f.run("ScopedRefresher.refreshIncident('TRD')");
    await tick();
    f.user({...original, identityId: '10000000-0000-4000-8000-000000000002'}, 'replacement-token');
    f.resolve('incident'); await pending;
    assert.equal(f.cache().length, 0);
    f.user();
    assert.equal(f.cache().length, 0);
});
