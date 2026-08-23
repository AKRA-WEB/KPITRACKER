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

  // 4. Employee Roster and Config Query should resolve with SORN
  console.log('\n[4/5] Testing getConfig returns array including SORN...');
  const result = await kpiClient.getConfig();
  assert(Array.isArray(result), 'Result should be an array');
  assert(result.length > 0, 'Result should have at least one employee');
  assert(result.some(e => e.name === 'SORN'), 'SORN should be in the returned array');
  console.log(`  -> getConfig returned ${result.length} employees including SORN`);

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
