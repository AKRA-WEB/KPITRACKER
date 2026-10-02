// Execute actual page/auth/client/config/feed functions with fictional deferred transport only.
// No real network, browser, credentials, persistent logging or operational writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { html, original, replacement, section, tick, rig: identityRig } = require('./helpers/identity-runtime.cjs');
const adapter = fs.readFileSync(path.join(__dirname, '../js/supabase-kpi-client.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8')).version;
const source = name => {
    const start = html.search(new RegExp('        (?:async )?function ' + name + '\\('));
    const end = html.indexOf('\n        }', start) + '\n        }'.length;
    assert.ok(start >= 0 && end > start, name);
    return html.slice(start, end);
};
const user = { ...original, perms: { 'app-kpi': ['viewKpiData', 'adminDashboard'] } };
const initialDate = '2026-10-02';
const config = {
    status: 'success', viewer: { uid: user.id, name: 'Fixture viewer', roles: ['ADMIN'], status: 'Active' },
    employees: [{ uid: 'fixture-worker', name: 'Fixture worker', roles: ['WAREHOUSE'], status: 'Active' }],
    workload: { date: initialDate, hour: 12, recordedEmployees: [], recordedEmployeeUids: [] },
    systemConfig: { workloadDuties: { fixture: true }, incidentCatalog: { fixture: true } }
};
const feed = (date = initialDate) => ({
    status: 'success', success: true, feedStatus: 'ok', date,
    requisitions: [{ uid: 'fixture-request', billNo: '#fixture', workloadEligible: true,
        requesterIdentityStatus: 'unlinked', itemsSummary: 'Fictional request', totalUnits: 2 }],
    operationalEvents: [{ eventType: 'GR_COMPLETED', actorEmployeeUid: 'fixture-worker',
        actorName: 'Fixture worker', details: 'Fictional event', totalUnits: 3 }]
});
const plain = value => JSON.parse(JSON.stringify(value));

function rig({ verifiedUser = user, verify = async () => verifiedUser, serial = false } = {}) {
    const f = identityRig({ verify });
    const requests = [], frames = [], applied = [], diagNodes = new Map();
    let clock = 0, date = initialDate;
    const getNode = f.c.document.getElementById;
    f.c.document.getElementById = id => diagNodes.get(id) || getNode(id);
    f.c.document.createElement = () => ({ setAttribute() {}, textContent: '', hidden: false });
    f.c.document.body.appendChild = node => diagNodes.set(node.id, node);
    f.window.location.search += '&akra_perf=1';
    f.window.history.replaceState = (_state, _title, target) => {
        const next = new URL(target, f.window.location.href);
        f.window.location.search = next.search;
        f.window.location.hash = next.hash;
    };
    f.window.performance = f.c.performance = { now: () => clock };
    f.c.TextEncoder = TextEncoder;
    f.window.requestAnimationFrame = f.c.requestAnimationFrame = callback => frames.push(callback);
    f.c.getTodayBangkokDateStr = () => date;
    f.c.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        let resolve, reject;
        const response = new Promise((yes, no) => { resolve = yes; reject = no; });
        requests.push({ action: payload.action, date: payload.date, started: clock,
            resolve: (body, status = 200) => resolve({ ok: status === 200, status, json: async () => plain(body) }), reject });
        return response;
    };
    f.c.self = f.window;
    vm.runInContext(adapter, f.c);
    f.c.AkraSupabaseKPI = f.window.AkraSupabaseKPI;
    f.run('let liveOperationalEventsList=[],liveRequisitionsLoadedDate="";');
    f.run('const CURRENT_VERSION=' + JSON.stringify(version) + ';' + section('        const KpiPerf = (() => {', '        // Auto open Quick Workload Modal'));
    for (const name of ['hasKpiAdminRole', 'canAccessAdminSettings', 'checkAuth', 'applyRolePermissions',
        'loadConfig', 'initSystem', 'classifyRequisition', 'renderUnifiedWorkloadActivity',
        'renderLiveRequisitions', 'fetchLiveRequisitions', 'ensureWorkloadActivityLoaded']) f.run(source(name));
    f.c.esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    f.c.checkAppVersion = async () => true;
    f.c.AppVersionGuard = { start() {} };
    f.c.handleLineBrowserRedirect = () => false;
    for (const name of ['startAdminStatusRefresh', 'syncAllBranchesForAdmin', 'renderAdminPanel', 'refreshActions', 'showBranchSelector']) f.c[name] = () => {};
    f.c.selectBranch = branch => { f.run('currentBranch=' + JSON.stringify(branch)); f.c.initApp(branch); };
    f.c.initApp = branch => {
        f.node('app-content').classList.remove('hidden');
        if (branch === 'AKRA') {
            f.node('view-workload').classList.remove('hidden');
            f.c.ensureWorkloadActivityLoaded();
        } else f.node('view-workload').classList.add('hidden');
    };
    f.c.processConfigList = employees => {
        applied.push(plain(employees));
        f.c.GLOBAL_CONFIG_LIST = employees;
        f.c.USER_DB = Object.fromEntries(employees.map(employee => [employee.uid, f.c.getBranchesFromMainRoles(employee.roles)]));
    };
    f.user(verifiedUser);
    f.c.fixtureSessionStorage.setItem('active_branch', 'AKRA');
    f.node('app-content').classList.add('hidden');
    f.node('view-workload').classList.add('hidden');
    if (serial) f.c.startStartupActivityPrefetch = () => undefined;
    const snapshot = () => JSON.parse(f.c.document.getElementById('akra-perf-diagnostics').textContent);
    const paint = () => { while (frames.length) { clock += 16; frames.shift()(); } };
    return { ...f, requests, applied, snapshot, paint, frames, setClock: value => { clock = value; },
        setDate: value => { date = value; }, call: action => requests.find(request => request.action === action) };
}

