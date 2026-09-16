const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const htmlPath = path.join(__dirname, '..', 'index.html');
const edgePath = path.resolve(__dirname, '..', '..', 'database', 'supabase', 'functions', 'kpi-api', 'index.ts');
const html = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(source, name) {
    const asyncStart = source.indexOf(`async function ${name}`);
    const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}`);
    if (start < 0) throw new Error(`${name} not found`);
    const openBrace = source.indexOf('{', start);
    let depth = 1;
    let cursor = openBrace + 1;
    while (depth > 0 && cursor < source.length) {
        if (source[cursor] === '{') depth++;
        else if (source[cursor] === '}') depth--;
        cursor++;
    }
    return source.slice(start, cursor);
}

function testFrontendAuthorizationAndIdentity() {
    assert.match(html, /id="drawer-admin-btn"[\s\S]{0,600}ตั้งค่าระบบ &amp; จัดการข้อมูล/,
        'KPI Supervisor administration must be discoverable as system settings and data management');
    vm.runInThisContext(extractFunction(html, 'hasKpiAdminRole'));
    vm.runInThisContext(extractFunction(html, 'canAccessAdminSettings'));
    assert.equal(canAccessAdminSettings(['SUPERVISOR'], 'verified-token'), true,
        'an authenticated Supervisor must open KPI administration');
    assert.equal(canAccessAdminSettings(['SUPERVISOR'], ''), false,
        'a Supervisor without an authenticated token must remain denied');
    assert.equal(canAccessAdminSettings(['WAREHOUSE'], 'verified-token'), false,
        'an ordinary KPI employee must remain denied KPI administration');

    const elements = {
        'drawer-user-name': { textContent: '' },
        'drawer-user-role': { textContent: '' },
        'drawer-branch-badge': { textContent: '' },
        'drawer-admin-heading': { classList: { add() {}, remove() {} } },
        'drawer-admin-dash-btn': { classList: { add() {}, remove() {} } },
        'drawer-admin-btn': { classList: { add() {}, remove() {} } }
    };
    const context = vm.createContext({
        IS_ADMIN: true,
        currentUser: 'supervisor-1',
        displayUserName: 'หัวหน้างานตัวอย่าง',
        currentRoles: ['SUPERVISOR'],
        currentBranch: 'AKRA',
        can: () => false,
        document: { getElementById: id => elements[id] || null }
    });
    vm.runInContext(extractFunction(html, 'updateDrawerUserInfo'), context);
    context.updateDrawerUserInfo();
    assert.equal(elements['drawer-user-name'].textContent, 'หัวหน้างานตัวอย่าง',
        'Supervisor display name must remain visible in KPI');
    assert.equal(elements['drawer-user-role'].textContent, 'หัวหน้างาน (Supervisor)',
        'elevated KPI access must not relabel the user as ADMIN');
}

function loadEdgeHandler(fixtures) {
    let handler = null;
    const edgeCode = fs.readFileSync(edgePath, 'utf8')
        .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
        .replace(/^const\s+LEGACY_MAIN_VERIFY_URL\s*=.*?;/m, 'const LEGACY_MAIN_VERIFY_URL = "http://mock-legacy-main/exec";')
        .replace(/\bconst\s+branches:\s*string\[\]\s*=/g, 'const branches =')
        .replace(/\bconst\s+values:\s*Record<string,\s*string>\s*=/g, 'const values =');
    const context = {
        console,
        Date,
        Set,
        Map,
        Array,
        Object,
        Number,
        String,
        Boolean,
        JSON,
        RegExp,
        Error,
        Math,
        Intl,
        encodeURIComponent,
        fetch: async () => new Response('{}', { status: 200 }),
        Response,
        Headers,
        Request,
        TextEncoder,
        TextDecoder,
        Deno: {
            env: { get: key => fixtures.env?.[key] || '' },
            serve: fn => { handler = fn; }
        },
        __KPI_API_TEST_FIXTURES__: fixtures
    };
    vm.createContext(context);
    new vm.Script(stripTypeScriptTypes(edgeCode), { filename: edgePath }).runInContext(context);
    assert.equal(typeof handler, 'function', 'kpi-api must register its request handler');
    return handler;
}

async function callApi(handler, payload) {
    const response = await handler(new Request('https://example.test', {
        method: 'POST',
        headers: { Origin: 'https://akra-web.github.io', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }));
    return { status: response.status, body: await response.json() };
}

function makeFixtures(roles) {
    const dbCalls = [];
    const rpcCalls = [];
    const currentUser = {
        username: 'supervisor-1',
        name: 'หัวหน้างานตัวอย่าง',
        roles,
        status: 'Active'
    };
    return {
        dbCalls,
        rpcCalls,
        verifyMainJwt: async () => ({ id: 'supervisor-1', roles, apps: ['app-kpi'], exp: 9999999999 }),
        dbRows: async (table, query) => {
            dbCalls.push({ table, query });
            if (table === 'users' && query.includes('username=eq.supervisor-1')) return [currentUser];
            if (table === 'users') return [
                currentUser,
                { username: 'worker-1', name: 'พนักงานตัวอย่าง', roles: ['WAREHOUSE'], status: 'Active' }
            ];
            if (table === 'kpi_employees' || table === 'kpi_daily_records' || table === 'kpi_system_configs') return [];
            throw new Error(`unexpected read ${table}`);
        },
        dbRpc: async (name, body) => {
            rpcCalls.push({ name, body });
            if (name === 'kpi_save_system_config_v1') return { config: { config_value: body.p_config_value } };
            return [];
        }
    };
}

(async () => {
    testFrontendAuthorizationAndIdentity();

    const supervisorFixtures = makeFixtures(['SUPERVISOR']);
    const supervisorHandler = loadEdgeHandler(supervisorFixtures);

    const adminStatus = await callApi(supervisorHandler, {
        action: 'getAdminStatus', token: 'supervisor-token'
    });
    assert.equal(adminStatus.status, 200, 'Supervisor must pass the KPI admin status gate');
    assert.equal(adminStatus.body.viewer.name, 'หัวหน้างานตัวอย่าง');
    assert.equal(adminStatus.body.employees[0].name, 'หัวหน้างานตัวอย่าง',
        'KPI admin roster must retain the Main-backed Supervisor name');
    assert.deepEqual(Array.from(adminStatus.body.viewer.roles), ['SUPERVISOR'],
        'KPI must preserve the Supervisor role instead of converting it to ADMIN');

    const saveConfig = await callApi(supervisorHandler, {
        action: 'saveSystemConfig',
        token: 'supervisor-token',
        configKey: 'workload_duties',
        configValue: { primaryDuties: [{ name: 'งานหลัก' }], supportDuties: [{ name: 'งานช่วย' }] }
    });
    assert.equal(saveConfig.status, 200, 'Supervisor must edit KPI system configuration like ADMIN');

    const saveIncidentCatalog = await callApi(supervisorHandler, {
        action: 'saveIncidentCatalog',
        token: 'supervisor-token',
        configValue: {
            catalogRevision: 1,
            branches: {
                AKRA: {
                    categories: [{ key: 'ops', label: 'Operations' }],
                    types: [{ id: 'issue', name: 'Issue', category: 'ops', active: true, quick: true, impacts: ['contained'] }],
                    impacts: [{ id: 'contained', label: 'Contained' }]
                },
                TRD: {
                    categories: [{ key: 'ops', label: 'Operations' }],
                    types: [{ id: 'issue', name: 'Issue', category: 'ops', active: true, quick: true, impacts: ['contained'] }],
                    impacts: [{ id: 'contained', label: 'Contained' }]
                }
            }
        }
    });
    assert.equal(saveIncidentCatalog.status, 200, 'Supervisor must edit KPI incident catalog like ADMIN');

    const saveSkillCatalog = await callApi(supervisorHandler, {
        action: 'saveSkillCatalogItem',
        token: 'supervisor-token',
        skill: { code: 'SAFETY', name: 'Safety', category: 'general' }
    });
    assert.equal(saveSkillCatalog.status, 200, 'Supervisor must edit KPI skill catalog like ADMIN');

    const deleteSkill = await callApi(supervisorHandler, {
        action: 'deleteSkillCatalogItem', token: 'supervisor-token', skillCode: 'FORKLIFT'
    });
    assert.equal(deleteSkill.status, 200, 'Supervisor must use KPI skill catalog mutations like ADMIN');

    const updateOtherAvatar = await callApi(supervisorHandler, {
        action: 'uploadProfileAvatar', token: 'supervisor-token', employeeUid: 'worker-1', avatarData: 'data:image/webp;base64,AAAA'
    });
    assert.equal(updateOtherAvatar.status, 200, 'Supervisor must manage KPI employee profile data like ADMIN');
    assert.equal(updateOtherAvatar.body.employeeUid, 'worker-1');

    const bindOtherLine = await callApi(supervisorHandler, {
        action: 'bindLineAccount', token: 'supervisor-token', employeeUid: 'worker-1',
        lineUserId: 'Uworker', lineDisplayName: 'พนักงานตัวอย่าง'
    });
    assert.equal(bindOtherLine.status, 200, 'Supervisor must manage KPI employee LINE profile data like ADMIN');
    assert.equal(supervisorFixtures.rpcCalls.at(-1).body.p_employee_uid, 'worker-1');

    const ordinaryFixtures = makeFixtures(['WAREHOUSE']);
    const ordinaryHandler = loadEdgeHandler(ordinaryFixtures);
    const denied = await callApi(ordinaryHandler, {
        action: 'saveSystemConfig',
        token: 'worker-token',
        configKey: 'workload_duties',
        configValue: { primaryDuties: [{ name: 'งานหลัก' }], supportDuties: [{ name: 'งานช่วย' }] }
    });
    assert.equal(denied.status, 403, 'ordinary KPI employees must remain denied admin mutations');
    assert.equal(ordinaryFixtures.rpcCalls.length, 0, 'denied admin mutation must not reach a mutation RPC');

    console.log('PASS supervisor-admin-access: Supervisor KPI admin parity and Main-backed name preservation');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
