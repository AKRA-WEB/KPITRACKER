const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../js/kpi-lite-phase1.js'), 'utf8');
const preview = fs.readFileSync(path.join(__dirname, '../kpi-lite-preview.html'), 'utf8');

assert.match(source, /buildDailyDashboardErrorState/,
    'KPI Lite must derive the dashboard error state from the explicit error-state helper');
assert.match(source, /explicitErrors\.assumedZero\s*=\s*false/,
    'KPI Lite must never convert an unconfirmed missing error state into assumed zero');
assert.match(source, /explicitErrors\.state\s*===\s*'missing'/,
    'KPI Lite must mark completeness false when error confirmation is missing');
assert.doesNotMatch(source, /assumedZero\s*=\s*true/,
    'KPI Lite must not create an assumed-zero error state');

for (const key of ['outbound', 'inbound', 'transfer', 'shared']) {
    assert.ok(source.includes(`['${key}'`) || source.includes(`${key}:`),
        `KPI Lite quick fill must support ${key}`);
}
assert.match(source, /const capacity = 10/,
    'Quick fill should preserve the current 10-point full-day model');
assert.match(source, /validateRowTotal/,
    'Quick fill must reuse existing workload validation');
assert.match(preview, /AkraKpiLite\.install\(frame\.contentWindow\)/,
    'Preview must install the compatibility layer into the existing application');

console.log('KPI Lite Phase 1 regression checks passed.');
