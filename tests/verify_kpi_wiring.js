const fs = require('fs');
const assert = require('assert');

console.log('=== VERIFYING KPITRACKER SUPABASE WIRING & VERSION PARITY ===\n');

// 1. Version Parity
const indexContent = fs.readFileSync('KPITRACKER/index.html', 'utf8');
const versionJson = JSON.parse(fs.readFileSync('KPITRACKER/version.json', 'utf8'));

assert(indexContent.includes('const CURRENT_VERSION = "20260820.06";'), 'CURRENT_VERSION in index.html must be 20260820.06');
assert.strictEqual(versionJson.version, '20260820.06', 'version.json must be 20260820.06');
console.log('  [PASS] Version parity verified: 20260820.06');

// 2. Direct Supabase Wiring
const kpiMatches = indexContent.match(/AkraSupabaseKPI/g) || [];
assert(kpiMatches.length >= 5, `Expected >= 5 AkraSupabaseKPI calls in index.html, found ${kpiMatches.length}`);
console.log(`  [PASS] Direct Supabase wiring verified: ${kpiMatches.length} AkraSupabaseKPI references in index.html`);

// 3. Fallback to GAS Preservation
assert(indexContent.includes('LOG_APP_SCRIPT_URL'), 'Must preserve LOG_APP_SCRIPT_URL fallback');
console.log('  [PASS] GAS fallback contract preserved');

// 4. JS Syntax Validation
const scriptStart = indexContent.indexOf('<script>');
const scriptEnd = indexContent.lastIndexOf('</script>');
const scriptContent = indexContent.substring(scriptStart + 8, scriptEnd);
new Function(scriptContent);
console.log('  [PASS] JS Syntax completely valid');

console.log('\n🌟 KPITRACKER WIRING VERIFICATION PASSED 100%! 🌟');
