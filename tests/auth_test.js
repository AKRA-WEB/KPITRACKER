const assert = require('assert');

// Mock Safe Storage
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

// Global Mocks
let safeStorage = new MockStorage();
let sessionToken = null;
let currentUser = null;
let displayUserName = "";
let currentRoles = [];
let IS_ADMIN = false;
let _kpiPerms = [];
let windowLocationSearch = "";

// Mock decodeJwtPayload (JWT exp is in Unix seconds)
function decodeJwtPayload(token) {
    if (token === "valid_token") {
        return { id: "250013", name: "เฉิน", roles: ["Admin"], exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    if (token === "expired_token") {
        return { id: "250013", name: "เฉิน", roles: ["Admin"], exp: Math.floor(Date.now() / 1000) - 3600 };
    }
    return null;
}

// Mock fetch
let mockFetchHandler = null;
async function fetch(url, options) {
    if (mockFetchHandler) {
        return mockFetchHandler(url, options);
    }
    throw new Error("No mock fetch handler set");
}

// Mock AbortController
class AbortController {
    constructor() {
        this.signal = {};
    }
    abort() {}
}

// Mock DOM elements and helpers
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
                value: ""
            };
        }
        return documentElements[id];
    }
};
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

// The target functions (reproduced exactly from index.html implementation)
async function resolveSsoAuth() {
    const result = { attempted: false, userData: null, expired: false };
    try {
        const urlParams = new URLSearchParams(windowLocationSearch);
        let ssoToken = urlParams.get('sso');
        if (!ssoToken) {
            ssoToken = safeStorage.getItem('akra_sso_token');
        }
        if (!ssoToken) return result;
        result.attempted = true;

        const portalApiUrl = "https://script.google.com/macros/s/AKfycbyQJLwb5HTexG6gxqTehGWlAxfSXVT--CpWnnp2JTcP4xCcMA1vUjSY_eWqPjUKwzq7/exec";

        try {
            const controller = new AbortController();
            const verifyRes = await fetch(`${portalApiUrl}?action=verifyToken&token=${encodeURIComponent(ssoToken)}`, { signal: controller.signal });

            if (verifyRes.ok) {
                const verifyData = await verifyRes.json();
                if (verifyData && verifyData.valid && verifyData.user) {
                    const decodedUser = verifyData.user;
                    const normalizedUid = String(decodedUser.id).toLowerCase();

                    // ดึง Roles ทั้งหมดจาก SSO และทำการแมพ Admin ให้ตรงกับที่ระบบภายในใช้
                    const ssoRoles = decodedUser.roles || [];
                    if ((ssoRoles.includes('ADMIN') || ssoRoles.includes('admin')) && !ssoRoles.includes('Admin')) {
                        ssoRoles.push('Admin');
                    }

                    result.userData = {
                        username: normalizedUid,
                        name: decodedUser.name,
                        roles: ssoRoles,
                        perms: decodedUser.perms || {}
                    };
                    sessionToken = ssoToken;
                    safeStorage.setItem('akra_sso_token', ssoToken);
                    safeStorage.setItem('akra_sso_user_data', JSON.stringify(result.userData));
                } else {
                    // โทเค็นหมดอายุหรือถูกปฏิเสธโดยตรงจากเซิร์ฟเวอร์ -> ล้างค่าเซสชันและไม่ทำ fallback
                    console.warn("SSO token was rejected by server:", verifyData && verifyData.reason);
                    safeStorage.removeItem('akra_sso_token');
                    safeStorage.removeItem('akra_sso_user_data');
                    sessionToken = null;
                    result.userData = null;
                    result.expired = true;
                }
            } else {
                // verifyRes is not ok (e.g. 401, 403, 500, etc.)
                if (verifyRes.status === 401 || verifyRes.status === 403 || verifyRes.status === 400) {
                    // เป็นการปฏิเสธสิทธิ์โดยตรงจากเซิร์ฟเวอร์ -> ล้างค่าเซสชันและไม่ทำ fallback
                    console.warn("SSO token was explicitly rejected by server with status:", verifyRes.status);
                    safeStorage.removeItem('akra_sso_token');
                    safeStorage.removeItem('akra_sso_user_data');
                    sessionToken = null;
                    result.userData = null;
                    result.expired = true;
                } else {
                    // ปัญหาเซิร์ฟเวอร์ขัดข้อง (เช่น 5xx) -> ให้โยนความผิดพลาดเพื่อให้วิ่งเข้า local decode fallback
                    throw new Error(`HTTP status ${verifyRes.status}`);
                }
            }
        } catch (e) {
            console.warn("API token verification failed, trying local decode as fallback...", e);
            // ทำ Local Decode เป็น Fallback เฉพาะในกรณีที่เรียก API ไม่สำเร็จจริง ๆ (เน็ตเสีย/Timeout)
            const decodedUser = decodeJwtPayload(ssoToken);
            if (decodedUser && decodedUser.id) {
                // ตรวจสอบวันหมดอายุของ JWT ในระดับ local ด้วย เพื่อความปลอดภัย (exp เก็บในหน่วยวินาที ต้องคูณ 1000)
                const currentTime = new Date().getTime();
                if (decodedUser.exp && decodedUser.exp * 1000 <= currentTime) {
                    console.warn("SSO token is locally expired, clearing session");
                    safeStorage.removeItem('akra_sso_token');
                    safeStorage.removeItem('akra_sso_user_data');
                    sessionToken = null;
                    result.userData = null;
                    result.expired = true;
                } else {
                    const normalizedUid = String(decodedUser.id).toLowerCase();
                    const ssoRoles = decodedUser.roles || [];
                    if ((ssoRoles.includes('ADMIN') || ssoRoles.includes('admin')) && !ssoRoles.includes('Admin')) {
                        ssoRoles.push('Admin');
                    }

                    result.userData = {
                        username: normalizedUid,
                        name: decodedUser.name || normalizedUid,
                        roles: ssoRoles,
                        perms: decodedUser.perms || {}
                    };
                    sessionToken = ssoToken;
                    safeStorage.setItem('akra_sso_token', ssoToken);
                    safeStorage.setItem('akra_sso_user_data', JSON.stringify(result.userData));
                }
            }
        }
    } catch(e) { console.error("SSO auth check failed", e); }
    return result;
}

