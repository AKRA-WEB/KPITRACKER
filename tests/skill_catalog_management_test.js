const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Load Playwright for true headless browser testing
const { chromium } = require(path.join(__dirname, '..', '..', 'SOP', 'node_modules', 'playwright-core'));

const indexPath = path.resolve(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

const mockJwtSecret = '0000000000000000000000000000000000000000000000000000000000000000';

function makeToken(username, name, roles = ['ADMIN', 'AKRA']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: username,
    username,
    name,
    roles,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', Buffer.from(mockJwtSecret, 'hex'))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

(async () => {
  console.log('=== RUNNING SKILL CATALOG CRUD & ADMIN MANAGEMENT COMPREHENSIVE TESTS ===\n');

  // 1. Start local HTTP server
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (parsedUrl.pathname === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: '20260826.06' }));
    }
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } else if (parsedUrl.pathname.startsWith('/js/')) {
      const filePath = path.join(__dirname, '..', parsedUrl.pathname);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(fs.readFileSync(filePath, 'utf8'));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[1/6] Local HTTP server running on ${baseUrl}`);

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (_e) {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch (_e2) {
      browser = await chromium.launch({ headless: true });
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  const adminToken = makeToken('admin_01', 'ผู้ดูแลระบบ', ['ADMIN', 'AKRA']);

  await page.route('https://script.google.com/macros/s/**', route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'verifyToken') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, user: { id: 'admin_01', name: 'ผู้ดูแลระบบ', roles: ['ADMIN', 'AKRA'] } })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  let skillCatalog = [
    { code: 'FORKLIFT', name: 'ขับรถยก / โฟล์คลิฟต์', category: 'warehouse', icon: 'fa-truck-ramp-box', description: 'ขับขี่รถยก', levels: ['Lv1', 'Lv2', 'Lv3'], isActive: true },
    { code: 'PICK_W1', name: 'จัดและแพ็กสินค้า W1', category: 'warehouse', icon: 'fa-boxes-packing', description: 'แพ็กของ W1', levels: ['Lv1', 'Lv2', 'Lv3'], isActive: true }
  ];

  let employeeSkills = [
    { id: '1', employeeUid: '250001', employeeName: 'สมชาย ใจกล้า', skillCode: 'FORKLIFT', skillName: 'ขับรถยก / โฟล์คลิฟต์', level: 2, certifiedBy: 'Admin', certifiedAt: '2026-08-26', notes: '' }
  ];

  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
    const payload = route.request().postDataJSON() || {};
    const action = payload.action;

    if (action === 'getConfig') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          viewer: { uid: 'admin_01', name: 'ผู้ดูแลระบบ', roles: ['ADMIN', 'AKRA'], status: 'Active' },
          employees: [
            { uid: 'admin_01', name: 'ผู้ดูแลระบบ', roles: ['ADMIN', 'AKRA'], branches: 'AKRA', dept: 'ไอที', status: 'Active' },
            { uid: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' }
          ],
          workload: { date: '2026-08-26', hour: 14, recordedEmployees: [] }
        })
      });
    }

    if (action === 'getSkillCatalog') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: skillCatalog }) });
    }

    if (action === 'saveSkillCatalogItem') {
      const skill = payload.skill || {};
      const idx = skillCatalog.findIndex(s => s.code === skill.code);
      if (idx !== -1) {
        skillCatalog[idx] = { ...skillCatalog[idx], ...skill };
      } else {
        skillCatalog.push(skill);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: skillCatalog }) });
    }

    if (action === 'deleteSkillCatalogItem') {
      const code = payload.skillCode;
      skillCatalog = skillCatalog.filter(s => s.code !== code);
      employeeSkills = employeeSkills.filter(es => es.skillCode !== code);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: skillCatalog }) });
    }

    if (action === 'getEmployeeSkills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: employeeSkills }) });
    }

    if (action === 'getAdminStatus') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          users: [
            { username: 'admin_01', name: 'ผู้ดูแลระบบ', roles: ['ADMIN', 'AKRA'], status: 'Active' },
            { username: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], status: 'Active' }
          ],
          systemConfig: null
        })
      });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', records: [], audits: [] }) });
  });

  console.log('[2/6] Navigating to KPITracker as Admin and opening Settings -> ทักษะพนักงาน...');
  await page.goto(`${baseUrl}/?sso=${encodeURIComponent(adminToken)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('system-loading')?.classList.contains('hidden'));

  const isBranchSelectorVisible = await page.locator('#view-selector').isVisible().catch(() => false);
  if (isBranchSelectorVisible) {
    await page.evaluate(() => selectBranch('AKRA'));
    await page.waitForTimeout(200);
  }

  // Switch to Admin view and Sub-tab 4
  await page.evaluate(() => {
    switchTab('admin');
    switchAdminSubTab('skills');
  });
  await page.waitForTimeout(300);

  console.log('[3/6] Verifying initial Skill Catalog list and DOM cards...');
  const catalogListText = await page.locator('#admin-skill-catalog-list').innerText();
  assert(catalogListText.includes('ขับรถยก / โฟล์คลิฟต์'), 'Must display Forklift skill');
  assert(catalogListText.includes('จัดและแพ็กสินค้า W1'), 'Must display Pick W1 skill');
  console.log('  -> Initial catalog list verified.');

  console.log('[4/6] Testing "เพิ่มทักษะใหม่ (Add Skill)" Modal and Persistence...');
  await page.locator('#btn-add-skill-catalog').click();
  await page.waitForTimeout(200);

  assert.equal(await page.locator('#modal-skill-catalog-edit').isVisible(), true, 'Skill Edit/Add Modal must be visible');

  // Fill in new skill details
  await page.fill('#skill-modal-code', 'REACH_TRUCK');
  await page.fill('#skill-modal-name', 'ขับขี่รถยกสูง Reach Truck');
  await page.selectOption('#skill-modal-category', 'warehouse');
  await page.fill('#skill-modal-desc', 'ขับรถยกสูงในช่องทางแคบและหยิบบนชั้น Racking ชั้น 4 ขึ้นไป');
  await page.fill('#skill-modal-lvl1', 'ระดับ 1: ยกของชั้น 1-2 ได้อย่างปลอดภัย');
  await page.fill('#skill-modal-lvl2', 'ระดับ 2: ยกของชั้นสูง 4-6 และพื้นที่แคบคล่องแคล่ว');
  await page.fill('#skill-modal-lvl3', 'ระดับ 3: ครูฝึกและผู้วางแผนจัดเก็บชั้น Racking');

  // Click Save
  await page.locator('#btn-save-skill-modal').click();
  await page.waitForTimeout(400);

  assert.equal(await page.locator('#modal-skill-catalog-edit').isVisible(), false, 'Modal should close after save');

  const updatedCatalogText = await page.locator('#admin-skill-catalog-list').innerText();
  assert(updatedCatalogText.includes('ขับขี่รถยกสูง Reach Truck'), 'New Reach Truck skill must appear in catalog grid');
  assert(updatedCatalogText.includes('REACH_TRUCK'), 'Skill code REACH_TRUCK must be rendered');

  // Verify dropdown also has the new skill
  const selectHtml = await page.locator('#admin-skill-code-select').innerHTML();
  assert(selectHtml.includes('REACH_TRUCK'), 'Certification select dropdown must contain new skill code');
  console.log('  -> New skill addition & real-time sync verified.');

  console.log('[5/6] Testing "แก้ไขทักษะ (Edit Skill)" Modal & update flow...');
  // Click edit button for REACH_TRUCK
  await page.evaluate(() => openSkillModal('REACH_TRUCK'));
  await page.waitForTimeout(200);

  const codeInputVal = await page.locator('#skill-modal-code').inputValue();
  assert.equal(codeInputVal, 'REACH_TRUCK', 'Code should be prefilled');
  const isCodeReadonly = await page.locator('#skill-modal-code').getAttribute('readonly');
  assert.notEqual(isCodeReadonly, null, 'Code input must be readonly when editing');

  await page.fill('#skill-modal-name', 'ขับขี่รถยกสูง Reach Truck (Master)');
  await page.locator('#btn-save-skill-modal').click();
  await page.waitForTimeout(300);

  const reUpdatedText = await page.locator('#admin-skill-catalog-list').innerText();
  assert(reUpdatedText.includes('Reach Truck (Master)'), 'Edited name must be reflected in UI');
  console.log('  -> Skill edit flow verified.');

  console.log('[6/6] Testing "ลบทักษะ (Delete Skill)" flow...');
  await page.evaluate(() => deleteSkillCatalogItem('REACH_TRUCK'));
  await page.waitForTimeout(300);

  const finalCatalogText = await page.locator('#admin-skill-catalog-list').innerText();
  assert(!finalCatalogText.includes('REACH_TRUCK'), 'Deleted skill REACH_TRUCK must no longer appear in catalog grid');
  console.log('  -> Skill deletion flow verified.');

  assert.equal(pageErrors.length, 0, `Expected 0 page errors, found: ${pageErrors.join(', ')}`);
  console.log('  -> Zero page errors recorded.');

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  console.log('\n==================================================================');
  console.log('🎉 ALL SKILL CATALOG CRUD & ADMIN MANAGEMENT TESTS PASSED 100%! 🎉');
  console.log('==================================================================');
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
