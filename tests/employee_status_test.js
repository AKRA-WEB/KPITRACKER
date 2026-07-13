const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

function extractFunction(content, name) {
    const startIdx = content.indexOf(`async function ${name}`);
    if (startIdx === -1) {
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

// Global scope mocks for test
let GLOBAL_CONFIG_LIST = [];
let USER_DB = {};
let TRD_DEPARTMENTS = {};
let BRANCH_CONFIG = {
    "AKRA": { employees: [], showZone2: true },
    "TRD": { employees: [], showZone2: false }
};
let window = {};

// Mock Storage
class MockStorage {
    constructor() { this.store = {}; }
    getItem(key) { return this.store[key] || null; }
    setItem(key, val) { this.store[key] = String(val); }
    clear() { this.store = {}; }
}
const safeStorage = new MockStorage();

// Mock DOM elements
const documentElements = {};
const document = {
    getElementById(id) {
        if (!documentElements[id]) {
            documentElements[id] = {
                classList: {
                    add: (c) => { documentElements[id].classes.add(c); },
                    remove: (c) => { documentElements[id].classes.delete(c); }
                },
                classes: new Set(),
                innerText: "",
                innerHTML: "",
                value: "",
                valueAsDate: null
            };
        }
        return documentElements[id];
    }
};

// Evaluate helper functions from index.html
const isEmployeeActiveCode = extractFunction(htmlContent, 'isEmployeeActive');
const processConfigListCode = extractFunction(htmlContent, 'processConfigList');
const dedupeConfigListCode = extractFunction(htmlContent, 'dedupeConfigList');

eval(dedupeConfigListCode);
eval(isEmployeeActiveCode);
eval(processConfigListCode);

// Add required mocks to run loadDashboardData
let viewOffsetWeek = 0;
let currentBranch = "AKRA";
let workloadTrendWeeks = 4;
let _cachedTrendData = null;

function getStartOfWeek(d) {
    const ws = new Date(d);
    const day = ws.getDay();
    const diff = ws.getDate() - day + (day === 0 ? -6 : 1);
    ws.setDate(diff);
    return ws;
}

function normalizeEmpName(n) { return String(n || '').trim(); }
function esc(v) { return v || ''; }
function formatDisplayDate(d) { return d; }
function renderEndOfShiftDashboard() {}
function renderVendorBillsDashboard() {}
function renderWorkloadTrend() {}
function renderTeamScene() { return ''; }
function renderEmpBreakdown() {}
function getSmartSuggestion() { return ''; }
function analyzeKeywordInsights() { return []; }

function getErrorDetail(e, branch) {
    return {
        type: e.type,
        penalty: Number(e.penalty || 5),
        cleanNote: e.note || "",
        isReachedCustomer: false,
        isFixedBefore: false,
        isAkraCase: false
    };
}

// Evaluate loadDashboardData
const loadDashboardDataCode = extractFunction(htmlContent, 'loadDashboardData');
eval(loadDashboardDataCode);

// Helper to reset mocks
function resetMocks() {
    GLOBAL_CONFIG_LIST = [];
    USER_DB = {};
    TRD_DEPARTMENTS = {};
    BRANCH_CONFIG = {
        "AKRA": { employees: [], showZone2: true },
        "TRD": { employees: [], showZone2: false }
    };
    safeStorage.clear();
    for (const key in documentElements) {
        delete documentElements[key];
    }
    viewOffsetWeek = 0;
    currentBranch = "AKRA";
    window = {};
}

async function runTests() {
    console.log("=== Running Employee Inactive Filter Regression Tests ===");

    // Test 0: Settings must be a sibling view so hiding Executive Dashboard does not hide Settings.
    {
        console.log("Test 0: checking Settings is not nested inside Executive Dashboard...");
        const adminDashStart = htmlContent.indexOf('<div id="view-admin-dash"');
        const adminViewStart = htmlContent.indexOf('<div id="view-admin"');
        assert.ok(adminDashStart >= 0 && adminViewStart > adminDashStart, "Admin views must exist in document order");

        const adminDashMarkup = htmlContent.slice(adminDashStart, adminViewStart);
        const openedDivs = (adminDashMarkup.match(/<div\b/gi) || []).length;
        const closedDivs = (adminDashMarkup.match(/<\/div>/gi) || []).length;
        assert.strictEqual(openedDivs, closedDivs, "Settings view must not be nested inside the hidden Executive Dashboard view");
        console.log("-> Test 0 Passed!");
    }

    // Test 1: isEmployeeActive check
    {
        console.log("Test 1: checking isEmployeeActive with active, inactive, and blank status...");
        resetMocks();
        GLOBAL_CONFIG_LIST = [
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "TRD", dept: "แคชเชียร์", gender: "F", status: "Inactive" },
            { uid: "emp3", name: "Sompong", branches: "AKRA,TRD", dept: "หน้าร้าน/ในร้าน", gender: "M", status: "" }
        ];

        // Explicitly normalize status for test list
        GLOBAL_CONFIG_LIST.forEach(u => {
            u.status = u.status === 'Inactive' ? 'Inactive' : 'Active';
        });

        assert.strictEqual(isEmployeeActive("Somchai"), true, "Active employee should be active");
        assert.strictEqual(isEmployeeActive("Somsri"), false, "Inactive employee should NOT be active");
        assert.strictEqual(isEmployeeActive("Sompong"), true, "Missing status should default to active");
        assert.strictEqual(isEmployeeActive("Unknown"), false, "Unconfigured/Unknown employee should default to inactive");
        console.log("-> Test 1 Passed!");
    }

    // Test 2: processConfigList behavior and TRD department compatibility
    {
        console.log("Test 2: checking processConfigList handles status, normalization and TRD department compatibility...");
        resetMocks();
        const configList = [
            { uid: "250013", name: "เฉิน", branches: "AKRA,TRD", dept: "Admin", gender: "", status: "ACTIVE" }, // Upper active
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "TRD", dept: "แคชเชียร์", gender: "F", status: "inactive" }, // Lower inactive
            { uid: "emp3", name: "Sompong", branches: "AKRA,TRD", dept: "หน้าร้าน/ในร้าน", gender: "M", status: "" }, // Blank
            { uid: "emp4", name: "Sompis", branches: "TRD", dept: "แคชเชียร์", gender: "F", status: "Active" } // TRD Active
        ];

        processConfigList(configList);

        // Verify normalization
        const chen = GLOBAL_CONFIG_LIST.find(e => e.name === "เฉิน");
        assert.strictEqual(chen.status, "Active", "Upper active status must be normalized to Active");
        const somsri = GLOBAL_CONFIG_LIST.find(e => e.name === "Somsri");
        assert.strictEqual(somsri.status, "Inactive", "Lower inactive status must be normalized to Inactive");

        // Verify that Admin is not in BRANCH_CONFIG employees list
        assert.ok(!BRANCH_CONFIG["AKRA"].employees.includes("เฉิน"), "Admin must not be in AKRA employees list");

        // Verify Active employee ( Somchai )
        assert.ok(BRANCH_CONFIG["AKRA"].employees.includes("Somchai"), "Active employee must be in AKRA employees list");

        // Verify Inactive employee ( Somsri )
        assert.ok(!BRANCH_CONFIG["TRD"].employees.includes("Somsri"), "Inactive employee must not be in TRD employees list");

        // Verify TRD department mapping compatibility
        assert.ok(TRD_DEPARTMENTS["แคชเชียร์"], "TRD department 'แคชเชียร์' must be initialized");
        assert.ok(TRD_DEPARTMENTS["แคชเชียร์"].includes("Sompis"), "Active TRD employee must be present in TRD_DEPARTMENTS");
        assert.ok(!TRD_DEPARTMENTS["แคชเชียร์"].includes("Somsri"), "Inactive TRD employee must NOT be present in TRD_DEPARTMENTS");

        // Verify Legacy blank status employee ( Sompong )
        assert.ok(BRANCH_CONFIG["AKRA"].employees.includes("Sompong"), "Blank status employee must default to Active and be in AKRA");
        assert.ok(BRANCH_CONFIG["TRD"].employees.includes("Sompong"), "Blank status employee must default to Active and be in TRD");
        assert.ok(TRD_DEPARTMENTS["หน้าร้าน/ในร้าน"].includes("Sompong"), "Blank status TRD employee must remain in the configured department");
        console.log("-> Test 2 Passed!");
    }

    // Test 3: loadDashboardData with historical errors, workloads and HP penalty preservation
    {
        console.log("Test 3: checking loadDashboardData handles historical data, hides inactive names and preserves HP penalties...");
        resetMocks();
        
        // Setup configuration
        const configList = [
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "AKRA", dept: "", gender: "F", status: "Inactive" }
        ];
        processConfigList(configList);

        // Mock historical data (one week containing errors and workloads for both Somchai and Somsri)
        const dateStr = getStartOfWeek(new Date()).toISOString().slice(0, 10);
        
        // Mathematically prove workload totals include inactive employee Somsri:
        // Somchai (Active): outbound: 4, inbound: 0, transfer: 0, shared: 0 (100% outbound if alone)
        // Somsri (Inactive): outbound: 0, inbound: 6, transfer: 0, shared: 0 (100% inbound if alone)
        // Combined total: outbound: 4, inbound: 6. Total = 10.
        // Outbound percentage = 4 / 10 = 40%. Inbound percentage = 6 / 10 = 60%.
        // If the code only counted active employees, team workload would be 100% outbound.
        // Since we assert 40% outbound and 60% inbound, Somsri must be included in the calculation.
        const mockKpiData = [
            {
                date: dateStr,
                sourceBranch: "AKRA",
                volume: { transfer: 10, pickup: 10, upcountry: 10, inmarket: 10, outmarket: 10 },
                errors: [
                    { emp: "Somchai", type: "หยิบผิด ถึงลูกค้าแล้ว", penalty: 20, note: "Somchai error note" },
                    { emp: "Somsri", type: "หยิบผิด ถึงลูกค้าแล้ว", penalty: 20, note: "Somsri error note" }
                ],
                workload: [
                    { employee: "Somchai", outbound: 4, inbound: 0, transfer: 0, shared: 0, capacity: 10, note: "Somchai wl note" },
                    { employee: "Somsri", outbound: 0, inbound: 6, transfer: 0, shared: 0, capacity: 10, note: "Somsri wl note" }
                ]
            }
        ];
        
        safeStorage.setItem('kpiData_AKRA', JSON.stringify(mockKpiData));
        currentBranch = "AKRA";

        // Execute loadDashboardData
        loadDashboardData();

        // 1. Verify totals are preserved: both errors count towards totalErr
        const totalErrorsElement = document.getElementById('dash-total-errors');
        assert.strictEqual(totalErrorsElement.innerText, 2, "Historical error count must include inactive employee errors");

        // 2. Verify HP penalty preservation:
        // Total penalty: 20 (Somchai) + 20 (Somsri) = 40. HP remaining = 100 - 40 = 60%.
        // Let's assert that the HP bar contains width: 60%.
        const dashTeamKpiElement = document.getElementById('dash-team-kpi');
        assert.ok(dashTeamKpiElement.innerHTML.includes("style=\"width: 60%\"") || dashTeamKpiElement.innerHTML.includes("width: 60%"), "Branch HP bar width must reflect inactive employee penalties (60% remaining)");

        // 3. Verify notes display: only Somchai (Active) notes are rendered, Somsri (Inactive) notes are hidden
        const errorNotesHTML = document.getElementById('dash-error-notes').innerHTML;
        assert.ok(errorNotesHTML.includes("Somchai"), "Active employee errors must be in note history");
        assert.ok(!errorNotesHTML.includes("Somsri"), "Inactive employee errors must NOT be in note history");

        // 4. Verify workload totals are preserved and mathematically proven:
        // Outbound = 4, Inbound = 6. Total = 10. Outbound pct = 40%, Inbound pct = 60%.
        const dashWorkloadTeamHTML = document.getElementById('dash-workload-team').innerHTML;
        assert.ok(dashWorkloadTeamHTML.includes("ขาออก 40%"), "Team workload total must include inactive employee workloads (proven 40% outbound)");
        assert.ok(dashWorkloadTeamHTML.includes("ขาเข้า 60%"), "Team workload total must include inactive employee workloads (proven 60% inbound)");

        // 5. Verify workload individuals display: only Somchai is listed, Somsri is hidden
        const dashWorkloadIndHTML = document.getElementById('dash-workload-individuals').innerHTML;
        assert.ok(dashWorkloadIndHTML.includes("Somchai"), "Active employee must be in workload individuals list");
        assert.ok(!dashWorkloadIndHTML.includes("Somsri"), "Inactive employee must NOT be in workload individuals list");

        console.log("-> Test 3 Passed!");
    }

    // Test 4: loadDashboardData with ONLY inactive employee errors (Empty Error Note History fallback check)
    {
        console.log("Test 4: checking loadDashboardData handles week with ONLY inactive employee errors...");
        resetMocks();
        
        // Setup configuration
        const configList = [
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "AKRA", dept: "", gender: "F", status: "Inactive" }
        ];
        processConfigList(configList);

        // Mock historical data (week containing error ONLY for Somsri)
        const dateStr = getStartOfWeek(new Date()).toISOString().slice(0, 10);
        const mockKpiData = [
            {
                date: dateStr,
                sourceBranch: "AKRA",
                volume: { transfer: 10, pickup: 10, upcountry: 10, inmarket: 10, outmarket: 10 },
                errors: [
                    { emp: "Somsri", type: "หยิบผิด ถึงลูกค้าแล้ว", penalty: 20, note: "Somsri error note" }
                ]
            }
        ];
        
        safeStorage.setItem('kpiData_AKRA', JSON.stringify(mockKpiData));
        currentBranch = "AKRA";

        // Execute loadDashboardData
        loadDashboardData();

        // 1. Verify total errors is 1
        const totalErrorsElement = document.getElementById('dash-total-errors');
        assert.strictEqual(totalErrorsElement.innerText, 1, "Inactive error must be counted in total errors");

        // 2. Verify error note history displays the fallback placeholder instead of an empty white space
        const errorNotesHTML = document.getElementById('dash-error-notes').innerHTML;
        assert.ok(errorNotesHTML.includes("มีบันทึกข้อผิดพลาดของอดีตพนักงาน"), "Error note history must show inactive employees placeholder when only inactive errors exist");
        assert.ok(!errorNotesHTML.includes("Somsri"), "Inactive name Somsri must not be in error note history");

        console.log("-> Test 4 Passed!");
    }

    console.log("=== All Employee Inactive Filter Regression Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed: ", err);
    process.exit(1);
});