async function finishConfig(f, body = config, status = 200) {
    f.call('getConfig').resolve(body, status);
    await tick();
}

test('startup overlaps authorized fresh activity with deferred config and preserves paint endpoint/feed/roster', async () => {
    const outputs = [];
    for (const serial of [true, false]) {
        const f = rig({ serial });
        const boot = f.c.initSystem(); await tick();
        assert.equal(f.call('getConfig').started, 0);
        assert.equal(Boolean(f.call('getLiveRequisitions')), !serial);
        assert.equal(f.node('wl-dashboard-activity-list').innerHTML, '', 'no early render');
        assert.equal(f.run('liveRequisitionsLoadedDate'), '', 'no early loaded marker');
        assert.equal(f.node('app-content').classList.contains('hidden'), true);
        f.setClock(1000); await finishConfig(f); await boot;
        assert.equal(f.requests.filter(request => request.action === 'getLiveRequisitions').length, 1);
        assert.equal(f.call('getLiveRequisitions').started, serial ? 1000 : 0);
        f.setClock(serial ? 2200 : 1200); f.call('getLiveRequisitions').resolve(feed()); await tick(); f.paint();
        const result = f.snapshot();
        assert.equal(result.state, 'ready'); assert.equal(result.activityCache, 'fresh');
        assert.equal(result.configCache, 'miss'); assert.equal(result.configFresh, 'settled');
        assert.equal(result.counts.activityRequests, 1); assert.equal(result.counts.configRequests, 1);
        assert.equal(result.counts.eligibleRows, 2);
        assert.equal(result.durationsMs.navigationToReady, serial ? 2232 : 1232);
        outputs.push({ roster: f.applied, viewer: plain(f.run('KPI_MAIN_VIEWER')),
            requisitions: plain(f.run('liveRequisitionsList')), events: plain(f.run('liveOperationalEventsList')),
            rendered: f.node('wl-dashboard-activity-list').innerHTML });
    }
    assert.deepEqual(outputs[1], outputs[0], 'exact same config/feed/render output as serial transport');
});

