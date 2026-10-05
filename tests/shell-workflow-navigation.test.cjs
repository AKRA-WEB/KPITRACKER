const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the current Main adapter, KPI bridge, and KPI inline route handlers together.
// DOM/style stubs are runtime evidence; desktop/mobile behavior needs a browser.
const mainRoot = process.env.AKRA_MAIN_ROOT || path.join(__dirname, '../../Main');
const mainSource = fs.readFileSync(path.join(mainRoot, 'js/unified-shell.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(__dirname, '../js/akra-shell-bridge.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function between(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `missing source boundary: ${start}`);
    return source.slice(first, last);
}
const clickWorkflowSource = between(mainSource, '    function clickWorkflow(item) {', '    function activateWorkflow(');
const switchTabSource = between(html, '        function switchTab(tab) {', '        function adjVol(');
const initAppSource = between(html, '        function initApp(branch, permissions) {', '        // ================= API / SYNC =================');

function setup({initialized = true, embedded = true, parentPath = '/Main/', branch = 'AKRA'} = {}) {
    const elements = new Map();
    const listeners = {};
    const queuedMessages = [];
    const loads = [];
    let allowed = true;
    let drafts = false;
    let leaveAllowed = true;
    let child;
    function element(id) {
        if (elements.has(id)) return elements.get(id);
        const classes = new Set(id.startsWith('view-') && id !== 'view-workload' ? ['hidden'] : []);
        const node = {
            id, disabled: false, style: {}, textContent: '', value: '',
            setAttribute() {}, removeAttribute() {},
            classList: {
                add(...items) { items.forEach(item => classes.add(item)); },
                remove(...items) { items.forEach(item => classes.delete(item)); },
                contains(item) { return classes.has(item); },
                toggle(item, force) {
                    const add = force === undefined ? !classes.has(item) : force;
                    if (add) classes.add(item); else classes.delete(item);
                    return add;
                }
            }
        };
        elements.set(id, node);
        return node;
    }
    for (const id of ['view-workload', 'view-kanban', 'view-duties', 'desktop-primary-nav']) element(id);
    element('desktop-primary-nav').style.display = 'none';
    const document = {
        readyState: 'loading',
        head: {appendChild() {}},
        createElement: () => ({}),
        addEventListener(name, listener) { listeners[name] = listener; },
        getElementById: element,
        querySelector(selector) { return elements.get(selector.slice(1)) || null; },
        querySelectorAll: () => []
    };
    const window = {
        location: {origin: 'https://fixture.invalid', hostname: 'fixture.invalid', pathname: '/KPITRACKER/', search: ''},
        addEventListener(name, listener) { listeners[name] = listener; },
        postMessage(data, origin) { queuedMessages.push({data, origin, source: window}); },
        scrollTo() {},
        KpiKanbanBoard: {initEventListeners() {}, loadKanbanBoard() { loads.push('kanban'); }},
        KpiDutyMatrix: {
            initEventListeners() {}, loadDutyMatrix() { loads.push('duties'); },
            hasDrafts: () => drafts, confirmLeave: () => leaveAllowed
        }
    };
    window.parent = embedded ? {
        location: {origin: window.location.origin, pathname: parentPath},
        AkraShell: {tokenFor: source => allowed && source === window ? 'synthetic-session' : ''},
        postMessage() {}
    } : window;
    const noop = () => {};
    const context = {
        window, document, URLSearchParams, setTimeout, clearTimeout,
        fetch() { throw Error('network is forbidden in the isolated route fixture'); },
        kpiVerifiedSession: initialized ? {id: 'fixture-user'} : null,
        sessionToken: initialized ? 'synthetic-session' : '',
        currentUser: initialized ? 'fixture-user' : null,
        currentBranch: branch,
        BRANCH_CONFIG: {AKRA: {showZone2: false}, TRD: {showZone2: false}},
        IS_ADMIN: false, _lastRecordDate: '',
        showToast: noop, toggleVendorBillsPending: noop, renderAkraRoster: noop,
        addErrorEntryRow: noop, loadTasksForSelectedDate: noop,
        applyEndOfShiftPermissionsUI: noop, restoreRecordDraft: noop,
        hydrateIncidentPreview: noop, updateDailyDashboard: noop, loadSkillsData: noop,
        isKpiCacheStale: () => false, ScopedRefresher: {trigger: noop},
        renderErrSeverity: noop, renderErrEmpChips: noop, renderErrTimeline: noop,
        renderErrTeamHp: noop, renderWorkload: noop,
        renderUnifiedWorkloadActivity: noop, ensureWorkloadActivityLoaded: noop
    };
    child = vm.createContext(context);
    vm.runInContext(`let pendingKpiTab = null;\n${switchTabSource}\n${initAppSource}`, child);
    for (const id of ['dtab-kanban', 'dtab-duties']) {
        const tag = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
        const handler = tag?.match(/\bonclick="([^"]+)"/)?.[1];
        assert.ok(handler, `missing real inline handler: ${id}`);
        const node = element(id);
        node.click = () => { if (!node.disabled) vm.runInContext(handler, child); };
    }
    vm.runInContext(bridgeSource, child);
    const parent = vm.createContext({active: {frame: {contentWindow: window, contentDocument: {
        querySelector(selector) {
            const target = document.querySelector(selector);
            if (!target) return null;
            return {disabled: target.disabled, click() { throw Error('Main must delegate to the child realm'); }};
        }
    }}}});
    vm.runInContext(`${clickWorkflowSource}\nthis.clickWorkflow = clickWorkflow;`, parent);
    return {
        window, child, elements, loads, queuedMessages,
        activate: selector => parent.clickWorkflow({selector}),
        visible: id => !element(id).classList.contains('hidden'),
        pending: () => vm.runInContext('pendingKpiTab', child),
        revoke() { allowed = false; },
        draftGuard() { drafts = true; leaveAllowed = false; },
        initialize() {
            child.kpiVerifiedSession = {id: 'fixture-user'};
            child.sessionToken = 'synthetic-session';
            child.currentUser = 'fixture-user';
            child.initApp(branch, [branch]);
        },
        message(data, {origin = window.location.origin, source = window.parent} = {}) {
            listeners.message({data, origin, source});
        },
        flush() { queuedMessages.splice(0).forEach(event => listeners.message(event)); }
    };
}

