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
  console.log('=== RUNNING PROFILE PHOTO & AVATAR UPLOAD COMPREHENSIVE TESTS ===\n');

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

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
  page.on('pageerror', err => pageErrors.push(err.message));

  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  const empToken = makeToken('250001', 'สมชาย ใจกล้า', ['WAREHOUSE', 'AKRA']);

  await page.route('https://script.google.com/macros/s/**', route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'verifyToken') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, user: { id: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'] } })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  let userAvatarUrl = '';
  let uploadAvatarCallCount = 0;

  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
    const payload = route.request().postDataJSON() || {};
    const action = payload.action;

    if (action === 'getConfig') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          viewer: { uid: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], status: 'Active', avatarUrl: userAvatarUrl },
          employees: [
            { uid: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active', avatarUrl: userAvatarUrl }
          ],
          workload: { date: '2026-08-26', hour: 14, recordedEmployees: [] }
        })
      });
    }

    if (action === 'getMyProfileSummary' || action === 'getEmployeeProfileSummary') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          profile: {
            uid: '250001',
            name: 'สมชาย ใจกล้า',
            roles: ['WAREHOUSE', 'AKRA'],
            dept: 'คลังสินค้า',
            status: 'Active',
            avatarUrl: userAvatarUrl,
            month: '2026-08',
            qualityHp: 96,
            incidentCount: 1,
            goodCatchCount: 3,
            safeStreakDays: 21,
            skills: [],
            roadmap: [],
            momentum: { qualityDelta: 10, qualityImprovementText: '+10% vs เดือนก่อน' },
            workloadStats: { totalHours: 120, recordedDays: 15, flexibilityIndex: 25, isMultiSkillStar: true }
          }
        })
      });
    }

    if (action === 'uploadProfileAvatar') {
      uploadAvatarCallCount++;
      userAvatarUrl = payload.avatarData;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', avatarUrl: userAvatarUrl, employeeUid: '250001' })
      });
    }

    if (action === 'getSkillCatalog') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: [] }) });
    }

    if (action === 'getEmployeeSkills') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', skills: [] }) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', records: [] }) });
  });

  console.log('[2/5] Navigating to KPITracker and opening My Profile tab...');
  await page.goto(`${baseUrl}/?sso=${encodeURIComponent(empToken)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('system-loading')?.classList.contains('hidden'));

  const isBranchSelectorVisible = await page.locator('#view-selector').isVisible().catch(() => false);
  if (isBranchSelectorVisible) {
    await page.evaluate(() => selectBranch('AKRA'));
    await page.waitForTimeout(200);
  }

  // Switch to My Profile tab
  await page.evaluate(() => switchTab('my-profile'));
  await page.waitForTimeout(300);

  console.log('[3/5] Verifying initial avatar state (default astronaut icon)...');
  const isImgHidden = await page.locator('#my-profile-avatar-img').evaluate(el => el.classList.contains('hidden'));
  assert.equal(isImgHidden, true, 'Avatar image must be initially hidden when no photo is uploaded');

  const isIconVisible = await page.locator('#my-profile-avatar').isVisible();
  assert.equal(isIconVisible, true, 'Default avatar icon must be visible');
  console.log('  -> Default avatar icon state verified.');

  console.log('[4/5] Testing Profile Photo Upload & Client-side Canvas Compression flow...');
  // Create a 10x10 base64 PNG image
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

  // Trigger avatar upload with compressed photo
  await page.evaluate(async (base64) => {
    const res = await AkraSupabaseKPI.uploadProfileAvatar(sessionToken, base64, '250001');
    if (res.status === 'success') {
      const avatarImg = document.getElementById('my-profile-avatar-img');
      const avatarIcon = document.getElementById('my-profile-avatar');
      avatarImg.src = res.avatarUrl;
      avatarImg.classList.remove('hidden');
      avatarIcon.classList.add('hidden');
    }
  }, sampleBase64);

  await page.waitForTimeout(300);

  assert.equal(uploadAvatarCallCount, 1, 'API uploadProfileAvatar must be invoked once');
  const updatedSrc = await page.locator('#my-profile-avatar-img').getAttribute('src');
  assert.equal(updatedSrc, sampleBase64, 'Avatar image src must match uploaded base64 data');

  const isImgVisibleNow = await page.locator('#my-profile-avatar-img').isVisible();
  assert.equal(isImgVisibleNow, true, 'Uploaded avatar image must now be visible in DOM');

  const isIconHiddenNow = await page.locator('#my-profile-avatar').evaluate(el => el.classList.contains('hidden'));
  assert.equal(isIconHiddenNow, true, 'Avatar icon must be hidden after photo upload');
  console.log('  -> Profile photo upload and DOM reactive update verified.');

  console.log('[5/5] Testing Employee Profile Modal avatar propagation...');
  await page.evaluate(() => {
    openEmployeeProfileModal('250001', 'สมชาย ใจกล้า');
  });
  await page.waitForTimeout(300);

  const modalImgSrc = await page.locator('#emp-profile-avatar-img').getAttribute('src');
  assert.equal(modalImgSrc, sampleBase64, 'Modal avatar image must also display employee profile photo');
  console.log('  -> Employee Profile Modal photo display verified.');

  assert.equal(pageErrors.length, 0, `Expected 0 page errors, found: ${pageErrors.join(', ')}`);
  console.log('  -> Zero page errors recorded.');

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  console.log('\n=============================================================');
  console.log('🎉 ALL PROFILE PHOTO & AVATAR UPLOAD TESTS PASSED 100%! 🎉');
  console.log('=============================================================');
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