test('early feed response remains buffered until config/normal role setup, then consumes once', async () => {
    const f = rig(); const boot = f.c.initSystem(); await tick();
    f.call('getLiveRequisitions').resolve(feed()); await tick();
    assert.equal(f.run('liveRequisitionsList.length'), 0); assert.equal(f.run('liveRequisitionsLoadedDate'), '');
    assert.equal(f.frames.length, 0); assert.notEqual(f.snapshot().state, 'ready');
    await finishConfig(f); await boot; await tick(); f.paint();
    assert.equal(f.snapshot().state, 'ready'); assert.equal(f.snapshot().counts.activityRequests, 1);
});

test('duplicate initial ensure/fetch calls share the same prefetched flight; later refresh does not rewrite startup', async () => {
    const f = rig(); const boot = f.c.initSystem(); await tick(); await finishConfig(f); await boot;
    f.c.ensureWorkloadActivityLoaded(); const second = f.c.fetchLiveRequisitions(initialDate, true);
    assert.equal(f.requests.filter(request => request.action === 'getLiveRequisitions').length, 1);
    assert.equal(f.run('liveRequisitionRequest'), 1, 'duplicate consumers do not supersede the rendering ticket');
    f.call('getLiveRequisitions').resolve(feed()); await second; await tick(); f.paint();
    const firstReady = f.snapshot();
    const refresh = f.c.fetchLiveRequisitions(initialDate, true); await tick();
    f.requests.at(-1).resolve(feed()); await refresh; f.paint();
    assert.equal(f.requests.filter(request => request.action === 'getLiveRequisitions').length, 2);
    assert.deepEqual(f.snapshot(), firstReady, 'existing frozen diagnostic contract survives overlap');
});

test('no domain request starts before Main verification, and denied/unknown/TRD/nondefault entry keeps serial fallback', async () => {
    let verified; const gated = rig({ verify: () => new Promise(resolve => { verified = resolve; }) });
    const boot = gated.c.initSystem(); await tick(); assert.equal(gated.requests.length, 0);
    verified(user); await tick(); assert.equal(gated.requests.length, 2);
    await finishConfig(gated); await boot; gated.call('getLiveRequisitions').resolve(feed()); await tick();
    for (const kind of ['no-permission', 'role', 'unknown', 'TRD', 'nondefault', 'quick']) {
        const f = rig();
        if (kind === 'no-permission') f.user({ ...user, perms: { 'app-kpi': [] } });
        if (kind === 'role') f.user({ ...user, roles: ['CUSTOM'] });
        if (kind === 'unknown') f.run('currentBranch="";');
        else if (kind === 'TRD') f.run('currentBranch="TRD";');
        else f.run('currentBranch="AKRA";');
        if (kind === 'nondefault') f.run('pendingKpiTab="dashboard";');
        if (kind === 'quick') f.window.location.search += '&action=quick_workload';
        f.c.startStartupActivityPrefetch({ userData: plain(f.run('kpiVerifiedSession.user')) });
        await tick(); assert.equal(f.requests.length, 0, kind + ' does not prefetch');
        assert.equal(f.run('startupActivityPrefetch'), null);
    }
    const denied = rig({ verify: async () => { throw Error('permission_denied'); } });
    await denied.c.initSystem(); assert.equal(denied.requests.length, 0);
});

test('config failure and changed current viewer role discard prefetched records', async () => {
    for (const mode of ['failure', 'role']) {
        const f = rig(); const boot = f.c.initSystem(); await tick();
        f.call('getLiveRequisitions').resolve(feed()); await tick();
        await finishConfig(f, mode === 'failure' ? { status: 'error', reason: 'permission_denied' }
            : { ...config, viewer: { ...config.viewer, roles: ['TRD'] } }, mode === 'failure' ? 403 : 200);
        await boot; await tick(); f.paint();
        assert.equal(f.run('startupActivityPrefetch'), null);
        assert.equal(f.run('liveRequisitionsList.length'), 0);
        assert.notEqual(f.snapshot().state, 'ready');
    }
});