async function checkAuth(preSso = null) {
    let userData = null;

    // 1. ดึงจาก URL Query Parameters ก่อน (เช่น ?sso=JWT_TOKEN หรือ ?uid=250013)
    const sso = preSso || await resolveSsoAuth();
    userData = sso.userData;

    if (sso.expired) {
        userData = null;
        safeStorage.removeItem('akra_sso_user_data');
    }

    if (!userData && !sso.attempted) {
        // Mock fallback for param Uid check (not needed for main regression test)
    }

    if (!userData) {
        const savedData = safeStorage.getItem('akra_sso_user_data');
        if (savedData) {
            try {
                userData = JSON.parse(savedData);
            } catch(e) { console.error(e); }
        }
    }

    if (userData) {
        currentUser = userData.username || userData.id || userData.name;
        displayUserName = userData.name || currentUser;
        currentRoles = userData.roles || [];
    } else {
        showManualLoginModal();
        return;
    }

    // set permission configs
    IS_ADMIN = currentRoles.includes('Admin') || currentRoles.includes('admin');
    const _ssoData = JSON.parse(safeStorage.getItem('akra_sso_user_data') || '{}');
    _kpiPerms = (_ssoData.perms && _ssoData.perms["app-kpi"]) || [];

    applyRolePermissions();
    refreshActions();
}

// Test Runner
async function runTests() {
    console.log("=== Running SSO Token Recovery Regression Tests ===");

    // Test 1: Valid SSO token in URL (Server verify succeeds)
    {
        console.log("Test 1: Valid token in URL...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        windowLocationSearch = "?sso=valid_token";
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
        assert.strictEqual(sessionToken, "valid_token");
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), "valid_token");
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
        windowLocationSearch = "?sso=expired_token";
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
        safeStorage.setItem('akra_sso_token', 'expired_token');
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        sessionToken = "expired_token";
        currentUser = null;
        windowLocationSearch = "?sso=expired_token";
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

    // Test 4: Transient Network Error with a fresh token (Should fallback to local decode and succeed)
    {
        console.log("Test 4: Network error with fresh token...");
        safeStorage.clear();
        sessionToken = null;
        currentUser = null;
        windowLocationSearch = "?sso=valid_token";
        mockFetchHandler = async (url) => {
            throw new Error("Network offline");
        };

        const ssoResult = await resolveSsoAuth();
        assert.strictEqual(ssoResult.attempted, true);
        assert.ok(ssoResult.userData);
        assert.strictEqual(ssoResult.userData.username, "250013");
        assert.strictEqual(sessionToken, "valid_token");
        assert.strictEqual(safeStorage.getItem('akra_sso_token'), "valid_token");
        assert.ok(safeStorage.getItem('akra_sso_user_data'));

        await checkAuth(ssoResult);
        assert.strictEqual(currentUser, "250013");
        console.log("-> Test 4 Passed!");
    }

    // Test 5: Transient Network Error with an expired token (Local decode fallback rejects)
    {
        console.log("Test 5: Network error with expired token...");
        safeStorage.clear();
        sessionToken = "expired_token";
        safeStorage.setItem('akra_sso_token', 'expired_token');
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250013", name: "เฉิน" }));
        currentUser = null;
        windowLocationSearch = "?sso=expired_token";
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
        windowLocationSearch = "?sso=valid_token";
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
        assert.strictEqual(sessionToken, "valid_token");
        console.log("-> Test 6 Passed!");
    }

    // Test 7: Manual login data in storage, no token
    {
        console.log("Test 7: Manual login in storage, no token...");
        safeStorage.clear();
        safeStorage.setItem('akra_sso_user_data', JSON.stringify({ username: "250002", name: "ท็อป", roles: [] }));
        sessionToken = null;
        currentUser = null;
        windowLocationSearch = ""; // no token in URL
        
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
