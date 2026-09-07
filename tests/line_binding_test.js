const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runTests() {
  console.log('--- Testing LINE Account Binding (Migration, RPCs, Edge API & UI) ---\n');

  // 1. Check index.html syntax and script parsing
  console.log('[1/4] Checking index.html and parsing script tags...');
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));

  const scriptMatches = html.match(/<script[\s\S]*?<\/script>/gi) || [];
  for (let i = 0; i < scriptMatches.length; i++) {
    const rawTag = scriptMatches[i];
    if (rawTag.includes('src=')) continue;
    const scriptContent = rawTag.replace(/^<script[\s\S]*?>/i, '').replace(/<\/script>$/i, '');
    try {
      new vm.Script(scriptContent);
    } catch (e) {
      assert.fail(`Syntax error in script tag #${i}: ${e.message}`);
    }
  }
  console.log(`✓ All inline script tags successfully parsed by vm.Script.`);

  // 2. Test supabase-kpi-client methods
  console.log('\n[2/4] Testing supabase-kpi-client.js LINE methods...');
  const clientPath = path.join(__dirname, '..', 'js', 'supabase-kpi-client.js');
  const client = require(clientPath);

  assert(client, 'AkraSupabaseKPI client must be exported');
  assert.strictEqual(typeof client.bindLineAccount, 'function', 'bindLineAccount must exist');
  assert.strictEqual(typeof client.unbindLineAccount, 'function', 'unbindLineAccount must exist');

  // Mock global fetch for testing
  let mockActions = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    mockActions.push(body);
    if (body.action === 'bindLineAccount') {
      if (!body.lineUserId) return { ok: false, json: async () => ({ status: 'error', reason: 'invalid_line_user_id' }) };
      return { ok: true, json: async () => ({ status: 'success', lineUserId: body.lineUserId, lineDisplayName: body.lineDisplayName }) };
    }
    if (body.action === 'unbindLineAccount') {
      return { ok: true, json: async () => ({ status: 'success' }) };
    }
    return { ok: true, json: async () => ({ status: 'success' }) };
  };

  const bindRes = await client.bindLineAccount('test-token', 'U4af4980629c4bc15610852026759c99', 'Peter_Akra');
  assert.strictEqual(bindRes.status, 'success');
  assert.strictEqual(bindRes.lineUserId, 'U4af4980629c4bc15610852026759c99');
  assert.strictEqual(bindRes.lineDisplayName, 'Peter_Akra');

  const unbindRes = await client.unbindLineAccount('test-token');
  assert.strictEqual(unbindRes.status, 'success');
  console.log('✓ supabase-kpi-client LINE methods verified.');

  // 3. Test UI state rendering in renderMyProfileView (Read-only status card)
  console.log('\n[3/4] Testing UI rendering in renderMyProfileView...');
  const dom = {
    'my-profile-name': { textContent: '' },
    'my-profile-branch-badge': { textContent: '' },
    'my-profile-dept-badge': { textContent: '' },
    'my-profile-roles': { textContent: '' },
    'my-profile-month-input': { value: '' },
    'my-profile-line-status-badge': { textContent: '', className: '', innerHTML: '' },
    'my-profile-line-desc': { textContent: '', innerHTML: '' },
    'my-profile-line-status-icon': { className: '' },
    'my-profile-quality-score': { textContent: '' },
    'my-profile-good-catch-count': { textContent: '' },
    'my-profile-safe-streak': { textContent: '' },
    'my-profile-total-hours-badge': { textContent: '' },
    'my-profile-multi-skill-badge': { classList: { add: () => {}, remove: () => {} } },
    'my-profile-skills-grid': { innerHTML: '' },
    'my-profile-certified-count': { textContent: '' }
  };

  // Helper function to extract renderMyProfileView from index.html
  const renderFnMatch = html.match(/function\s+renderMyProfileView\s*\([\s\S]*?\n\s{8}\}/);
  assert(renderFnMatch, 'renderMyProfileView function must exist');

  const uiSandbox = {
    document: { getElementById: (id) => dom[id] || null },
    currentBranch: 'AKRA',
    esc: (s) => String(s || ''),
    MY_PROFILE_DATA: null,
    console
  };
  vm.createContext(uiSandbox);
  vm.runInContext(renderFnMatch[0], uiSandbox);

  // Case A: Unlinked profile -> shows unlinked badge and directs to Main Menu
  uiSandbox.renderMyProfileView({
    name: 'น้องใหม่',
    lineUserId: null,
    lineDisplayName: null,
    workloadStats: {},
    roadmap: []
  });
  assert(dom['my-profile-line-status-badge'].textContent.includes('ยังไม่เชื่อมต่อ'));
  assert(dom['my-profile-line-desc'].textContent.includes('จัดการการผูกบัญชี LINE ได้ที่เมนูหลัก (Main Menu)'));
  assert(dom['my-profile-line-status-icon'].className.includes('text-[#06C755]'));

  // Case B: Linked profile -> shows linked badge and LINE display name with UID snippet
  uiSandbox.renderMyProfileView({
    name: 'หมูหยอง',
    lineUserId: 'U1234567890abcdef',
    lineDisplayName: 'MooYong_Warehouse',
    workloadStats: {},
    roadmap: []
  });
  assert(dom['my-profile-line-status-badge'].innerHTML.includes('เชื่อมต่อแล้ว'));
  assert(dom['my-profile-line-desc'].innerHTML.includes('MooYong_Warehouse'), 'Must display linked LINE name');
  assert(dom['my-profile-line-status-icon'].className.includes('bg-emerald-500'));
  console.log('✓ renderMyProfileView correctly updates read-only LINE status card states.');

  function extractFunction(code, name) {
    const declMatch = code.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
    if (!declMatch) return null;
    const start = declMatch.index;
    const braceStart = code.indexOf('{', start);
    if (braceStart === -1) return null;
    let depth = 1;
    let pos = braceStart + 1;
    while (pos < code.length && depth > 0) {
      if (code[pos] === '{') depth++;
      else if (code[pos] === '}') depth--;
      pos++;
    }
    return code.slice(start, pos);
  }

  // 3b. Verify strict auto-rebind purge and Quick Workload LIFF retention
  console.log('\n[3b/4] Verifying auto-rebind purge and Quick Workload retention...');
  assert.strictEqual(extractFunction(html, 'autoCheckLiffBinding'), null, 'autoCheckLiffBinding must be completely removed');
  assert.strictEqual(extractFunction(html, 'connectLineOneTap'), null, 'connectLineOneTap must be removed from KPITracker');
  assert.strictEqual(extractFunction(html, 'openLineBindingModal'), null, 'openLineBindingModal must be removed');
  assert(!html.includes('id="line-binding-modal"'), 'line-binding-modal markup must be removed');
  assert(!html.includes('autoCheckLiffBinding()'), 'Zero calls to autoCheckLiffBinding should remain in index.html');

  // Verify Quick Workload LIFF is retained
  assert(html.includes('window.KPI_LIFF_ID = KPI_LIFF_ID;'), 'window.KPI_LIFF_ID must be retained');
  assert(html.includes('id="quick-workload-modal"'), 'quick-workload-modal must be retained');
  assert(extractFunction(html, 'openQuickWorkloadModal') !== null, 'openQuickWorkloadModal function must be retained');
  console.log('✓ autoCheckLiffBinding purged; Quick Workload LIFF correctly retained.');

  // 4. Version parity check
  console.log('\n[4/4] Checking version parity...');
  const currentVersionMatch = html.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
  assert(currentVersionMatch, 'CURRENT_VERSION must exist in index.html');
  assert.strictEqual(currentVersionMatch[1], versionJson.version, 'CURRENT_VERSION must match version.json');
  assert.strictEqual(currentVersionMatch[1], '20260907.01', 'Version must be 20260907.01');
  console.log(`✓ Version parity verified: ${versionJson.version}`);

  console.log('\nAll LINE binding tests passed successfully!');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
