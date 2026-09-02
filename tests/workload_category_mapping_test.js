const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('--- Testing Workload Category Mapping & Version Parity ---');

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
  const pattern = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
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

// 3. Version parity check
const currentVersionMatch = html.match(/const\s+CURRENT_VERSION\s*=\s*["']([^"']+)["']/);
assert(currentVersionMatch, 'CURRENT_VERSION must exist in index.html');
assert.strictEqual(currentVersionMatch[1], versionJson.version, 'CURRENT_VERSION must match version.json');
console.log(`✓ Version parity verified: ${versionJson.version}`);

console.log('All tests passed successfully!');
