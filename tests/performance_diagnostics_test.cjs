// Actual page/helper/client execution with fictional DOM/storage/fetch fixtures only.
// No browser process, real request, credential, persistent log or business write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const adapter = fs.readFileSync(path.join(__dirname, '../js/supabase-kpi-client.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8')).version;
const section = (startText, endText) => {
    const start = html.indexOf(startText), end = html.indexOf(endText, start + startText.length);
    assert.ok(start >= 0 && end > start);
    return html.slice(start, end);
};
const functionSource = name => {
    const start = html.search(new RegExp('        (?:async )?function ' + name + '\\('));
    const end = html.indexOf('\n        }', start) + '\n        }'.length;
    assert.ok(start >= 0 && end > start);
    return html.slice(start, end);
};
const fixtureDate = '2026-10-02';
const feed = (extra = {}) => ({
    status: 'success', success: true, feedStatus: 'ok', date: fixtureDate,
    requisitions: [{ uid: 'private-record-sentinel', billNo: '#fixture', workloadEligible: true,
        requester: 'private-name-sentinel', requesterIdentityStatus: 'unlinked', itemsSummary: 'fictional', totalUnits: 1 }],
    operationalEvents: [{ eventType: 'GR_COMPLETED', actorEmployeeUid: 'private-actor-sentinel',
        actorName: 'fictional worker', details: 'private-details-sentinel', totalUnits: 2 }], ...extra
});
const tick = () => new Promise(setImmediate);

function rig(flag = '1', navigation = true) {
    const nodes = new Map(), frames = [], requests = [], storage = new Map();
    let clock = 700, wallClock = 10000, storeWrites = 0, mode = 'success', delayed;
    const node = () => ({ hidden: false, textContent: '', innerText: '', innerHTML: '', value: '',
        setAttribute() {}, classList: { values: new Set(), contains(value) { return this.values.has(value); },
            add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); } } });
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], node());
    const body = node(); body.classList.add('kpi-session-ready'); body.appendChild = n => nodes.set(n.id, n);
    nodes.get('record-date').value = fixtureDate;
    const owner = { token: 'private-token-sentinel' };
    class FixtureDate extends Date { static now() { return wallClock; } }
    const c = {
        URLSearchParams, TextEncoder, Date: FixtureDate,
        location: { search: flag === null ? '?sso=private-token-sentinel' : '?akra_perf=' + flag + '&sso=private-token-sentinel' },
        performance: navigation ? { now: () => ++clock } : undefined,
        requestAnimationFrame: fn => frames.push(fn),
        document: { getElementById: id => nodes.get(id) || null, createElement: node,
            querySelectorAll: () => [], body },
        console: { warn() {}, error() {}, log() {} },
        localStorage: { getItem() { throw Error('diagnostics must not access localStorage'); }, setItem() { throw Error('no diagnostic storage'); } },
        safeStorage: { getItem: key => storage.get(key), setItem: (key, value) => { ++storeWrites; storage.set(key, value); } },
        sessionToken: owner.token, kpiVerifiedSession: owner, currentBranch: 'AKRA', kpiConfigRequest: 0,
        KPI_WORKLOAD_STATUS: {}, KPI_MAIN_VIEWER: null, KPI_SYSTEM_CONFIG: {}, TRD_DEPARTMENTS: {},
        getKpiSessionOwner: () => c.kpiVerifiedSession,
        getKpiSessionToken: () => c.sessionToken,
        getKpiPageToken: () => c.sessionToken,
        isCurrentKpiSession: (session, token) => session === c.kpiVerifiedSession && token === c.sessionToken,
        getTodayBangkokDateStr: () => fixtureDate,
        processConfigList() {}, applySystemConfig() {}, populateAdminEmpFilter() {}, handleKpiAuthFailure() {},
        esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
        setTimeout() {}, clearTimeout() {},
        fetch: async (_url, options) => {
            const request = JSON.parse(options.body);
            requests.push(request);
            clock += 11;
            if (mode === 'delayed') await new Promise(resolve => { delayed = resolve; });
            if (mode === 'error') throw Error('fixture network error');
            return { ok: true, json: async () => {
                clock += 7;
                return request.action === 'getConfig' ? { status: 'success', employees: [{ uid: 'private-config-uid', name: 'private-config-name' }] }
                    : mode === 'malformed' ? feed({ feedStatus: 'error' }) : feed();
            } };
        }
    };
    c.window = c; c.self = c;
    vm.createContext(c);
    const run = code => vm.runInContext(code, c);
    run('const CURRENT_VERSION = ' + JSON.stringify(version) + ';' + section('        const KpiPerf = (() => {', '        // Auto open Quick Workload Modal'));
    run(adapter);
    run(section('        let liveRequisitionsList', '        function applyAkraWorkloadDraft'));
    run(functionSource('renderUnifiedWorkloadActivity'));
    run(functionSource('loadConfig'));
    run(functionSource('initSystem'));
    const snapshot = () => {
        const n = nodes.get('akra-perf-diagnostics');
        return n ? JSON.parse(n.textContent) : null;
    };
    return { c, run, nodes, requests, storage, snapshot, setMode: value => { mode = value; },
        settle: () => delayed(), storeWrites: () => storeWrites,
        frame: () => { clock += 16; wallClock += 16; frames.shift()?.(); },
        frames: () => frames.length, advanceWall: ms => { wallClock += ms; }, advance: ms => { clock += ms; } };
}