for (const change of ['owner', 'token', 'permission', 'viewer-role', 'viewer-status', 'branch', 'date', 'selected-date', 'invalidate']) {
    test('buffered activity cannot apply after ' + change + ' changes during consumption', async () => {
        const f = rig(); const boot = f.c.initSystem(); await tick(); await finishConfig(f); await boot;
        if (change === 'owner') f.user(replacement, 'replacement-token');
        if (change === 'token') f.run('sessionToken="replacement-token";');
        if (change === 'permission') f.run('kpiVerifiedSession.user.perms={"app-kpi":[]};');
        if (change === 'viewer-role') f.run('KPI_MAIN_VIEWER.roles=["TRD"];');
        if (change === 'viewer-status') f.run('KPI_MAIN_VIEWER.status="Inactive";');
        if (change === 'branch') f.run('currentBranch="TRD";');
        if (change === 'date') f.setDate('2026-10-03');
        if (change === 'selected-date') f.node('record-date').value = '2026-10-01';
        if (change === 'invalidate') f.c.invalidateKpiSession('fixture invalidated');
        f.call('getLiveRequisitions').resolve(feed()); await tick(); f.paint();
        assert.equal(f.run('liveRequisitionsList.length'), 0);
        assert.equal(f.run('liveRequisitionsLoadedDate'), '');
        assert.equal(f.run('startupActivityPrefetch'), null);
        assert.notEqual(f.snapshot().state, 'ready');
    });
}

test('rejected prefetched read is handled immediately, renders normal failure after config and allows fresh retry', async () => {
    const f = rig(); const boot = f.c.initSystem(); await tick();
    f.call('getLiveRequisitions').reject(Error('fixture read failure')); await tick();
    assert.equal(f.node('wl-dashboard-activity-list').innerHTML, '', 'failure does not render before config');
    await finishConfig(f); await boot; await tick();
    assert.equal(f.snapshot().state, 'error'); assert.equal(f.run('startupActivityPrefetch'), null);
    assert.match(f.node('live-bill-read-state').innerText, /โหลดรายการไม่สำเร็จ/);
    const retry = f.c.fetchLiveRequisitions(initialDate); await tick(); f.requests.at(-1).resolve(feed());
    await retry; f.paint(); assert.equal(f.snapshot().state, 'ready');
    assert.equal(f.requests.filter(request => request.action === 'getLiveRequisitions').length, 2);
});

test('old boot failure cannot discard a replacement startup buffer', async () => {
    const f = rig(); const oldBoot = f.c.initSystem(); await tick();
    f.user({ ...replacement, perms: user.perms }, 'replacement-token'); f.run('currentBranch="AKRA";');
    const next = f.c.startStartupActivityPrefetch({ userData: plain(f.run('kpiVerifiedSession.user')) }); await tick();
    f.call('getConfig').reject(Error('old config failed')); await oldBoot;
    assert.equal(f.run('startupActivityPrefetch'), next);
    f.requests.filter(request => request.action === 'getLiveRequisitions').forEach(request => request.resolve(feed())); await tick();
});

test('quick-workload entry stays serial even when real SSO sanitization removes its query before the entry guard', async () => {
    const f = rig(); f.window.location.search += '&action=quick_workload';
    const boot = f.c.initSystem(); await tick();
    assert.equal(f.window.location.search, '', 'actual resolveSsoAuth sanitizes the original query');
    assert.deepEqual(f.requests.map(request => request.action), ['getConfig']);
    await finishConfig(f); await boot;
    assert.deepEqual(f.requests.map(request => request.action), ['getConfig', 'getLiveRequisitions']);
    f.call('getLiveRequisitions').resolve(feed()); await tick();
});
