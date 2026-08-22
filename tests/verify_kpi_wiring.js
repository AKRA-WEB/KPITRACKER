const fs = require('fs');
const assert = require('assert');

console.log('=== VERIFYING KPITRACKER SUPABASE WIRING & VERSION PARITY ===\n');

// 1. Version Parity
const path = require('path');
const indexPath = path.join(__dirname, '../index.html');
const versionPath = path.join(__dirname, '../version.json');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const expectedVersion = "20260822.18";
assert(indexContent.includes(`const CURRENT_VERSION = "${expectedVersion}";`), `CURRENT_VERSION in index.html must be ${expectedVersion}`);
assert.strictEqual(versionJson.version, expectedVersion, `version.json must be ${expectedVersion}`);
console.log(`  [PASS] Version parity verified: ${expectedVersion}`);

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