test('Main activates hidden KPI Kanban and duties controls before acknowledging success', () => {
    const f = setup();
    assert.equal(f.elements.get('desktop-primary-nav').style.display, 'none');
    assert.equal(f.activate('#dtab-kanban'), true);
    assert.equal(f.visible('view-kanban'), true, 'success must not precede actual child route dispatch');
    assert.equal(f.visible('view-workload'), false);
    assert.equal(f.activate('#dtab-duties'), true);
    assert.equal(f.visible('view-duties'), true);
    assert.equal(f.visible('view-kanban'), false);
    assert.deepEqual(f.loads, ['kanban', 'duties']);
    assert.equal(f.queuedMessages.length, 0);
});

for (const branch of ['AKRA', 'TRD']) {
    test(`Main request survives KPI verification and branch initialization (${branch})`, () => {
        const f = setup({initialized: false, branch});
        assert.equal(f.activate('#dtab-duties'), true);
        assert.equal(f.pending(), 'duties', 'the real handler must retain the requested route immediately');
        assert.equal(f.visible('view-duties'), false);
        assert.deepEqual(f.loads, []);
        f.initialize();
        assert.equal(f.pending(), null);
        assert.equal(f.visible('view-duties'), true);
        assert.deepEqual(f.loads, ['duties']);
    });
}

test('unknown, absent and disabled targets or an invalid Main session cannot acknowledge activation', () => {
    const f = setup();
    assert.equal(f.activate('#delete-record'), false);
    f.elements.delete('dtab-kanban');
    assert.equal(f.activate('#dtab-kanban'), false);
    f.elements.get('dtab-duties').disabled = true;
    assert.equal(f.activate('#dtab-duties'), false);
    f.elements.get('dtab-duties').disabled = false;
    f.revoke();
    assert.equal(f.activate('#dtab-duties'), false);
    assert.deepEqual(f.loads, []);
    for (const options of [{embedded: false}, {parentPath: '/untrusted/'}]) {
        const other = setup(options);
        assert.equal(other.activate('#dtab-duties'), false);
        assert.deepEqual(other.loads, []);
    }
});

test('authenticated incoming workflow messages retain origin, source, version and selector denial', () => {
    const f = setup();
    const data = {channel: 'akra-workflow', version: 1, selector: '#dtab-duties'};
    f.message(data, {origin: 'https://invalid.example'});
    f.message(data, {source: {}});
    f.message({...data, version: 2});
    f.message({...data, channel: 'unexpected'});
    f.message({...data, selector: '#delete-record'});
    assert.deepEqual(f.loads, []);
    f.message(data);
    assert.deepEqual(f.loads, ['duties']);
    f.message({...data, selector: '#dtab-kanban'}, {source: f.window});
    assert.deepEqual(f.loads, ['duties', 'kanban']);
    f.revoke();
    f.message(data);
    assert.deepEqual(f.loads, ['duties', 'kanban']);
});

test('dispatch preserves the actual KPI unsaved-duty leave guard', () => {
    const f = setup();
    f.activate('#dtab-duties');
    f.flush();
    f.draftGuard();
    f.activate('#dtab-kanban');
    f.flush();
    assert.equal(f.visible('view-duties'), true);
    assert.equal(f.visible('view-kanban'), false);
    assert.deepEqual(f.loads, ['duties']);
});
