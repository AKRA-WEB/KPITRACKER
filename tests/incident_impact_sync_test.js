/**
 * Test Suite for Plan 20260909-002:
 * 1. Syntax compilation of modified inline <script> and js/incident-impact.js with node:vm.
 * 2. Version parity check (CURRENT_VERSION in index.html === version.json).
 * 3. Dynamic metrics rendering matching branch's configured impacts (no hardcoded boxes for deleted impacts).
 * 4. Custom impact (e.g. "ถึงลูกค้าแล้ว") visual theme and metrics counting.
 * 5. Impact deletion persistence & local cache sync without bounce back.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// --- 1. Syntax Checks ---
const incidentJs = fs.readFileSync(path.join(__dirname, '../js/incident-impact.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(incidentJs), 'js/incident-impact.js must compile with zero syntax errors');

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let scriptMatch;
let scriptCount = 0;
while ((scriptMatch = scriptRegex.exec(indexHtml)) !== null) {
  const code = scriptMatch[1];
  if (!code.trim()) continue;
  scriptCount++;
  assert.doesNotThrow(() => new vm.Script(code), `Inline script #${scriptCount} must compile with zero syntax errors`);
}
assert.ok(scriptCount >= 1, 'At least one inline script must be verified');

// --- 2. Version Parity ---
const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8'));
const htmlVerMatch = indexHtml.match(/const CURRENT_VERSION = ['"]([^'"]+)['"]/);
assert.ok(htmlVerMatch, 'CURRENT_VERSION must exist in index.html');
assert.strictEqual(htmlVerMatch[1], versionJson.version, 'CURRENT_VERSION in index.html must equal version.json');
assert.strictEqual(versionJson.version, '20260909.02', 'Target version must be 20260909.02');

// --- 3. Dynamic Metrics & Custom Impact Verification ---
function createSandbox(initialModel, branch = 'AKRA') {
  const store = new Map();
  const domElements = new Map();
  function getEl(id) {
    if (!domElements.has(id)) domElements.set(id, { id, innerHTML: '', textContent: '', value: '', classList: { add: () => {}, remove: () => {}, toggle: () => {} } });
    return domElements.get(id);
  }
  const sandbox = {
    console,
    window: null,
    document: {
      getElementById: getEl,
      querySelectorAll: () => []
    },
    currentBranch: branch,
    KPI_SYSTEM_CONFIG: { incidentModel: initialModel },
    recordedErrorCases: [],
    getIncidentCategoryLabel: () => 'หมวด',
    safeStorage: {
      getItem: k => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v))
    },
    formatDateKeyLocal: d => d.toISOString().slice(0, 10),
    normalizeClientDateKey: d => d,
    sessionToken: 'test-token',
    AkraSupabaseKPI: {
      saveIncidentCatalog: async (token, configValue) => ({
        status: 'success',
        configValue: JSON.parse(JSON.stringify(configValue))
      })
    },
    ADMIN_SETTINGS_STATE: {
      incidentBranch: branch
    },
    showToast: () => {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(incidentJs, sandbox);
  return { sandbox, store, domElements };
}

// Case A: Branch AKRA with 2 configured impacts: 'contained' (แก้ไขทันก่อนส่ง) and 'impact_custom_1' (ถึงลูกค้าแล้ว)
const prodModel = {
  schemaVersion: 3,
  active: true,
  catalogRevision: 9,
  branches: {
    AKRA: {
      categories: [{ key: 'outbound', label: 'ขาออก & จัดส่ง' }],
      impacts: [
        { id: 'contained', label: 'แก้ไขทันก่อนส่ง' },
        { id: 'impact_custom_1', label: 'ถึงลูกค้าแล้ว' }
      ],
      types: [
        { id: 't1', name: 'จัดสินค้าผิด', category: 'outbound', active: true, quick: true, impacts: ['contained', 'impact_custom_1'] }
      ]
    },
    TRD: {
      categories: [{ key: 'cashier', label: 'แคชเชียร์' }],
      impacts: [
        { id: 'contained', label: 'แก้ไขทันก่อนส่ง' }
      ],
      types: [
        { id: 't2', name: 'คิดเงินผิด', category: 'cashier', active: true, quick: true, impacts: ['contained'] }
      ]
    }
  }
};

const { sandbox: sbA, store: storeA } = createSandbox(JSON.parse(JSON.stringify(prodModel)), 'AKRA');

// 3.1 summarize test: must initialize and count configured impacts + custom impacts
const testCases = [
  { schemaVersion: 3, scoringMode: 'none', caseId: 'c1', branch: 'AKRA', impact: 'contained' },
  { schemaVersion: 3, scoringMode: 'none', caseId: 'c2', branch: 'AKRA', impact: 'contained' },
  { schemaVersion: 3, scoringMode: 'none', caseId: 'c3', branch: 'AKRA', impact: 'impact_custom_1' }
];

const summaryA = sbA.KpiIncident.summarize(testCases);
assert.strictEqual(summaryA.total, 3, 'Total weekly count must be 3');
assert.strictEqual(summaryA.impact.contained, 2, 'Contained count must be 2');
assert.strictEqual(summaryA.impact.impact_custom_1, 1, 'Custom impact count must be 1');

// 3.2 metrics HTML: must NOT contain hardcoded boxes for deleted impacts
const metricsHtmlA = sbA.KpiIncident.metrics(testCases);
assert.ok(metricsHtmlA.includes('แก้ไขทันก่อนส่ง'), 'Metrics must render configured contained label');
assert.ok(metricsHtmlA.includes('ถึงลูกค้าแล้ว'), 'Metrics must render configured custom impact label');
assert.ok(!metricsHtmlA.includes('กระทบภายใน'), 'Deleted impact (กระทบภายใน) must NOT appear in metrics');
assert.ok(!metricsHtmlA.includes('ยังไม่ทราบ'), 'Deleted impact (ยังไม่ทราบ) must NOT appear in metrics');
assert.ok(!metricsHtmlA.includes('ไม่เกี่ยวกับขั้นตอนส่งมอบ'), 'Deleted impact (ไม่เกี่ยวกับขั้นตอนส่งมอบ) must NOT appear in metrics');

// 3.3 Smart visual impact resolution for custom impact
const visualCustom = sbA.KpiIncident.visualImpact('impact_custom_1');
assert.strictEqual(visualCustom.badge, 'ถึงลูกค้าแล้ว', 'Badge text must match custom impact label');
assert.ok(visualCustom.icon === 'fa-triangle-exclamation', 'Impact containing "ลูกค้า" must receive warning icon');
assert.ok(visualCustom.metricBg.includes('rose'), 'Impact containing "ลูกค้า" must receive rose theme');

// 3.4 Timeline rendering for custom impact
const testTimelineRow = {
  schemaVersion: 3,
  scoringMode: 'none',
  caseId: 'c3',
  recordDate: '2026-09-08',
  type: 'จัดสินค้าผิด',
  impact: 'impact_custom_1',
  worker: 'สมชาย'
};
// timeline() calls weekCases()
storeA.set('kpiData_AKRA', JSON.stringify([{ date: '2026-09-08', incidentCases: [testTimelineRow] }]));
sbA.document.getElementById('record-date-error').value = '2026-09-08';
sbA.KpiIncident.timeline();
const timelineHtml = sbA.document.getElementById('pc-err-timeline').innerHTML;
assert.ok(timelineHtml.includes('ถึงลูกค้าแล้ว'), 'Timeline card must render custom impact label');
assert.ok(!timelineHtml.includes('ข้อมูลเดิม'), 'New custom impact must NOT fall back to "ข้อมูลเดิม"');

// --- 4. Admin Impact Deletion Persistence & LocalStorage Sync ---
const { sandbox: sbAdmin, store: storeAdmin } = createSandbox(JSON.parse(JSON.stringify(prodModel)), 'AKRA');
// Pre-populate kpi_cached_config in localStorage
storeAdmin.set('kpi_cached_config', JSON.stringify({
  systemConfig: { incidentModel: JSON.parse(JSON.stringify(prodModel)) }
}));

// Open admin view
sbAdmin.KpiIncident.admin();
// Delete 'contained'
sbAdmin.KpiIncident.adminDeleteImpact('contained');
// Save
sbAdmin.KpiIncident.adminSave().then(() => {
  // Check in-memory model updated
  const updatedImpacts = sbAdmin.KPI_SYSTEM_CONFIG.incidentModel.branches.AKRA.impacts;
  assert.strictEqual(updatedImpacts.length, 1, 'AKRA should only have 1 impact remaining');
  assert.strictEqual(updatedImpacts[0].id, 'impact_custom_1', 'Remaining impact must be custom_1');
  assert.ok(!updatedImpacts.some(i => i.id === 'contained'), 'Contained must be deleted');

  // Check localStorage cachedConfig was synchronized
  const cached = JSON.parse(storeAdmin.get('kpi_cached_config'));
  assert.strictEqual(cached.systemConfig.incidentModel.branches.AKRA.impacts.length, 1, 'Cached incidentModel must be updated');
  assert.strictEqual(cached.systemConfig.incidentModel.branches.AKRA.impacts[0].id, 'impact_custom_1');

  // Check metrics() after delete does not show 'contained'
  const metricsAfterDelete = sbAdmin.KpiIncident.metrics([]);
  assert.ok(!metricsAfterDelete.includes('แก้ไขทันก่อนส่ง'), 'Deleted impact must no longer show in metrics');
  assert.ok(metricsAfterDelete.includes('ถึงลูกค้าแล้ว'), 'Remaining impact must show in metrics');

  console.log('PASS: All unit, visual, and integration assertions satisfied.');
}).catch(err => {
  console.error('FAIL in adminSave test:', err);
  process.exit(1);
});
