const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extractFunction(content, name) {
    const start = content.indexOf(`function ${name}`);
    if (start === -1) throw new Error(`Function ${name} not found`);
    const openBrace = content.indexOf('{', start);
    let depth = 0;
    for (let index = openBrace; index < content.length; index += 1) {
        if (content[index] === '{') depth += 1;
        if (content[index] === '}') {
            depth -= 1;
            if (depth === 0) return content.slice(start, index + 1);
        }
    }
    throw new Error(`Function ${name} is not balanced`);
}

function createStorage(initial) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    };
}

function createRuntime() {
    const storage = createStorage({
        akra_sso_token: 'stale-token',
        akra_sso_user_data: '{"username":"chen"}',
        akra_session_token: 'legacy-token',
        akra_user_data: '{"username":"chen"}'
    });
    const appContent = { hidden: false, classList: { add(name) { if (name === 'hidden') appContent.hidden = true; } } };
    const redirects = [];
    const toasts = [];
    const context = {
        PORTAL_URL: 'https://akra-web.github.io/Main/',
        sessionToken: 'stale-token',
        _kpiAuthRedirecting: false,
        safeStorage: storage,
        document: { getElementById(id) { return id === 'app-content' ? appContent : null; } },
        window: { location: { replace(url) { redirects.push(url); } } },
        showToast(message, isError) { toasts.push({ message, isError }); },
        setTimeout(callback) { callback(); return 1; }
    };
    vm.createContext(context);
    vm.runInContext(`${extractFunction(html, 'handleKpiAuthFailure')};`, context);
    return { context, storage, appContent, redirects, toasts };
}

{
    const runtime = createRuntime();
    assert.strictEqual(runtime.context.handleKpiAuthFailure({ reason: 'invalid_or_expired_token', status: 401 }), true);
    assert.strictEqual(runtime.context.sessionToken, null, 'rejected auth must clear the active token');
    for (const key of ['akra_sso_token', 'akra_sso_user_data', 'akra_session_token', 'akra_user_data']) {
        assert.strictEqual(runtime.storage.getItem(key), null, `${key} must be removed after auth rejection`);
    }
    assert.strictEqual(runtime.appContent.hidden, true, 'protected UI must be hidden before redirect');
    assert.deepStrictEqual(runtime.redirects, ['https://akra-web.github.io/Main/']);
    assert.strictEqual(runtime.toasts.length, 1);
}

{
    const runtime = createRuntime();
    assert.strictEqual(runtime.context.handleKpiAuthFailure({ reason: 'database_error', status: 500 }), false);
    assert.strictEqual(runtime.context.sessionToken, 'stale-token');
    assert.strictEqual(runtime.storage.getItem('akra_sso_token'), 'stale-token');
    assert.deepStrictEqual(runtime.redirects, []);
}

{
    const runtime = createRuntime();
    assert.strictEqual(runtime.context.handleKpiAuthFailure({ status: 401 }), true, 'bare HTTP 401 must be treated as terminal auth failure');
    assert.strictEqual(runtime.context.handleKpiAuthFailure({ status: 401 }), true, 'repeated auth failure must remain handled');
    assert.strictEqual(runtime.redirects.length, 1, 'repeated failures must not create redirect loops');
}

console.log('KPI auth recovery regression checks passed.');
