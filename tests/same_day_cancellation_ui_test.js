const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const versionJsonPath = path.join(__dirname, '..', 'version.json');
const clientJsPath = path.join(__dirname, '..', 'js', 'supabase-kpi-client.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
const clientJsContent = fs.readFileSync(clientJsPath, 'utf8');

// 1. Verify Version Parity
assert.strictEqual(versionJson.version, '20260831.03', 'version.json must be 20260831.03');
assert.ok(htmlContent.includes(`const CURRENT_VERSION = "${versionJson.version}";`), 'index.html must have CURRENT_VERSION matching version.json');
assert.ok(htmlContent.includes(`KPI Suite v${versionJson.version}`), 'index.html drawer must show KPI Suite matching version.json');
assert.ok(htmlContent.includes(`supabase-kpi-client.js?v=${versionJson.version}`), 'index.html script tag must match version.json');

// 2. Verify HTML Buttons
assert.ok(htmlContent.includes('id="btn-clear-workload"'), 'Workload HTML must include btn-clear-workload');
assert.ok(htmlContent.includes('onclick="clearWorkloadCard()"'), 'btn-clear-workload must call clearWorkloadCard()');

// 3. Verify Client Library Methods
assert.ok(clientJsContent.includes('deleteIncident:'), 'supabase-kpi-client.js must export deleteIncident');
assert.ok(clientJsContent.includes('clearWorkload:'), 'supabase-kpi-client.js must export clearWorkload');

// 4. Parse and Compile index.html Script
const scriptMatches = [...htmlContent.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scriptMatches.length > 0, 'index.html must contain inline scripts');

scriptMatches.forEach((match, idx) => {
  const code = match[1];
  try {
    new vm.Script(code, { filename: `index.html#script[${idx}]` });
  } catch (err) {
    assert.fail(`Syntax error in index.html script block ${idx}: ${err.message}`);
  }
});

// 5. Test Functions Behavior via VM Context
const lastScript = scriptMatches[scriptMatches.length - 1][1];

let confirmResult = true;
let toastMsg = '';
let modalArgs = null;
let clientCalls = [];
let mockDates = { 'record-date-error': '2026-08-25', 'record-date': '2026-08-25' };

const sandbox = {
  console,
  URLSearchParams,
  location: { search: '', hash: '', pathname: '/' },
  setTimeout,
  clearTimeout,
  document: {
    getElementById: id => {
      const el = {
        id,
        value: mockDates[id] !== undefined ? mockDates[id] : '',
        className: '',
        style: {},
        innerHTML: '',
        textContent: '',
        innerText: '',
        disabled: false,
        classList: { add: () => {}, remove: () => {}, contains: () => false, replace: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: () => ({ className: '', style: {} }),
        closest: () => null
      };
      return el;
    },
    querySelectorAll: () => [],
    querySelector: () => ({ className: '', style: {} }),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  window: {},
  getTodayBangkokDateStr: () => '2026-08-25',
  getTodayStr: () => '2026-08-25',
  localStorage: {
    getItem: k => (k === 'akra_sso_token' ? 'test-token' : null),
    setItem: () => {},
    removeItem: () => {}
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: msg => confirmResult,
  showToast: (msg, isErr) => { toastMsg = msg; },
  showModal: (title, desc, type) => { modalArgs = { title, desc, type }; },
  AppVersionGuard: { blockIfStale: async () => false },
  loadDashboardData: () => {},
  updateDailyDashboard: () => {},
  syncDataFromSheet: async () => {},
  renderAkraWorkloadEditor: () => {},
  renderErrTimeline: () => {},
  renderErrTeamHp: () => {},
  applyIncidentSaveResultToCache: () => {}
};

sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

sandbox.AkraSupabaseKPI = {
  deleteIncident: async (token, branch, date, caseId) => {
    clientCalls.push({ action: 'deleteIncident', token, branch, date, caseId });
    return { status: 'success', incidents: [], zeroConfirmed: false };
  },
  clearWorkload: async (token, user, date) => {
    clientCalls.push({ action: 'clearWorkload', token, user, date });
    return { status: 'success', workload: [] };
  }
};

const context = vm.createContext(sandbox);
vm.runInContext(lastScript, context);

(async () => {
  context.currentUser = '250007';
  context.currentBranch = 'AKRA';
  context.loadDashboardData = () => {};
  context.syncDataFromSheet = async () => {};
  context.showModal = (title, msg) => { modalArgs = { title, msg }; };

  // Assert deleteErrorCase and clearWorkloadCard functions exist
  assert.strictEqual(typeof context.deleteErrorCase, 'function');
  assert.strictEqual(typeof context.clearWorkloadCard, 'function');

  const todayStr = context.getTodayBangkokDateStr();
  const yesterdayStr = '2020-01-01';

  // Test successful same-day deleteErrorCase
  mockDates['record-date-error'] = todayStr;
  await context.deleteErrorCase(`ERR-${todayStr}-12345`);
  assert.strictEqual(clientCalls.length, 1);
  assert.strictEqual(clientCalls[0].action, 'deleteIncident');
  assert.strictEqual(clientCalls[0].caseId, `ERR-${todayStr}-12345`);

  // Test past date rejection on deleteErrorCase
  mockDates['record-date-error'] = yesterdayStr;
  modalArgs = null;
  await context.deleteErrorCase(`ERR-${yesterdayStr}-12345`);
  assert.strictEqual(clientCalls.length, 1, 'past-date deleteIncident must NOT call client API');
  assert.ok(modalArgs && modalArgs.title.includes('ไม่สามารถยกเลิกได้'));

  // Test successful same-day clearWorkloadCard
  mockDates['record-date'] = todayStr;
  clientCalls = [];
  await context.clearWorkloadCard();
  assert.strictEqual(clientCalls.length, 1);
  assert.strictEqual(clientCalls[0].action, 'clearWorkload');

  // Test past date rejection on clearWorkloadCard
  mockDates['record-date'] = yesterdayStr;
  modalArgs = null;
  await context.clearWorkloadCard();
  assert.strictEqual(clientCalls.length, 1, 'past-date clearWorkload must NOT call client API');
  assert.ok(modalArgs && modalArgs.title.includes('ไม่สามารถล้างข้อมูลได้'));

  console.log('PASS: same_day_cancellation_ui_test passed 100%!');
})();
