const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

// Load Playwright for true headless browser testing
const { chromium } = require(path.join(__dirname, '..', '..', 'SOP', 'node_modules', 'playwright-core'));

const indexPath = path.resolve(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

const mockJwtSecret = '0000000000000000000000000000000000000000000000000000000000000000';

function makeToken(username, name, roles = ['admin', 'supervisor']) {
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
  console.log('=== RUNNING COMPREHENSIVE END-TO-END LIVE USAGE SIMULATION ===\n');

  // 1. Start local HTTP server to serve the real application
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (parsedUrl.pathname === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: '20260831.04' }));
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

  console.log(`[1/7] Local HTTP server running on ${baseUrl}`);

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

  // Track uncaught page errors
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  // Mock Edge API & Sheet backend
  const adminToken = makeToken('AKRA12123', 'หมูหยอง', ['ADMIN', 'SUPERVISOR', 'AKRA']);
  let serverSkills = [
    {
      id: 'skill-001',
      employeeUid: 'AKRA12123',
      employeeName: 'หมูหยอง',
      skillCode: 'FORKLIFT',
      skillName: 'ขับรถยก / โฟล์คลิฟต์',
      category: 'warehouse',
      icon: 'fa-truck-ramp-box',
      level: 2,
      levelLabel: 'ระดับ 2: ชำนาญการ',
      certifiedBy: 'Manager_AKRA',
      certifiedAt: '2026-08-26',
      notes: 'ขับรถยกคล่องแคล่ว'
    }
  ];

  await page.route('https://script.google.com/macros/s/**', route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'verifyToken') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, user: { id: 'AKRA12123', name: 'หมูหยอง', roles: ['ADMIN', 'SUPERVISOR', 'AKRA'] } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
    const payload = route.request().postDataJSON() || {};
    const action = payload.action;

    if (action === 'getConfig') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          viewer: { uid: 'AKRA12123', name: 'หมูหยอง', roles: ['ADMIN', 'SUPERVISOR', 'AKRA'], status: 'Active' },
          employees: [
            { uid: 'AKRA12123', name: 'หมูหยอง', roles: ['ADMIN', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' },
            { uid: 'AKRA12124', name: 'เอี้ยง', roles: ['AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' }
          ],
          workload: { date: '2026-08-26', hour: 14, recordedEmployees: [] }
        })
      });
    }

    if (action === 'getSkillCatalog') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          skills: [
            { code: 'FORKLIFT', name: 'ขับรถยก / โฟล์คลิฟต์', category: 'warehouse', icon: 'fa-truck-ramp-box', description: 'ขับขี่โฟล์คลิฟต์', levels: ['Basic', 'Proficient', 'Trainer'] },
            { code: 'PICK_W1', name: 'จัดและแพ็กสินค้า W1', category: 'warehouse', icon: 'fa-boxes-packing', description: 'หยิบสินค้า W1', levels: ['Basic', 'Proficient', 'Trainer'] },
            { code: 'STORE_W2', name: 'จัดเก็บและโอนย้าย W2', category: 'warehouse', icon: 'fa-cubes-stacked', description: 'คลังสำรอง W2', levels: ['Basic', 'Proficient', 'Trainer'] },
            { code: 'POS_CASHIER', name: 'ระบบแคชเชียร์ & บิลขาย', category: 'storefront', icon: 'fa-cash-register', description: 'คิดเงินหน้าร้าน', levels: ['Basic', 'Proficient', 'Trainer'] }
          ]
        })
      });
    }

    if (action === 'getEmployeeSkills') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', skills: serverSkills })
      });
    }

    if (action === 'saveEmployeeSkill') {
      serverSkills.push({
        id: `skill-${Date.now()}`,
        employeeUid: payload.employeeUid,
        employeeName: payload.employeeName,
        skillCode: payload.skillCode,
        skillName: payload.skillCode === 'PICK_W1' ? 'จัดและแพ็กสินค้า W1' : payload.skillCode,
        category: 'warehouse',
        icon: 'fa-boxes-packing',
        level: payload.level,
        levelLabel: `ระดับ ${payload.level}`,
        certifiedBy: 'หมูหยอง',
        certifiedAt: '2026-08-26',
        notes: payload.notes || ''
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', skills: serverSkills })
      });
    }

    if (action === 'getEmployeeProfileSummary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          profile: {
            uid: payload.employeeUid || 'AKRA12123',
            name: 'หมูหยอง',
            roles: ['ADMIN', 'SUPERVISOR', 'AKRA'],
            status: 'Active',
            skills: serverSkills,
            qualityHp: 100,
            incidentCount: 0,
            workloadStats: {
              recordedDays: 15,
              totalHours: 150,
              outboundHours: 90,
              inboundHours: 30,
              transferHours: 15,
              sharedHours: 15,
              flexibilityIndex: 10
            }
          }
        })
      });
    }

    if (action === 'getWorkloadData' || action === 'getIncidentData' || action === 'getAuditData' || action === 'getShiftRoster') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', records: [], audits: [], findings: [], shiftRoster: null })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success' })
    });
  });

  console.log('[2/7] Navigating to KPITracker with Admin SSO Token...');
  await page.goto(`${baseUrl}/?sso=${encodeURIComponent(adminToken)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('system-loading')?.classList.contains('hidden'));

  // Select branch if view-selector is presented
  const isBranchSelectorVisible = await page.locator('#view-selector').isVisible().catch(() => false);
  if (isBranchSelectorVisible) {
    const btnAkra = page.locator('#btn-branch-akra');
    if (await btnAkra.isVisible()) {
      await btnAkra.click();
    } else {
      await page.evaluate(() => selectBranch('AKRA'));
    }
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => document.getElementById('view-selector')?.classList.contains('hidden'));

  console.log('[3/7] Testing Real Workload Capacity Flex (Full Day / Half Day / OT)...');
  // Click Half Day 5h
  const btn5h = page.locator('#btn-flex-5h');
  if (await btn5h.isVisible()) {
    await btn5h.click();
    const manHoursBadge = await page.locator('#wl-total-manhours-badge').innerText();
    assert(manHoursBadge.includes('5.0 ชม.'), `Expected 5.0 man-hours badge, got: ${manHoursBadge}`);
    console.log('  -> Capacity Flex (5.0 ชม. ครึ่งวัน) verified live.');
  }

  console.log('[4/7] Testing 5S Warehouse Walk Audit Tab & Scorecard...');
  await page.locator('#dtab-audit').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#view-audit').isVisible(), true, '5S Audit view must be visible');
  const auditScoreBadge = await page.locator('#audit-score-badge').innerText();
  assert(auditScoreBadge.includes('100'), `Initial 5S score must be 100, got: ${auditScoreBadge}`);
  console.log('  -> 5S Warehouse Walk Audit Scorecard verified live.');

  console.log('[5/7] Testing System Settings -> Skill Matrix Tab (Sub-tab 4)...');
  // Open Admin Settings
  await page.evaluate(() => switchTab('admin'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#view-admin').isVisible(), true, 'view-admin must be visible');

  // Switch to Sub-tab 4 Skills
  await page.locator('#btn-adm-tab-skills').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#admin-panel-skills').isVisible(), true, 'admin-panel-skills must be visible');

  // Select Skill PICK_W1, Level 3 Trainer, and Certify
  await page.selectOption('#admin-skill-code-select', 'PICK_W1');
  await page.selectOption('#admin-skill-level-select', '3');
  await page.fill('#admin-skill-notes-input', 'ผ่านการทดสอบเป็น Master Trainer ประจำคลัง W1');
  await page.locator('#btn-save-admin-skill').click();
  await page.waitForTimeout(300);

  const skillsCountText = await page.locator('#admin-certified-skills-count').innerText();
  assert(skillsCountText.includes('2 รายการ'), `Expected 2 certified skills, got: ${skillsCountText}`);
  console.log('  -> Skill Certification (Level 3 Master Trainer) verified live.');

  console.log('[6/7] Testing Employee Profile Modal (#modal-employee-profile)...');
  // Click on the certified employee link to open Profile Modal
  const profileLink = page.locator('#admin-certified-skills-list button.font-bold').first();
  if (await profileLink.isVisible()) {
    await profileLink.click();
  } else {
    await page.evaluate(() => openEmployeeProfileModal('AKRA12123', 'หมูหยอง'));
  }
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#modal-employee-profile').isVisible(), true, 'Profile modal must be open');

  const profileName = await page.locator('#emp-profile-name').innerText();
  const profileHp = await page.locator('#emp-profile-hp').innerText();
  const profileFlex = await page.locator('#emp-profile-flex').innerText();
  const tierBadgeText = await page.locator('#emp-profile-tier-badge').innerText();

  assert.equal(profileName, 'หมูหยอง');
  assert.equal(profileHp, '100%');
  assert.equal(profileFlex, '10%');
  assert(tierBadgeText.includes('Master / Trainer'), `Expected Master/Trainer badge, got: ${tierBadgeText}`);

  // Close profile modal
  await page.locator('button[aria-label="ปิดหน้าต่างโปรไฟล์"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#modal-employee-profile').isVisible(), false, 'Profile modal must close cleanly');
  console.log('  -> Employee Competency Profile Card & Multi-Skilling Breakdown verified live.');

  console.log('[7/7] Checking Page Console Errors & Cleanliness...');
  assert.equal(pageErrors.length, 0, `Expected 0 page errors, found: ${pageErrors.join(', ')}`);
  console.log('  -> Zero page errors recorded during live execution.');

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  console.log('\n======================================================================');
  console.log('🎉 REAL USAGE END-TO-END SIMULATION & VERIFICATION PASSED 100%! 🎉');
  console.log('======================================================================');
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
