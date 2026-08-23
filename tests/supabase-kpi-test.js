const assert = require('assert');
const kpiClient = require('../js/supabase-kpi-client.js');

async function runTests() {
  console.log('=== TESTING KPITRACKER SUPABASE API CLIENT CONTAINMENT & FALLBACK ===\n');

  // 1. Daily Record Upsert with JSONB should throw containment error
  console.log('[1/5] Testing Daily Record Upsert throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.saveDailyRecord({ branch: 'AKRA' }); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> saveDailyRecord correctly deactivated with fallback notice');

  // 2. Weekly Records should throw containment error
  console.log('\n[2/5] Testing Weekly Records query throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.getWeeklyRecords('AKRA', '2026-08-17', '2026-08-23'); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> getWeeklyRecords correctly deactivated with fallback notice');

  // 3. fetchBranchData Query should throw containment error
  console.log('\n[3/5] Testing fetchBranchData throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.fetchBranchData('AKRA', 6); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> fetchBranchData correctly deactivated with fallback notice');

  // 4. Employee roster/config must use the authenticated Edge boundary.
  console.log('\n[4/5] Testing authenticated getConfig Edge request...');
  const originalFetch = global.fetch;
  let capturedRequest;
  global.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return {
      ok: true,
      json: async () => ({
        status: 'success',
        employees: [{ uid: 'TRAINEE_SORN', name: 'SORN', roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Active' }],
        workload: { date: '2026-08-23', hour: 18, recordedEmployees: [] }
      })
    };
  };
  const result = await kpiClient.getConfig('signed-main-token');
  assert.strictEqual(result.employees[0].name, 'SORN');
  assert.ok(capturedRequest.url.endsWith('/functions/v1/kpi-api'));
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), { action: 'getConfig', token: 'signed-main-token' });
  await kpiClient.getAdminStatus('signed-main-token');
  assert.deepStrictEqual(JSON.parse(capturedRequest.init.body), { action: 'getAdminStatus', token: 'signed-main-token' });
  global.fetch = originalFetch;
  await assert.rejects(() => kpiClient.getConfig(''), /authenticated Main session/);
  console.log('  -> getConfig used the signed Main token and returned the Edge response');

  // 5. Executive Action Center should throw containment error
  console.log('\n[5/5] Testing saveAction throws containment error...');
  await assert.rejects(
    async () => { await kpiClient.saveAction({ branch: 'AKRA' }); },
    /Supabase KPI client deactivated/
  );
  console.log('  -> saveAction correctly deactivated with fallback notice');

  console.log('\n🌟 ALL KPITRACKER SUPABASE CONTAINMENT & FALLBACK TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
