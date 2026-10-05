const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function between(start, end) {
    const first = html.indexOf(start);
    const last = html.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `missing source boundary: ${start}`);
    return html.slice(first, last);
}
const drawerSource = between('        // ================= SECONDARY UTILITY DRAWER HANDLERS =================', '        // ================= AKRA WORKLOAD EDITOR V2 =================');
const routeSource = between('        // ================= UI FUNCTIONS =================', '        function adjVol(');
const initSource = between('        function initApp(branch, permissions) {', '        // ================= API / SYNC =================');
const canSource = between('        function can(perm) {', '        function handleKpiAuthFailure(');

// Execute the candidate's real handlers and inline buttons with an in-memory DOM.
// Attribute/focus assertions are runtime evidence; CSS, native inert and layout
// still require the real-browser acceptance recorded in the implementation plan.
function setup({ verified = true, branch = 'AKRA', admin = false, grants = [] } = {}) {
    const nodes = [], byId = new Map(), listeners = new Map(), loads = [], toasts = [];
    let context, drafts = false, leaveAllowed = true, document;
    const matches = (node, selector) => selector.split(',').some(part => {
        part = part.trim();
        const descendant = part.match(/^(.+?)\s+(?:>\s+)?([^\s]+)$/);
        if (descendant) {
            if (!matches(node, descendant[2])) return false;
            if (part.includes(' > ')) return node.parentElement && matches(node.parentElement, descendant[1]);
            for (let parent = node.parentElement; parent; parent = parent.parentElement) if (matches(parent, descendant[1])) return true;
            return false;
        }
        const denied = [...part.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
        part = part.replace(/:not\([^)]+\)/g, '');
        if (denied.some(item => matches(node, item))) return false;
        if (part.includes(':disabled') && !node.disabled) return false;
        if (part.includes(':enabled') && node.disabled) return false;
        const tag = part.match(/^[\w-]+/)?.[0];
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        if ([...part.matchAll(/#([\w-]+)/g)].some(match => node.id !== match[1])) return false;
        if ([...part.matchAll(/\.([\w-]+)/g)].some(match => !node.classList.contains(match[1]))) return false;
        return [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(match =>
            node.hasAttribute(match[1]) && (match[2] === undefined || node.getAttribute(match[1]) === match[2]));
    });
    function makeNode(tag, attributes, parent) {
        const classes = new Set((attributes.get('class') || '').split(/\s+/).filter(Boolean));
        const node = {
            tagName: tag.toUpperCase(), id: attributes.get('id') || '', parentElement: parent,
            isConnected: true,
            children: [], disabled: attributes.has('disabled'), hidden: attributes.has('hidden'),
            style: {}, value: attributes.get('value') || '', textContent: '', innerText: '', innerHTML: '',
            dataset: Object.fromEntries([...attributes].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
            classList: {
                add(...items) { items.forEach(item => classes.add(item)); },
                remove(...items) { items.forEach(item => classes.delete(item)); },
                contains(item) { return classes.has(item); },
                toggle(item, force) {
                    const add = force === undefined ? !classes.has(item) : force;
                    if (add) classes.add(item); else classes.delete(item);
                    return add;
                }
            },
            setAttribute(name, value) { attributes.set(name, String(value)); },
            removeAttribute(name) { attributes.delete(name); },
            getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
            hasAttribute(name) { return attributes.has(name); },
            contains(other) { for (let item = other; item; item = item.parentElement) if (item === node) return true; return false; },
            closest(selector) { for (let item = node; item; item = item.parentElement) if (matches(item, selector)) return item; return null; },
            querySelectorAll(selector) { return nodes.filter(item => item !== node && node.contains(item) && matches(item, selector)); },
            querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
            focus() { document.activeElement = node; },
            getClientRects() { return node.offsetParent ? [{}] : []; },
            getBoundingClientRect() { return { width: node.offsetParent ? 1 : 0, height: node.offsetParent ? 1 : 0 }; },
            click() {
                if (node.disabled || node.closest('[inert]')) return;
                context.fixtureClickTarget = node;
                try { return vm.runInContext(`(function () { ${attributes.get('onclick') || ''} }).call(fixtureClickTarget)`, context); }
                finally { delete context.fixtureClickTarget; }
            }
        };
        Object.defineProperty(node, 'offsetParent', { get() {
            for (let item = node; item; item = item.parentElement) {
                if (item.hidden || item.classList.contains('hidden') || item.style.display === 'none') return null;
                if (item.tagName === 'DETAILS' && !item.open && !item.querySelector('summary')?.contains(node)) return null;
            }
            return parent || node;
        } });
        Object.defineProperty(node, 'inert', { get: () => attributes.has('inert'), set(value) { if (value) attributes.set('inert', ''); else attributes.delete('inert'); } });
        Object.defineProperty(node, 'open', { get: () => attributes.has('open'), set(value) { if (value) attributes.set('open', ''); else attributes.delete('open'); } });
        nodes.push(node);
        if (node.id && !byId.has(node.id)) byId.set(node.id, node);
        if (parent) parent.children.push(node);
        return node;
    }
    const stack = [], voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const markup = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^]*?<\/\1>/gi, '');
    for (const match of markup.matchAll(/<(\/?)([a-z][\w:-]*)([^>]*?)>/gi)) {
        const [, closing, tag, raw] = match;
        if (closing) {
            const at = stack.findLastIndex(node => node.tagName === tag.toUpperCase());
            if (at >= 0) stack.length = at;
            continue;
        }
        const attributes = new Map();
        for (const attribute of raw.matchAll(/([^\s=/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
            attributes.set(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
        }
        const node = makeNode(tag, attributes, stack.at(-1) || null);
        if (!voidTags.has(tag.toLowerCase()) && !raw.endsWith('/')) stack.push(node);
    }
    document = {
        body: nodes.find(node => node.tagName === 'BODY'), activeElement: null,
        getElementById: id => byId.get(id) || null,
        querySelector: selector => nodes.find(node => matches(node, selector)) || null,
        querySelectorAll: selector => nodes.filter(node => matches(node, selector)),
        addEventListener(name, listener) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(listener);
        }
    };
    const breakpointListeners = [];
    const mediaQuery = {
        matches: true,
        addEventListener(name, listener) { if (name === 'change') breakpointListeners.push(listener); }
    };
    const window = {
        scrollTo() {},
        matchMedia: () => mediaQuery,
        KpiKanbanBoard: { initEventListeners() {}, loadKanbanBoard() { loads.push('kanban'); } },
        KpiDutyMatrix: {
            initEventListeners() {}, loadDutyMatrix() { loads.push('duties'); },
            hasDrafts: () => drafts, confirmLeave: () => leaveAllowed
        }
    };
    const noop = () => {};
    context = vm.createContext({
        window, document, console, currentBranch: branch, currentUser: verified ? 'fixture-user' : null,
        displayUserName: 'Fixture User', currentRoles: admin ? ['ADMIN'] : [branch], IS_ADMIN: admin,
        _kpiPerms: grants, sessionToken: verified ? 'synthetic-session' : '', kpiVerifiedSession: verified ? { id: 'fixture-user' } : null,
        BRANCH_CONFIG: { AKRA: { showZone2: false }, TRD: { showZone2: false } }, _lastRecordDate: '',
        showToast: (...args) => toasts.push(args),
        fetch() { throw Error('network is forbidden in the isolated navigation fixture'); },
        getComputedStyle: node => ({ display: node.offsetParent ? 'block' : 'none', visibility: 'visible' }),
        refreshActions: noop, loadDashboardData: () => loads.push('dashboard'), updateDailyDashboard: noop,
        renderErrSeverity: () => loads.push('error'), renderErrEmpChips: noop, renderErrTimeline: noop, renderErrTeamHp: noop,
        renderWorkload: () => loads.push('workload'), renderUnifiedWorkloadActivity: noop, ensureWorkloadActivityLoaded: noop,
        loadMyProfileData: () => loads.push('my-profile'), startLiveRequisitionRefresh: noop, renderLiveRequisitions: noop, fetchLiveRequisitions: () => loads.push('billcount'),
        renderAdminDashboard: () => loads.push('admin-dash'), renderAdminPanel: () => loads.push('admin'), refreshAdminStatus: noop,
        toggleVendorBillsPending: noop, renderAkraRoster: noop, addErrorEntryRow: noop, loadTasksForSelectedDate: noop,
        applyEndOfShiftPermissionsUI: noop, restoreRecordDraft: noop, hydrateIncidentPreview: noop, loadSkillsData: noop,
        isKpiCacheStale: () => false, ScopedRefresher: { trigger: noop }
    });
    vm.runInContext(`${canSource}\n${drawerSource}\n${routeSource}\n${initSource}`, context);
    const node = id => { const item = byId.get(id); assert.ok(item, `missing actual DOM node: ${id}`); return item; };
    return {
        context, document, node, loads, toasts,
        visible: id => !node(id).classList.contains('hidden'),
        click: id => node(id).click(),
        initialize: () => context.initApp(branch, [branch]),
        open(id = 'tab-menu') { node(id).focus(); return node(id).click(); },
        key(key, shiftKey = false) {
            const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            for (const listener of listeners.get('keydown') || []) listener(event);
            return event;
        },
        draftGuard() { drafts = true; leaveAllowed = false; },
        allowLeave() { leaveAllowed = true; },
        breakpoint(mobile) {
            if (mediaQuery.matches === mobile) return;
            mediaQuery.matches = mobile;
            for (const listener of breakpointListeners) listener({ matches: mobile });
        }
    };
}

test('static structure: mobile navigation contains the approved five controls in order', () => {
    const nav = html.match(/<nav\b[^>]*\bid="bottom-nav"[^>]*>([^]*?)<\/nav>/)?.[1];
    assert.ok(nav, 'mobile navigation must exist');
    assert.deepEqual([...nav.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]),
        ['tab-error', 'tab-kanban', 'tab-workload', 'tab-dashboard', 'tab-menu']);
});

test('opening and closing Menu isolates background and restores its actual mobile opener', () => {
    const f = setup();
    f.document.body.style.overflow = 'auto';
    f.open();
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), false);
    assert.notEqual(f.node('drawer-panel').getAttribute('aria-hidden'), 'true');
    assert.equal(f.node('tab-menu').getAttribute('aria-expanded'), 'true');
    assert.ok(f.node('drawer-panel').contains(f.document.activeElement));
    for (const id of ['app-content', 'bottom-nav']) assert.equal(f.node(id).hasAttribute('inert'), true);
    assert.equal(f.document.querySelector('.app-header').hasAttribute('inert'), true);
    assert.equal(f.document.body.style.overflow, 'hidden');
    f.click('tab-kanban');
    assert.deepEqual(f.loads, [], 'background inline handlers cannot activate while modal is open');
    f.key('Escape');
    assert.equal(f.node('drawer-panel').getAttribute('aria-hidden'), 'true');
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
    assert.equal(f.node('tab-menu').getAttribute('aria-expanded'), 'false');
    assert.equal(f.document.activeElement, f.node('tab-menu'));
    for (const id of ['app-content', 'bottom-nav']) assert.equal(f.node(id).hasAttribute('inert'), false);
    assert.equal(f.document.querySelector('.app-header').hasAttribute('inert'), false);
    assert.equal(f.document.body.style.overflow, 'auto');
    f.open();
    f.click('drawer-backdrop');
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
    assert.equal(f.document.activeElement, f.node('tab-menu'));
});

test('Menu traps Tab focus among visible enabled controls and returns desktop opener focus', () => {
    const f = setup();
    f.open('btn-open-drawer');
    const drawer = f.node('drawer-panel');
    const controls = drawer.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')
        .filter(node => !node.disabled && node.offsetParent);
    assert.ok(controls.length > 1);
    controls.at(-1).focus();
    assert.equal(f.key('Tab').defaultPrevented, true);
    assert.equal(f.document.activeElement, controls[0]);
    controls[0].focus();
    assert.equal(f.key('Tab', true).defaultPrevented, true);
    assert.equal(f.document.activeElement, controls.at(-1));
    f.key('Escape');
    assert.equal(f.document.activeElement, f.node('btn-open-drawer'));
});

test('Shift+Tab skips closed tools content even when browser layout reports its rectangles', () => {
    const f = setup({ admin: true, grants: ['adminDashboard'] });
    f.open();
    const tools = f.node('drawer-tools');
    const summary = tools.querySelector('summary');
    assert.equal(tools.open, false);
    for (const control of tools.querySelectorAll('button, [href], input, select, textarea, [tabindex]')) {
        control.getClientRects = () => [{}];
    }
    const first = f.node('drawer-panel').querySelector('button');
    first.focus();
    assert.equal(f.key('Tab', true).defaultPrevented, true);
    assert.equal(f.document.activeElement, summary, 'collapsed tools and admin buttons cannot receive wrapped focus');
    assert.equal(f.key('Tab').defaultPrevented, true);
    assert.equal(f.document.activeElement, first);
});

test('rotating an open mobile Menu to desktop exposes tools without reopening it', () => {
    const f = setup();
    f.context.switchTab('error');
    f.open();
    assert.equal(f.node('drawer-tools').open, false);
    assert.equal(f.node('btn-sync').offsetParent, null, 'tools start collapsed on mobile');
    f.breakpoint(false);
    assert.equal(f.node('drawer-tools').open, true);
    assert.notEqual(f.node('btn-sync').offsetParent, null, 'desktop tools must stay reachable when the mobile summary hides');
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), false);
    assert.equal(f.visible('view-error'), true);
    assert.equal(f.node('header-section-badge').textContent, 'Incident');
    f.breakpoint(true);
    f.key('Escape');
    f.open();
    assert.equal(f.node('drawer-tools').open, false, 'a fresh mobile opening restores the compact tools group');
});

for (const [initialMobile, opener, replacement] of [
    [true, 'tab-menu', 'btn-open-drawer'], [false, 'btn-open-drawer', 'tab-menu']
]) {
    test(`closing Menu after a breakpoint change restores visible ${replacement} focus`, () => {
        const f = setup();
        f.document.body.style.overflow = 'auto';
        f.breakpoint(initialMobile);
        f.open(opener);
        assert.equal(f.node('bottom-nav').hasAttribute('inert'), true);
        f.breakpoint(!initialMobile);
        f.node(opener).getClientRects = () => [];
        f.key('Escape');
        assert.equal(f.document.activeElement, f.node(replacement));
        assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
        assert.equal(f.document.body.style.overflow, 'auto');
        for (const id of ['app-content', 'bottom-nav']) {
            assert.equal(f.node(id).hasAttribute('inert'), false);
            assert.equal(f.node(id).hasAttribute('aria-hidden'), false);
        }
        assert.equal(f.document.querySelector('.app-header').hasAttribute('inert'), false);
        assert.equal(f.document.querySelector('.app-header').hasAttribute('aria-hidden'), false);
    });
}

for (const branch of ['AKRA', 'TRD']) {
    test(`${branch} initializes with all primary controls and routes to Workload`, () => {
        const f = setup({ branch });
        f.initialize();
        for (const id of ['tab-error', 'tab-kanban', 'tab-workload', 'tab-dashboard', 'tab-menu']) assert.equal(f.visible(id), true);
        f.click('tab-workload');
        assert.equal(f.visible('view-workload'), true);
        assert.equal(f.node('tab-workload').classList.contains('tab-active'), true);
        assert.equal(f.node('header-section-badge').textContent, 'Workload');
    });
}

test('primary and secondary routes update page, header and their menu current indicators', () => {
    const f = setup();
    for (const [id, route, title] of [
        ['tab-error', 'error', 'Incident'], ['tab-kanban', 'kanban', 'บอร์ดงาน'],
        ['tab-workload', 'workload', 'Workload'], ['tab-dashboard', 'dashboard', 'แดชบอร์ด']
    ]) {
        f.click(id);
        assert.equal(f.visible(`view-${route}`), true);
        assert.equal(f.node(id).classList.contains('tab-active'), true);
        assert.equal(f.node('tab-menu').classList.contains('tab-active'), false);
        assert.equal(f.node('header-section-badge').textContent, title);
    }
    f.open();
    f.click('drawer-duties-btn');
    assert.equal(f.visible('view-duties'), true);
    assert.equal(f.node('header-section-badge').textContent, 'ตารางงาน');
    assert.equal(f.node('tab-menu').classList.contains('tab-active'), true);
    assert.equal(f.node('drawer-duties-btn').getAttribute('aria-current'), 'page');
    assert.equal(f.node('tab-dashboard').classList.contains('tab-active'), false);
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
});

test('permission-derived menu availability preserves staff, admin and executive grants', () => {
    for (const [options, adminVisible, executiveVisible] of [
        [{}, false, false], [{ admin: true }, true, false],
        [{ grants: ['adminDashboard'] }, false, true], [{ admin: true, grants: ['adminDashboard'] }, true, true]
    ]) {
        const f = setup(options);
        f.open();
        assert.equal(f.visible('drawer-admin-btn'), adminVisible);
        assert.equal(f.visible('drawer-admin-dash-btn'), executiveVisible);
        assert.equal(f.visible('drawer-admin-heading'), adminVisible || executiveVisible);
    }
});

test('unverified navigation cannot expose a destination or run its loader', () => {
    const f = setup();
    f.open();
    f.context.kpiVerifiedSession = null;
    f.context.sessionToken = '';
    f.context.currentUser = null;
    const selected = f.node('header-section-badge').textContent;
    f.click('drawer-duties-btn');
    assert.equal(f.visible('view-duties'), false);
    assert.deepEqual(f.loads, []);
    assert.equal(f.node('header-section-badge').textContent, selected);
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), false, 'rejected navigation must leave Menu usable');
    f.key('Escape');
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
});

