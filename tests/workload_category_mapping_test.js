const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

async function runTests() {
  console.log('--- Testing Workload Category Mapping, 17:30 Time Window & Version Parity ---');

  const htmlPath = path.join(__dirname, '..', 'index.html');
  const versionPath = path.join(__dirname, '..', 'version.json');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

  // 1. Verify script syntax with vm.Script
  const scriptMatches = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
  assert(scriptMatches.length > 0, 'Should find inline script tags');

  scriptMatches.forEach((scriptTag, idx) => {
    const code = scriptTag.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try {
      new vm.Script(code);
    } catch (err) {
      assert.fail(`Syntax error in script tag #${idx + 1}: ${err.message}`);
    }
  });
  console.log(`✓ All ${scriptMatches.length} inline script tags successfully parsed by vm.Script.`);

  // 2. Extract and test getAkraWorkloadValues logic in VM sandbox
  function extractFunction(src, fnName) {
    const pattern = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\([^{]*?\\)\\s*\\{`);
    const match = pattern.exec(src);
    if (!match) throw new Error(`Function ${fnName} not found`);
    let depth = 0, start = match.index, end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    return src.slice(start, end);
  }

  const getAkraFn = extractFunction(html, 'getAkraWorkloadValues');
  const sandbox = {
    currentBranch: 'AKRA',
    currentUser: 'TestUser',
    displayUserName: 'TestUser',
    workloadState: { core: 'คลังหลัก W1', totalHours: 10, support: [] },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(`${getAkraFn}`, sandbox);

  // Case 1: Primary 'คลังหลัก W1' with no support -> 10h outbound, 0 shared
  sandbox.workloadState = { core: 'คลังหลัก W1', totalHours: 10, support: [] };
  let res = sandbox.getAkraWorkloadValues();
  assert.strictEqual(res[0].outbound, 10, 'คลังหลัก W1 must map to outbound');
  assert.strictEqual(res[0].shared, 0, 'shared must be 0');
  assert.strictEqual(res[0].transfer, 0, 'transfer must be 0');
  assert.strictEqual(res[0].inbound, 0, 'inbound must be 0');

  // Case 2: Primary 'คลังสำรอง W2' with no support -> 10h transfer, 0 shared
  sandbox.workloadState = { core: 'คลังสำรอง W2', totalHours: 10, support: [] };
  res = sandbox.getAkraWorkloadValues();
  assert.strictEqual(res[0].transfer, 10, 'คลังสำรอง W2 must map to transfer');
  assert.strictEqual(res[0].shared, 0, 'shared must be 0');
  assert.strictEqual(res[0].outbound, 0, 'outbound must be 0');

  // Case 3: Primary 'คลังหลัก W1' (0.5h remaining) + Support: 'คลัง W1' (5h), 'สนับสนุน TRD' (2h), 'ส่งสินค้า' (0.5h), 'คลัง W2' (2h)
  sandbox.workloadState = {
    core: 'คลังหลัก W1',
    totalHours: 10,
    support: [
      { name: 'คลัง W1', hours: 5 },
      { name: 'สนับสนุน TRD', hours: 2 },
      { name: 'ส่งสินค้า', hours: 0.5 },
      { name: 'คลัง W2', hours: 2 }
    ]
  };
  res = sandbox.getAkraWorkloadValues();
  assert.strictEqual(res[0].outbound, 8.0, 'Outbound should be 0.5 (core W1) + 5 (W1) + 2 (TRD) + 0.5 (ส่งสินค้า) = 8.0');
  assert.strictEqual(res[0].transfer, 2.0, 'Transfer should be 2.0 (W2)');
  assert.strictEqual(res[0].shared, 0.0, 'Shared should be 0');
  assert.strictEqual(res[0].inbound, 0.0, 'Inbound should be 0');

  // Case 4: Support with 'ช่วยหน้าร้าน TRD' and 'ช่วยย้ายของ W2'
  sandbox.workloadState = {
    core: 'รับสินค้าเข้า',
    totalHours: 10,
    support: [
      { name: 'ช่วยหน้าร้าน TRD', hours: 2 },
      { name: 'ช่วยย้ายของ W2', hours: 3 }
    ]
  };
  res = sandbox.getAkraWorkloadValues();
  assert.strictEqual(res[0].inbound, 5.0, 'Inbound should be 5.0 (core)');
  assert.strictEqual(res[0].outbound, 2.0, 'Outbound should be 2.0 (ช่วยหน้าร้าน TRD)');
  assert.strictEqual(res[0].transfer, 3.0, 'Transfer should be 3.0 (ช่วยย้ายของ W2)');
  assert.strictEqual(res[0].shared, 0.0, 'Shared should be 0');

  console.log('✓ All workload category mapping test cases passed.');

  // 3. Test 17:30 time window enforcement in saveWorkloadCard
  console.log('\n[3/4] Testing 17:30 time window restriction in saveWorkloadCard...');
  const saveWorkloadCardFn = extractFunction(html, 'saveWorkloadCard');
  const getKpiBangkokClockFn = extractFunction(html, 'getKpiBangkokClock');
  const getEmployeeWorkloadStatusFn = extractFunction(html, 'getEmployeeWorkloadStatus');

  let modalShown = null;
  let saveWorkloadCalled = false;

  const saveSandbox = {
    AppVersionGuard: { blockIfStale: async () => false },
    document: {
      getElementById: (id) => {
        if (id === 'record-date') return { value: '2026-09-02' };
        if (id === 'btn-save-workload') return { innerHTML: '', disabled: false };
        return null;
      }
    },
    showModal: (title, desc, type) => {
      modalShown = { title, desc, type };
    },
    showToast: (msg, isErr) => {},
    canAccessAdminSettings: (roles, token) => (Array.isArray(roles) && roles.includes('ADMIN')),
    normalizeEmpName: (name) => String(name || '').trim(),
    displayUserName: 'WorkerA',
    currentUser: 'WorkerA',
    currentRoles: ['WAREHOUSE', 'AKRA'],
    sessionToken: 'valid-token',
    currentBranch: 'AKRA',
    getAkraWorkloadValues: () => [{
      employee: 'WorkerA', capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0,
      primaryCore: 'คลังหลัก W1', supportDuties: []
    }],
    AkraSupabaseKPI: {
      saveWorkload: async () => {
        saveWorkloadCalled = true;
        return { status: 'success', workload: [] };
      }
    },
    sendAppLog: () => {},
    safeStorage: { removeItem: () => {} },
    applyWorkloadSaveResultToCache: () => {},
    renderTeamWorkloadPreview: () => {},
    syncDataFromSheet: async () => {},
    loadDashboardData: () => {},
    updateDailyDashboard: () => {},
    getKpiBangkokClock: () => ({ date: '2026-09-02', hour: 14, minute: 30 }), // 14:30 (before 17:30)
    console
  };

  saveSandbox.window = saveSandbox;
  vm.createContext(saveSandbox);
  vm.runInContext(`${saveWorkloadCardFn}; ${getEmployeeWorkloadStatusFn}`, saveSandbox);

  // Case A: Regular worker before 17:30 on current day -> BLOCKED
  saveSandbox.getKpiBangkokClock = () => ({ date: '2026-09-02', hour: 14, minute: 30 });
  saveSandbox.currentRoles = ['WAREHOUSE', 'AKRA'];
  modalShown = null;
  saveWorkloadCalled = false;
  await saveSandbox.saveWorkloadCard();
  assert(modalShown !== null, 'Modal must be shown when submitting before 17:30');
  assert.strictEqual(modalShown.title, 'ยังไม่ถึงเวลาบันทึก');
  assert.strictEqual(saveWorkloadCalled, false, 'saveWorkload must NOT be called before 17:30');
  console.log('  ✓ Worker before 17:30 is blocked with explanation modal.');

  // Case B: Regular worker at 17:30 on current day -> ALLOWED
  saveSandbox.getKpiBangkokClock = () => ({ date: '2026-09-02', hour: 17, minute: 30 });
  modalShown = null;
  saveWorkloadCalled = false;
  await saveSandbox.saveWorkloadCard();
  assert.strictEqual(modalShown, null, 'Modal should not be shown at 17:30');
  assert.strictEqual(saveWorkloadCalled, true, 'saveWorkload must be called at 17:30');
  console.log('  ✓ Worker at 17:30 is allowed to submit.');

  // Case C: Regular worker after 17:30 (e.g. 19:15) -> ALLOWED
  saveSandbox.getKpiBangkokClock = () => ({ date: '2026-09-02', hour: 19, minute: 15 });
  modalShown = null;
  saveWorkloadCalled = false;
  await saveSandbox.saveWorkloadCard();
  assert.strictEqual(modalShown, null);
  assert.strictEqual(saveWorkloadCalled, true);
  console.log('  ✓ Worker after 17:30 is allowed to submit.');

  // Case D: Supervisor / Admin submitting before 17:30 -> ALLOWED (bypass)
  saveSandbox.getKpiBangkokClock = () => ({ date: '2026-09-02', hour: 11, minute: 0 });
  saveSandbox.currentRoles = ['ADMIN'];
  modalShown = null;
  saveWorkloadCalled = false;
  await saveSandbox.saveWorkloadCard();
  assert.strictEqual(modalShown, null);
  assert.strictEqual(saveWorkloadCalled, true);
  console.log('  ✓ Admin / Supervisor can bypass 17:30 restriction.');

  // Case E: Worker submitting for yesterday (past date) -> ALLOWED
  saveSandbox.document.getElementById = (id) => {
    if (id === 'record-date') return { value: '2026-09-01' };
    if (id === 'btn-save-workload') return { innerHTML: '', disabled: false };
    return null;
  };
  saveSandbox.currentRoles = ['WAREHOUSE', 'AKRA'];
  saveSandbox.getKpiBangkokClock = () => ({ date: '2026-09-02', hour: 10, minute: 0 });
  modalShown = null;
  saveWorkloadCalled = false;
  await saveSandbox.saveWorkloadCard();
  assert.strictEqual(modalShown, null);
  assert.strictEqual(saveWorkloadCalled, true);
  console.log('  ✓ Past date submission is not blocked by 17:30 rule.');

  // Case F: Test renderSectionWorkloadAnalytics with team entries and user draft
  console.log('\n[4/5] Testing renderSectionWorkloadAnalytics team capacity calculation...');
  const renderSectionFn = extractFunction(html, 'renderSectionWorkloadAnalytics');
  const domElements = {
    'record-date': { value: '2026-09-02' },
    'wl-total-manhours-badge': { textContent: '' },
    'wl-sec-outbound-val': { textContent: '' },
    'wl-sec-outbound-bar': { style: { width: '' } },
    'wl-sec-inbound-val': { textContent: '' },
    'wl-sec-inbound-bar': { style: { width: '' } },
    'wl-sec-transfer-val': { textContent: '' },
    'wl-sec-transfer-bar': { style: { width: '' } },
    'wl-sec-shared-val': { textContent: '' },
    'wl-sec-shared-bar': { style: { width: '' } }
  };
  const secSandbox = {
    document: { getElementById: (id) => domElements[id] || null },
    currentUser: '250007',
    displayUserName: 'หมูหยอง',
    currentBranch: 'AKRA',
    GLOBAL_CONFIG_LIST: [
      { uid: '250007', name: 'หมูหยอง' },
      { uid: '260029', name: 'ปีเตอร์' },
      { uid: 'AKRA12123', name: 'TRAINEE (SORN)' }
    ],
    getAkraWorkloadValues: () => [{
      employee: 'หมูหยอง', capacity: 10, outbound: 10, inbound: 0, transfer: 0, shared: 0
    }],
    getSelectedServerDay: (date) => ({
      workload: [
        { employeeUid: '260029', employee: 'ปีเตอร์', outbound: 9, inbound: 0, transfer: 1, shared: 0 },
        { employeeUid: 'AKRA12123', employee: 'TRAINEE (SORN)', outbound: 0, inbound: 10, transfer: 0, shared: 0 }
      ]
    }),
    resolveWorkloadEmployee: (emp) => ({ uid: emp.employeeUid, name: emp.employee }),
    getTodayBangkokDateStr: () => '2026-09-02',
    console
  };
  vm.createContext(secSandbox);
  vm.runInContext(renderSectionFn, secSandbox);
  secSandbox.renderSectionWorkloadAnalytics();

  // Expected: หมูหยอง (10h out) + ปีเตอร์ (9h out, 1h trans) + SORN (10h in) = 30h total (19h out 63%, 10h in 33%, 1h trans 3%)
  assert.strictEqual(domElements['wl-total-manhours-badge'].textContent, '30.0 ชม. รวม');
  assert(domElements['wl-sec-outbound-val'].textContent.includes('19.0 ชม. (63%)'), 'Outbound should be 19.0h (63%)');
  assert(domElements['wl-sec-inbound-val'].textContent.includes('10.0 ชม. (33%)'), 'Inbound should be 10.0h (33%)');
  assert(domElements['wl-sec-transfer-val'].textContent.includes('1.0 ชม. (3%)'), 'Transfer should be 1.0h (3%)');
  console.log('  ✓ renderSectionWorkloadAnalytics successfully aggregated team capacity to 30.0h.');

  // 5. Version parity check
  console.log('\n[5/5] Checking version parity...');
  const currentVersionMatch = html.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
  assert(currentVersionMatch, 'CURRENT_VERSION must exist in index.html');
  assert.strictEqual(currentVersionMatch[1], versionJson.version, 'CURRENT_VERSION must match version.json');
  console.log(`✓ Version parity verified: ${versionJson.version}`);

  console.log('\nAll workload tests passed successfully!');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