(async () => {
    const disabled = [];
    for (const flag of [null, '0', 'true']) {
        const f = rig(flag);
        assert.equal(f.snapshot(), null);
        await f.c.loadConfig();
        await f.c.fetchLiveRequisitions(fixtureDate);
        assert.equal(f.snapshot(), null, 'disabled flag never creates diagnostic DOM');
        assert.equal(f.frames(), 0, 'disabled flag never adds paint callbacks');
        assert.deepEqual(f.requests.map(r => r.action), ['getConfig', 'getLiveRequisitions']);
        assert.equal(f.storeWrites(), 1, 'only the original config cache write remains');
        assert.equal(f.nodes.get('wl-dashboard-total').textContent, '2');
        disabled.push(f.nodes.get('wl-dashboard-activity-list').innerHTML);
    }
    const f = rig();
    assert.equal(f.nodes.get('akra-perf-diagnostics').hidden, true);
    await f.c.loadConfig();
    await f.c.fetchLiveRequisitions(fixtureDate);
    assert.equal(f.snapshot().state, 'loading', 'HTTP/DOM completion alone is not paint-ready');
    f.frame(); assert.equal(f.snapshot().state, 'loading');
    f.frame();
    let result = f.snapshot();
    assert.equal(result.state, 'ready');
    assert.equal(result.paint, 'double-raf');
    assert.equal(result.clock, 'navigation');
    assert.equal(result.endpoint, 'current-day-activity-fresh-settled');
    assert.equal(result.version, version);
    assert.equal(result.configCache, 'miss');
    assert.equal(result.configFresh, 'settled');
    assert.equal(result.activityCache, 'fresh');
    assert.equal(result.counts.activityRequests, 1);
    assert.equal(result.counts.configRequests, 1);
    assert.equal(result.counts.eligibleRows, 2);
    assert.equal(result.counts.requisitionRows, 1);
    assert.equal(result.counts.eventRows, 1);
    assert.equal(result.bytes.activityJsonUtf8, Buffer.byteLength(JSON.stringify(feed()), 'utf8'));
    assert.equal(result.durationsMs.activityApi, 12, 'API span stops at response headers');
    assert.equal(result.durationsMs.activityResponse, 8, 'response span measures body/decode/JSON separately');
    assert.ok(result.durationsMs.navigationToReady > result.durationsMs.scriptStartOffset);
    for (const stage of ['configHydration', 'configBoot', 'configApi', 'configResponse', 'activityGrouping', 'activityRender']) assert.ok(Number.isFinite(result.durationsMs[stage]));
    for (const plain of disabled) assert.equal(f.nodes.get('wl-dashboard-activity-list').innerHTML, plain, 'instrumentation preserves exact rendered rows');
    assert.deepEqual(f.requests.map(r => r.action), ['getConfig', 'getLiveRequisitions'], 'enabled diagnostics add no requests');
    assert.equal(f.storeWrites(), 1);
    assert.doesNotMatch(JSON.stringify(result), /private-|fictional|#fixture|https:|token|employee|details/i, 'DOM exports aggregates only');
    const calls = f.requests.length;
    const firstReady = f.snapshot();
    f.c.ensureWorkloadActivityLoaded();
    assert.equal(f.requests.length, calls, 'same-date memory rendering retains the existing no-request cache path');
    assert.deepEqual(f.snapshot(), firstReady, 'memory render after ready preserves the startup snapshot');
    await f.c.fetchLiveRequisitions(fixtureDate);
    assert.equal(f.requests.length, calls + 1, 'real refresh still uses the original request path');
    assert.deepEqual(f.snapshot(), firstReady, 'same-date fresh refresh cannot rewrite navigation duration/stages/counts/bytes');
    f.nodes.get('wl-filter-search').value = 'fictional'; f.c.renderUnifiedWorkloadActivity();
    assert.deepEqual(f.snapshot(), firstReady, 'later filter rendering cannot rewrite startup metrics');
    f.nodes.get('wl-filter-search').value = ''; f.setMode('error');
    await f.c.fetchLiveRequisitions(fixtureDate);
    assert.deepEqual(f.snapshot(), firstReady, 'later refresh error cannot rewrite startup metrics');

    const cached = rig();
    cached.storage.set('kpi_cached_config', JSON.stringify({ employees: [{ uid: 'cached-private-uid' }] }));
    await cached.c.loadConfig(); await tick();
    assert.equal(cached.snapshot().configCache, 'hit');
    assert.equal(cached.snapshot().configFresh, 'settled');
    assert.equal(cached.requests.length, 1, 'cache-first retains exactly one background revalidation');
    const background = rig();
    background.storage.set('kpi_cached_config', JSON.stringify({ employees: [{ uid: 'cached-private-uid' }] }));
    background.setMode('delayed'); await background.c.loadConfig(); await tick();
    background.setMode('success'); await background.c.fetchLiveRequisitions(fixtureDate); background.frame(); background.frame();
    const feedReadyAt = background.snapshot().durationsMs.navigationToReady;
    assert.equal(background.snapshot().configFresh, 'pending');
    background.settle(); await tick();
    assert.equal(background.snapshot().configFresh, 'settled');
    assert.equal(background.snapshot().counts.configRows, 1);
    assert.equal(background.snapshot().durationsMs.navigationToReady, feedReadyAt, 'background config completion does not change the first feed-ready timestamp');
    const bootstrap = rig();
    bootstrap.c.checkAppVersion = async () => { bootstrap.advance(5); return true; };
    bootstrap.c.AppVersionGuard = { start() {} };
    bootstrap.c.handleLineBrowserRedirect = () => false;
    bootstrap.c.resolveSsoAuth = async () => { bootstrap.advance(20); return { userData: { name: 'fictional' } }; };
    bootstrap.c.checkAuth = async () => { bootstrap.advance(2); bootstrap.c.ensureWorkloadActivityLoaded(); };
    await bootstrap.c.initSystem(); await tick(); bootstrap.frame(); bootstrap.frame();
    assert.equal(bootstrap.snapshot().state, 'ready');
    for (const stage of ['versionCheck', 'auth', 'authUi']) assert.ok(bootstrap.snapshot().durationsMs[stage] > 0, 'actual bootstrap records ' + stage);
    assert.deepEqual(bootstrap.requests.map(r => r.action), ['getConfig', 'getLiveRequisitions']);
    const configFailure = rig();
    configFailure.storage.set('kpi_cached_config', JSON.stringify({ employees: [{ uid: 'cached-private-uid' }] }));
    configFailure.setMode('error'); await configFailure.c.loadConfig(); await tick();
    assert.equal(configFailure.snapshot().configCache, 'hit');
    assert.equal(configFailure.snapshot().configFresh, 'error', 'background failure stays visible separately from cached boot');

    for (const mode of ['error', 'malformed']) {
        const failure = rig(); failure.setMode(mode);
        await failure.c.fetchLiveRequisitions(fixtureDate);
        assert.equal(failure.snapshot().state, 'error');
        assert.equal(failure.snapshot().durationsMs.navigationToReady, undefined);
        assert.equal(failure.frames(), 0);
    }
    const denied = rig(); denied.c.sessionToken = '';
    await denied.c.fetchLiveRequisitions(fixtureDate);
    assert.equal(denied.requests.length, 0, 'missing auth still issues zero domain requests');
    assert.equal(denied.snapshot().state, 'error');

    for (const change of ['session', 'branch', 'date', 'filter', 'hidden', 'auth-ui', 'app-hidden', 'invalidate']) {
        const stale = rig(); await stale.c.fetchLiveRequisitions(fixtureDate);
        stale.frame();
        if (change === 'session') stale.c.sessionToken = 'replacement';
        if (change === 'branch') stale.c.currentBranch = 'TRD';
        if (change === 'date') stale.nodes.get('record-date').value = '2026-10-01';
        if (change === 'filter') stale.nodes.get('wl-filter-search').value = 'changed';
        if (change === 'hidden') stale.nodes.get('view-workload').classList.add('hidden');
        if (change === 'auth-ui') stale.c.document.body.classList.remove('kpi-session-ready');
        if (change === 'app-hidden') stale.nodes.get('app-content').classList.add('hidden');
        if (change === 'invalidate') stale.c.AkraPerfDiagnostics.invalidate();
        stale.frame();
        assert.notEqual(stale.snapshot().state, 'ready', change + ' before paint cannot claim primary ready');
        assert.equal(stale.snapshot().durationsMs.navigationToReady, undefined);
        if (change === 'invalidate') {
            assert.deepEqual(stale.snapshot().counts, {});
            assert.deepEqual(stale.snapshot().bytes, {});
        }
    }
    const late = rig(); late.setMode('delayed');
    const pending = late.c.fetchLiveRequisitions(fixtureDate); await tick();
    late.c.sessionToken = 'replacement'; late.settle(); await pending;
    assert.notEqual(late.snapshot().state, 'ready', 'late authenticated response is discarded by the actual client');
    assert.equal(late.nodes.get('wl-dashboard-total').textContent, '0');

    const previous = rig(); await previous.c.fetchLiveRequisitions('2026-10-01');
    assert.notEqual(previous.snapshot().state, 'ready', 'mismatched response date fails closed');
    const empty = rig();
    empty.c.fetch = async () => ({ ok: true, json: async () => feed({ requisitions: [], operationalEvents: [] }) });
    await empty.c.fetchLiveRequisitions(fixtureDate); empty.frame(); empty.frame();
    assert.equal(empty.snapshot().state, 'ready', 'valid fresh empty feed can settle');
    assert.equal(empty.snapshot().counts.eligibleRows, 0);

    const fallback = rig('1', false);
    await fallback.c.fetchLiveRequisitions(fixtureDate); fallback.advanceWall(100); fallback.frame(); fallback.frame();
    assert.equal(fallback.snapshot().clock, 'script');
    assert.equal(fallback.snapshot().durationsMs.navigationToReady, undefined);
    assert.ok(fallback.snapshot().durationsMs.scriptToReady >= 100);
    f.c.AkraPerfDiagnostics.count('unapproved-secret-key', 123);
    f.c.AkraPerfDiagnostics.end({ name: 'unapproved-secret-key', at: 0, generation: 0 });
    assert.doesNotMatch(JSON.stringify(f.snapshot()), /unapproved-secret-key/);
    const { rig: identityRig } = require('./helpers/identity-runtime.cjs');
    const identity = identityRig(); identity.user(); identity.window.AkraPerfDiagnostics = f.c.AkraPerfDiagnostics;
    identity.c.bindKpiSessionEvents();
    identity.local.set('akra_kpi_session', 'new-login');
    identity.events.storage({ key: 'akra_kpi_session', oldValue: 'old-login', newValue: 'new-login' });
    assert.equal(f.snapshot().state, 'invalidated', 'actual session invalidation clears diagnostics');
    assert.deepEqual(f.snapshot().durationsMs, {});
    console.log('PASS diagnostic opt-in/no extra requests or storage, real client/config/feed/render parity, numeric aggregates, double-paint readiness, cache separation, error/auth/date/session/branch/filter/stale isolation and clock fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
