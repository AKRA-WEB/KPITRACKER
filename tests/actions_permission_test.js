const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const backendPath = path.join(__dirname, '../Code.gs.txt');

if (fs.existsSync(backendPath)) {
    const backend = fs.readFileSync(backendPath, 'utf8');
    assert.match(backend, /if \(action === "saveAction"\) \{[\s\S]*?requireAuth\(token\)/,
        'saveAction must continue to require Main SSO authentication');
    assert.doesNotMatch(backend, /function hasAdminDashboardAccess\(/,
        'Action mutations must not retain the adminDashboard helper');
    assert.doesNotMatch(backend, /if \(!hasAdminDashboardAccess\(user\)\)/,
        'saveAction must allow every authenticated KPITracker user');
}
assert.doesNotMatch(html, /\$\{can\('adminDashboard'\) \? `[\s\S]*?openActionModalForEdit/,
    'Dashboard Action edit control must be visible to every signed-in user');
assert.doesNotMatch(html, /บัญชีนี้ไม่มีสิทธิ์ adminDashboard สำหรับดูและจัดการ Action Items/,
    'Action loading must not present an obsolete adminDashboard restriction');
assert.match(html, /รหัสวินิจฉัย: no_token/,
    'Action loading must distinguish a missing token');
assert.match(html, /รหัสวินิจฉัย: invalid_or_expired_token/,
    'Action loading must distinguish a rejected token');
assert.match(html, /รหัสวินิจฉัย: verify_failed/,
    'Action loading must distinguish a backend verification failure');

console.log('Action permission regression checks passed.');
