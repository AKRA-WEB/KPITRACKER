const fs = require('fs');
const assert = require('assert');
const vm = require('node:vm');

console.log('=== VERIFYING KPITRACKER VERSION PARITY & SCRIPT SYNTAX ===\n');

// 1. Version Parity
const path = require('path');
const indexPath = path.join(__dirname, '../index.html');
const versionPath = path.join(__dirname, '../version.json');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const expectedVersion = "20260823.03";
assert(indexContent.includes(`const CURRENT_VERSION = "${expectedVersion}";`), `CURRENT_VERSION in index.html must be ${expectedVersion}`);
assert.strictEqual(versionJson.version, expectedVersion, `version.json must be ${expectedVersion}`);
console.log(`  [PASS] Version parity verified: ${expectedVersion}`);

// 2. Compile every inline script block. Runtime behavior is covered by focused suites.
const inlineScripts = Array.from(indexContent.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
assert(inlineScripts.length > 0, 'Expected at least one inline script block');
inlineScripts.forEach((match, index) => {
  new vm.Script(match[1], { filename: `${indexPath}#inline-script-${index + 1}` });
});
console.log(`  [PASS] ${inlineScripts.length} inline script block(s) compiled with zero syntax errors`);

console.log('\n🌟 KPITRACKER VERSION & SYNTAX VERIFICATION PASSED 100%! 🌟');