test('an unverified session cannot open Menu or activate a primary route', () => {
    const f = setup({ verified: false });
    f.open();
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
    assert.equal(f.node('app-content').hasAttribute('inert'), false);
    assert.equal(f.node('bottom-nav').hasAttribute('inert'), false);
    f.click('tab-kanban');
    assert.equal(f.visible('view-kanban'), false);
    assert.deepEqual(f.loads, []);
});

test('staff direct privileged-route attempts retain the current page and open Menu', () => {
    const f = setup();
    f.context.switchTab('error');
    f.open();
    for (const route of ['admin', 'admin-dash']) {
        f.context.drawerNavigate(route);
        assert.equal(f.visible('view-error'), true);
        assert.equal(f.visible(`view-${route}`), false);
        assert.equal(f.node('drawer-panel').hasAttribute('inert'), false);
        assert.equal(f.node('header-section-badge').textContent, 'Incident');
    }
    assert.deepEqual(f.loads, ['error']);
    assert.equal(f.toasts.length, 2);
});

test('declining unsaved-duty leave retains the current page and a usable Menu', () => {
    const f = setup();
    f.context.switchTab('duties');
    f.draftGuard();
    f.open();
    f.click('drawer-my-profile-btn');
    assert.equal(f.visible('view-duties'), true);
    assert.equal(f.visible('view-my-profile'), false);
    assert.equal(f.node('drawer-duties-btn').getAttribute('aria-current'), 'page');
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), false);
    assert.equal(f.node('bottom-nav').hasAttribute('inert'), true);
    assert.deepEqual(f.loads, ['duties']);
    f.key('Escape');
    assert.equal(f.document.activeElement, f.node('tab-menu'));
    f.open();
    f.allowLeave();
    f.click('drawer-my-profile-btn');
    assert.equal(f.visible('view-my-profile'), true);
    assert.equal(f.visible('view-duties'), false);
    assert.equal(f.node('drawer-panel').hasAttribute('inert'), true);
    assert.deepEqual(f.loads, ['duties', 'my-profile']);
});
