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
    "AKRA": { employees: [] },
    "TRD": { employees: [] }
};

// Evaluate the extracted functions
const isEmployeeActiveCode = extractFunction(htmlContent, 'isEmployeeActive');
const processConfigListCode = extractFunction(htmlContent, 'processConfigList');

// Mock dedupeConfigList
const dedupeConfigListCode = extractFunction(htmlContent, 'dedupeConfigList');
eval(dedupeConfigListCode);

eval(isEmployeeActiveCode);
eval(processConfigListCode);

// Helper to reset mocks
function resetMocks() {
    GLOBAL_CONFIG_LIST = [];
    USER_DB = {};
    TRD_DEPARTMENTS = {};
    BRANCH_CONFIG = {
        "AKRA": { employees: [] },
        "TRD": { employees: [] }
    };
}

async function runTests() {
    console.log("=== Running Employee Inactive Filter Regression Tests ===");

    // Test 1: isEmployeeActive check
    {
        console.log("Test 1: checking isEmployeeActive with active, inactive, and blank status...");
        resetMocks();
        GLOBAL_CONFIG_LIST = [
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "TRD", dept: "แคชเชียร์", gender: "F", status: "Inactive" },
            { uid: "emp3", name: "Sompong", branches: "AKRA,TRD", dept: "หน้าร้าน/ในร้าน", gender: "M" } // blank status -> defaults to Active
        ];

        assert.strictEqual(isEmployeeActive("Somchai"), true, "Active employee should be active");
        assert.strictEqual(isEmployeeActive("Somsri"), false, "Inactive employee should NOT be active");
        assert.strictEqual(isEmployeeActive("Sompong"), true, "Missing status should default to active");
        assert.strictEqual(isEmployeeActive("Unknown"), false, "Unconfigured/Unknown employee should default to inactive");
        console.log("-> Test 1 Passed!");
    }

    // Test 2: processConfigList behavior
    {
        console.log("Test 2: checking processConfigList handles status correctly...");
        resetMocks();
        const configList = [
            { uid: "250013", name: "เฉิน", branches: "AKRA,TRD", dept: "Admin", gender: "", status: "Active" },
            { uid: "emp1", name: "Somchai", branches: "AKRA", dept: "", gender: "M", status: "Active" },
            { uid: "emp2", name: "Somsri", branches: "TRD", dept: "แคชเชียร์", gender: "F", status: "Inactive" },
            { uid: "emp3", name: "Sompong", branches: "AKRA,TRD", dept: "หน้าร้าน/ในร้าน", gender: "M", status: "" } // Blank/Legacy
        ];

        processConfigList(configList);

        // Verify that Admin ( เฉิน ) is in USER_DB but not in BRANCH_CONFIG employees list
        assert.ok(USER_DB["250013"], "Admin user must be in USER_DB");
        assert.ok(!BRANCH_CONFIG["AKRA"].employees.includes("เฉิน"), "Admin must not be in AKRA employees list");

        // Verify Active employee ( Somchai )
        assert.ok(BRANCH_CONFIG["AKRA"].employees.includes("Somchai"), "Active employee must be in AKRA employees list");

        // Verify Inactive employee ( Somsri )
        assert.ok(!BRANCH_CONFIG["TRD"].employees.includes("Somsri"), "Inactive employee must not be in TRD employees list");
        assert.ok(!TRD_DEPARTMENTS["แคชเชียร์"] || !TRD_DEPARTMENTS["แคชเชียร์"].includes("Somsri"), "Inactive employee must not be in TRD_DEPARTMENTS");

        // Verify Legacy blank status employee ( Sompong )
        assert.ok(BRANCH_CONFIG["AKRA"].employees.includes("Sompong"), "Blank status employee must default to Active and be in AKRA");
        assert.ok(BRANCH_CONFIG["TRD"].employees.includes("Sompong"), "Blank status employee must default to Active and be in TRD");
        assert.ok(TRD_DEPARTMENTS["หน้าร้าน/ในร้าน"].includes("Sompong"), "Blank status employee must default to Active and be in TRD_DEPARTMENTS");

        console.log("-> Test 2 Passed!");
    }

    console.log("=== All Employee Inactive Filter Regression Tests Passed! ===");
}

runTests().catch(err => {
    console.error("Test failed: ", err);
    process.exit(1);
});
