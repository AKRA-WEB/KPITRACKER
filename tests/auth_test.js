const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Read index.html and extract functions to prevent production/test drift
const htmlPath = path.join(__dirname, '../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(content, name) {
    const startIdx = content.indexOf(`async function ${name}`);
    if (startIdx === -1) {
        // Try without async
        const normalIdx = content.indexOf(`function ${name}`);
        if (normalIdx === -1) throw new Error(`Function ${name} not found`);
        return extractBraceBlock(content, normalIdx, `function ${name}`);
    }
    return extractBraceBlock(content, startIdx, `async function ${name}`);
}

function extractBraceBlock(content, startIdx, prefix) {
    const openBraceIdx = content.indexOf('{', startIdx);
    let braceCount = 1;
    let currentIdx = openBraceIdx + 1;

    while (braceCount > 0 && currentIdx < content.length) {
        if (content[currentIdx] === '{') braceCount++;
        else if (content[currentIdx] === '}') braceCount--;
        currentIdx++;
    }

    return content.substring(startIdx, currentIdx);
}

// Global scope mocks for evaluated code
class MockStorage {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] || null;
    }
    setItem(key, val) {
        this.store[key] = String(val);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

let safeStorage = new MockStorage();
let sessionToken = null;
let currentUser = null;
let displayUserName = "";
let currentRoles = [];
let IS_ADMIN = false;
let _kpiPerms = [];
let KPI_MAIN_VIEWER = null;
let window = {
    location: {
        search: ""
    }
};

// Mock fetch
let mockFetchHandler = null;
let fetchCallCount = 0;
async function fetch(url, options) {
    fetchCallCount++;
    if (mockFetchHandler) {
        return mockFetchHandler(url, options);
    }
    throw new Error("No mock fetch handler set");
}

// Mock DOM & helpers
const documentElements = {};
const document = {
    getElementById(id) {
        if (!documentElements[id]) {
            documentElements[id] = {
                classList: {
                    add: () => {},
                    remove: () => {}
                },
                innerText: "",
                value: "",
                valueAsDate: null
            };
        }
        return documentElements[id];
    },
    querySelectorAll(selector) {
        return [];
    }
};

let GLOBAL_CONFIG_LIST = [];

function showManualLoginModal() {
    showManualLoginModal.called = true;
}
showManualLoginModal.called = false;

function applyRolePermissions() {
    applyRolePermissions.called = true;
}
applyRolePermissions.called = false;

function refreshActions() {
    refreshActions.called = true;
}
refreshActions.called = false;

function can(perm) {
    return _kpiPerms.includes(perm);
}

function renderAdminPanel() {
    renderAdminPanel.called = true;
}
renderAdminPanel.called = false;

function syncAllBranchesForAdmin() {
    syncAllBranchesForAdmin.called = true;
}
syncAllBranchesForAdmin.called = false;

function startAdminStatusRefresh() {}

// 2. Evaluate the extracted functions in the local test runner context
const decodeJwtPayloadCode = extractFunction(htmlContent, 'decodeJwtPayload');
const resolveSsoAuthCode = extractFunction(htmlContent, 'resolveSsoAuth');
const canAccessAdminSettingsCode = extractFunction(htmlContent, 'canAccessAdminSettings');
const checkAuthCode = extractFunction(htmlContent, 'checkAuth');

eval(decodeJwtPayloadCode);
eval(resolveSsoAuthCode);
eval(canAccessAdminSettingsCode);
eval(checkAuthCode);

// Helper to generate mock base64url JWT tokens
function generateMockJwt(payload) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encodedHeader}.${encodedPayload}.mock_signature`;
}

// Test Runner
async function runTests() {
    console.log("=== Running SSO Token Recovery Regression Tests ===");

    const validToken = generateMockJwt({ id: "250013", name: "เฉิน", roles: ["Admin"], exp: Math.floor(Date.now() / 1000) + 3600 });
    const expiredToken = generateMockJwt({ id: "250013", name: "เฉิน", roles: ["Admin"], exp: Math.floor(Date.now() / 1000) - 3600 });

    // Test 1: Valid SSO token in URL
    {
        console.log("Test 1: Valid token in URL...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        window.location.search = `?sso=${validToken}`;

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.ok(ssoResult.userData);
        assert.strictEqual(ssoResult.userData.username, "250013");
        assert.strictEqual(sessionToken, validToken);
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), validToken);
        assert.ok(safeStorage.getItem('akra_sso_user_data'));

        await checkAuth(ssoResult);
        assert.strictEqual(currentUser, "250013");
        assert.ok(_kpiPerms.includes("adminDashboard"));
        console.log("-> Test 1 Passed!");

        KPI_MAIN_VIEWER = { uid: '250013', name: 'Current Worker', roles: ['WAREHOUSE'], status: 'Active' };
        await checkAuth(ssoResult);
        assert.deepStrictEqual(currentRoles, ['WAREHOUSE'], 'current Main row roles must override stale JWT roles');
        assert.strictEqual(IS_ADMIN, false, 'stale ADMIN claim must not expose Admin Settings');
        KPI_MAIN_VIEWER = null;
    }

    // Test 2: Expired SSO token in URL
    {
        console.log("Test 2: Expired token in URL...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_token', 'old_valid_token');
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        sessionToken = "old_valid_token";
        currentUser = null;
        window.location.search = `?sso=${expiredToken}`;

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.strictEqual(ssoResult.userData, null);
        assert.strictEqual(ssoResult.expired, true);
        assert.strictEqual(sessionToken, null);
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), null);

        showManualLoginModal.called = false;
        await checkAuth(ssoResult);
        assert.strictEqual(currentUser, null);
        assert.strictEqual(safeStorage.getItem('akra_sso_user_data'), null);
        assert.strictEqual(showManualLoginModal.called, true);
        console.log("-> Test 2 Passed!");
    }

    // Test 3: Manual login data in storage, no token
    {
        console.log("Test 3: Manual login in storage, no token...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250002", name: "ท็อป", roles: [] }));
        sessionToken = null;
        currentUser = null;
        window.location.search = ""; // no token in URL

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, false);
        assert.strictEqual(ssoResult.userData, null);
        assert.strictEqual(ssoResult.expired, false);
        assert.strictEqual(sessionToken, null);

        showManualLoginModal.called = false;
        await checkAuth(ssoResult);
        assert.strictEqual(currentUser, "250002");
        assert.strictEqual(showManualLoginModal.called, false);
        assert.strictEqual(sessionToken, null); // session token remains null
        console.log("-> Test 3 Passed!");
    }

    console.log("=== All SSO Token Recovery Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed: ", err);
    process.exit(1);
});
