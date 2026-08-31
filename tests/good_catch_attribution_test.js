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

function makeToken(username, name, roles = ['WAREHOUSE', 'AKRA']) {
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
  console.log('=== RUNNING GOOD CATCH DUAL-ATTRIBUTION E2E TEST ===\n');

  // Verify Version Parity
  const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../version.json'), 'utf8'));
  assert.strictEqual(versionJson.version, '20260831.03', 'version.json must be 20260831.03');

  let savedIncidentCases = [];

  // 1. Start local HTTP server
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (parsedUrl.pathname === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: '20260831.03' }));
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

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[1/5] Local HTTP server running on ${baseUrl}`);

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
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Intercept Supabase API calls
  await page.route('**/functions/v1/kpi-api', async (route) => {
    const req = route.request();
    const payload = req.postDataJSON() || {};
    const action = payload.action;

    if (action === 'getConfig') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          viewer: { uid: '250001', name: 'ปีเตอร์', roles: ['WAREHOUSE', 'AKRA'], status: 'Active' },
          employees: [
            { uid: '250001', name: 'ปีเตอร์', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' },
            { uid: '250002', name: 'พี่เอส', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' },
            { uid: '250003', name: 'สมชาย', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' }
          ],
          workload: { date: '2026-08-26', hour: 14, recordedEmployees: [] }
        })
      });
    }

    if (action === 'saveIncident') {
      const incident = payload.incident || {};
      savedIncidentCases.push({
        caseId: incident.caseId,
        worker: incident.worker,
        detectedBy: incident.detectedBy,
        goodCatchBy: incident.goodCatchBy,
        penalty: incident.penalty,
        type: incident.type,
        note: incident.note,
        time: incident.time
      });

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          errors: savedIncidentCases,
          incidents: savedIncidentCases,
          zeroConfirmed: false
        })
      });
    }

    if (action === 'getMyProfileSummary' || action === 'getEmployeeProfileSummary') {
      const targetEmp = payload.employeeUid || 'ปีเตอร์';
      const isPeter = String(targetEmp).includes('ปีเตอร์') || String(targetEmp).includes('250001');

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          profile: {
            uid: isPeter ? '250001' : '250002',
            name: isPeter ? 'ปีเตอร์' : 'พี่เอส',
            roles: ['WAREHOUSE', 'AKRA'],
            dept: 'คลังสินค้า',
            status: 'Active',
            month: '2026-08',
            qualityHp: isPeter ? 100 : 95,
            incidentCount: isPeter ? 0 : 1,
            goodCatchCount: isPeter ? 1 : 0,
            safeStreakDays: isPeter ? 21 : 0,
            skills: [],
            roadmap: [],
            momentum: { qualityDelta: 0, qualityImprovementText: '+0% vs เดือนก่อน' },
            workloadStats: { totalHours: 120, recordedDays: 15, flexibilityIndex: 25, isMultiSkillStar: true }
          }
        })
      });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
  });

  const sessionToken = makeToken('250001', 'ปีเตอร์');

  // Seed SSO Session
  await page.addInitScript((token) => {
    localStorage.setItem('akra_sso_token', token);
    localStorage.setItem('akra_sso_user_data', JSON.stringify({
      username: '250001',
      name: 'ปีเตอร์',
      roles: ['WAREHOUSE', 'AKRA'],
      perms: { 'app-kpi': ['adminDashboard', 'adminSettings'] }
    }));
  }, sessionToken);

  console.log('[2/5] Navigating to KPITracker...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  console.log('[3/5] Switching to Incident QC Tab & Standalone Good Catch Mode...');
  await page.evaluate(() => {
    switchTab('error');
    switchIncidentFormMode('good_catch');
  });
  await page.waitForTimeout(300);

  // Assert Standalone Good Catch form is present
  const catcherContainer = await page.locator('#pc-err-catcher-chips').count();
  assert.strictEqual(catcherContainer, 1, 'Good Catch catcher container must exist');
  const catcherNoteCount = await page.locator('#pc-err-catcher-note-input').count();
  assert.strictEqual(catcherNoteCount, 1, 'Good Catch interception note input must exist');

  console.log('[4/5] Recording standalone Good Catch (Catcher: ปีเตอร์, Interception note)...');
  // Select ปีเตอร์ as catcher and fill interception details
  await page.evaluate(() => {
    const catcherChips = Array.from(document.querySelectorAll('#pc-err-catcher-chips .emp-chip'));
    const peterChip = catcherChips.find(c => c.textContent.includes('ปีเตอร์'));
    if (peterChip) peterChip.click();

    const catcherNoteInput = document.getElementById('pc-err-catcher-note-input');
    if (catcherNoteInput) catcherNoteInput.value = 'ตรวจนับหน้าพาเลทก่อนขึ้นรถ พบหยิบเกิน 2 ลัง บิล 8891 สกัดได้ทัน';
  });

  // Click save Good Catch standalone
  await page.evaluate(() => saveStandaloneGoodCatch());
  await page.waitForTimeout(600);

  // Verify saved incident
  assert.strictEqual(savedIncidentCases.length, 1, 'One standalone Good Catch case should be saved');
  assert.strictEqual(savedIncidentCases[0].worker, 'ปีเตอร์', 'Worker should be ปีเตอร์');
  assert.strictEqual(savedIncidentCases[0].detectedBy, 'ปีเตอร์', 'Good Catch Catcher should be ปีเตอร์');
  assert.strictEqual(savedIncidentCases[0].penalty, 0, 'Standalone Good Catch must have 0 penalty');
  assert.ok(savedIncidentCases[0].note.includes('สกัดได้ทัน: ตรวจนับหน้าพาเลทก่อนขึ้นรถ พบหยิบเกิน 2 ลัง บิล 8891 สกัดได้ทัน'), 'Note should contain interception details');

  // Verify timeline rendering standalone Good Catch card
  const timelineHtml = await page.locator('#pc-err-timeline').innerHTML();
  assert.ok(timelineHtml.includes('Good Catch: ปีเตอร์'), 'Timeline must display Good Catch badge for ปีเตอร์');
  assert.ok(timelineHtml.includes('+1 Good Catch (0 HP)'), 'Timeline must display positive recognition badge');
  assert.ok(timelineHtml.includes('สกัดได้ทัน: ตรวจนับหน้าพาเลทก่อนขึ้นรถ พบหยิบเกิน 2 ลัง บิล 8891 สกัดได้ทัน'), 'Timeline must display interception detail');

  console.log('[5/5] Verifying Profile Passport displays Good Catch +1 for ปีเตอร์...');
  await page.evaluate(() => switchTab('my-profile'));
  await page.waitForTimeout(400);

  const goodCatchEl = await page.locator('#my-profile-good-catch-count').innerText();
  assert.strictEqual(goodCatchEl, '1', 'My Profile for ปีเตอร์ must display Good Catch 1');

  assert.strictEqual(pageErrors.length, 0, `Page errors encountered: ${pageErrors.join(', ')}`);
  console.log('  -> Zero page errors recorded.');

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  console.log('\n=============================================================');
  console.log('🎉 GOOD CATCH STANDALONE TESTS PASSED 100%! 🎉');
  console.log('=============================================================\n');
  process.exit(0);
})().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
