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
let window = {
    location: {
        search: ""
    }
};

// Mock fetch
let mockFetchHandler = null;
async function fetch(url, options) {
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

// 2. Evaluate the extracted functions in the local test runner context
const decodeJwtPayloadCode = extractFunction(htmlContent, 'decodeJwtPayload');
const resolveSsoAuthCode = extractFunction(htmlContent, 'resolveSsoAuth');
const checkAuthCode = extractFunction(htmlContent, 'checkAuth');

eval(decodeJwtPayloadCode);
eval(resolveSsoAuthCode);
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

    // Test 1: Valid SSO token in URL (Server verify succeeds)
    {
        console.log("Test 1: Valid token in URL...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        window.location.search = `?sso=${validToken}`;
        mockFetchHandler = async (url) => {
            return {
                ok: true,
                json: async () => ({
                    valid: true,
                    user: { id: "250013", name: "เฉิน", roles: ["Admin"], perms: { "app-kpi": ["adminDashboard"] } }
                })
            };
        };

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
    }

    // Test 2: Expired SSO token in URL (Server explicitly rejects with valid: false)
    {
        console.log("Test 2: Expired/Rejected token in URL...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_token', 'old_valid_token');
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        sessionToken = "old_valid_token";
        currentUser = null;
        window.location.search = `?sso=${expiredToken}`;
        mockFetchHandler = async (url) => {
            return {
                ok: true,
                json: async () => ({
                    valid: false,
                    reason: "invalid_or_expired_token"
                })
            };
        };

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

    // Test 3: HTTP 401 Server Rejection (Should NOT go to local decode fallback)
    {
        console.log("Test 3: HTTP 401 Rejection (No fallback)...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_token', expiredToken);
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        sessionToken = expiredToken;
        currentUser = null;
        window.location.search = `?sso=${expiredToken}`;
        mockFetchHandler = async (url) => {
            return {
                ok: false,
                status: 401
            };
        };

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.strictEqual(ssoResult.userData, null);
        assert.strictEqual(ssoResult.expired, true);
        assert.strictEqual(sessionToken, null);
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), null);
        assert.strictEqual(safeStorage.getItem('akra_sso_user_data'), null);
        console.log("-> Test 3 Passed!");
    }

    // Test 3b: HTTP 404 Server Rejection (Should NOT go to local decode fallback)
    {
        console.log("Test 3b: HTTP 404 Rejection (No fallback)...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_token', expiredToken);
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        sessionToken = expiredToken;
        currentUser = null;
        window.location.search = `?sso=${expiredToken}`;
        mockFetchHandler = async (url) => {
            return {
                ok: false,
                status: 404
            };
        };

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.strictEqual(ssoResult.userData, null);
        assert.strictEqual(ssoResult.expired, true);
        assert.strictEqual(sessionToken, null);
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), null);
        assert.strictEqual(safeStorage.getItem('akra_sso_user_data'), null);
        console.log("-> Test 3b Passed!");
    }

    // Test 4: Transient Network Error with a fresh token (Should fallback to local decode and succeed)
    {
        console.log("Test 4: Network error with fresh token...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        window.location.search = `?sso=${validToken}`;
        mockFetchHandler = async (url) => {
            throw new Error("Network offline");
        };

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.ok(ssoResult.userData);
        assert.strictEqual(ssoResult.userData.username, "250013");
        assert.strictEqual(sessionToken, validToken);
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), validToken);
        assert.ok(safeStorage.getItem('akra_sso_user_data'));

        await checkAuth(ssoResult);
        assert.strictEqual(currentUser, "250013");
        console.log("-> Test 4 Passed!");
    }

    // Test 5: Transient Network Error with an expired token (Local decode fallback rejects)
    {
        console.log("Test 5: Network error with expired token...");
        safeStorage.clear();
        sessionToken = expiredToken;
        safeStorage.setItem('akra_sso_token', expiredToken);
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        currentUser = null;
        window.location.search = `?sso=${expiredToken}`;
        mockFetchHandler = async (url) => {
            throw new Error("Network offline");
        };

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
        console.log("-> Test 5 Passed!");
    }

    // Test 6: HTTP 500 transient error with fresh token (Should fallback to local decode and succeed)
    {
        console.log("Test 6: HTTP 500 Server error with fresh token...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        window.location.search = `?sso=${validToken}`;
        mockFetchHandler = async (url) => {
            return {
                ok: false,
                status: 500
            };
        };

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.ok(ssoResult.userData);
        assert.strictEqual(ssoResult.userData.username, "250013");
        assert.strictEqual(sessionToken, validToken);
        console.log("-> Test 6 Passed!");
    }

    // Test 7: Manual login data in storage, no token
    {
        console.log("Test 7: Manual login in storage, no token...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250002", name: "ท็อป", roles: [] }));
        sessionToken = null;
        currentUser = null;
        window.location.search = ""; // no token in URL

        mockFetchHandler = async (url) => {
            throw new Error("Fetch should not be called!");
        };

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
        console.log("-> Test 7 Passed!");
    }

    console.log("=== All SSO Token Recovery Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed: ", err);
    process.exit(1);
});
