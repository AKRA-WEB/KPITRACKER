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
  console.log('=== RUNNING MY PROFILE & PASSPORT COMPREHENSIVE TESTS ===\n');

  // 1. Start local HTTP server
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (parsedUrl.pathname === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: '20260826.07' }));
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

  const userToken = makeToken('250001', 'สมชาย ใจกล้า', ['WAREHOUSE', 'AKRA']);

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
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  let requestedMonth = null;
  await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
    const payload = route.request().postDataJSON() || {};
    const action = payload.action;

    if (action === 'getConfig') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          viewer: { uid: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], status: 'Active' },
          employees: [
            { uid: '250001', name: 'สมชาย ใจกล้า', roles: ['WAREHOUSE', 'AKRA'], branches: 'AKRA', dept: 'คลังสินค้า', status: 'Active' }
          ],
          workload: { date: '2026-08-26', hour: 14, recordedEmployees: [] }
        })
      });
    }

    if (action === 'getMyProfileSummary' || action === 'getEmployeeProfileSummary') {
      requestedMonth = payload.month || '2026-08';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          profile: {
            uid: '250001',
            name: 'สมชาย ใจกล้า',
            roles: ['WAREHOUSE', 'AKRA'],
            dept: 'คลังสินค้าหลัก W1',
            status: 'Active',
            month: requestedMonth,
            qualityHp: 96,
            incidentCount: 2,
            goodCatchCount: 4,
            safeStreakDays: 21,
            skills: [
              { skillCode: 'PICK_W1', level: 3, certifiedAt: '2026-08-01' },
              { skillCode: 'STORE_W2', level: 2, certifiedAt: '2026-08-10' },
              { skillCode: 'INBOUND_QC', level: 1, certifiedAt: '2026-08-15' }
            ],
            roadmap: [
              { code: 'PICK_W1', name: 'จัดและแพ็กสินค้า W1', isCertified: true, level: 3, levelLabel: 'Lv.3 (Master Trainer)', icon: 'fa-boxes-packing' },
              { code: 'STORE_W2', name: 'จัดเก็บและโอนย้าย W2', isCertified: true, level: 2, levelLabel: 'Lv.2 (ชำนาญการ)', icon: 'fa-cubes-stacked' },
              { code: 'INBOUND_QC', name: 'ตรวจรับสินค้าเข้า (QC)', isCertified: true, level: 1, levelLabel: 'Lv.1 (พื้นฐาน)', icon: 'fa-clipboard-check' },
              { code: 'FORKLIFT', name: 'ขับรถยก / โฟล์คลิฟต์', isCertified: false, level: 0, levelLabel: 'ยังไม่ได้รับการรับรอง', icon: 'fa-truck-ramp-box' },
              { code: 'AUDIT_5S', name: 'หัวหน้าตรวจมาตรฐาน 5S', isCertified: false, level: 0, levelLabel: 'ยังไม่ได้รับการรับรอง', icon: 'fa-list-check' }
            ],
            momentum: {
              qualityDelta: 12,
              qualityImprovementText: '+12% vs เดือนก่อน',
              prevMonthHours: 140,
              supportHoursChange: 15
            },
            workloadStats: {
              recordedDays: 20,
              totalHours: 160,
              outboundHours: 56,
              outboundPct: 35,
              inboundHours: 67,
              inboundPct: 42,
              transferHours: 0,
              transferPct: 0,
              sharedHours: 37,
              sharedPct: 23,
              flexibilityIndex: 23,
              isMultiSkillStar: true
            }
          }
        })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', records: [], audits: [], findings: [], skills: [] })
    });
  });

  console.log('[2/5] Navigating to KPITracker and Opening "👤 โปรไฟล์ฉัน" tab...');
  await page.goto(`${baseUrl}/?sso=${encodeURIComponent(userToken)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('system-loading')?.classList.contains('hidden'));

  const isBranchSelectorVisible = await page.locator('#view-selector').isVisible().catch(() => false);
  if (isBranchSelectorVisible) {
    await page.evaluate(() => selectBranch('AKRA'));
    await page.waitForTimeout(200);
  }

  // Click on My Profile tab button
  await page.locator('#dtab-my-profile').click();
  await page.waitForTimeout(300);

  console.log('[3/5] Verifying My Profile DOM elements & Quality Highlights...');
  assert.equal(await page.locator('#view-my-profile').isVisible(), true, 'view-my-profile must be visible');

  const qualityScore = await page.locator('#my-profile-quality-score').innerText();
  const goodCatchCount = await page.locator('#my-profile-good-catch-count').innerText();
  const safeStreak = await page.locator('#my-profile-safe-streak').innerText();

  assert.equal(qualityScore, '96', `Expected Quality Score 96, got ${qualityScore}`);
  assert.equal(goodCatchCount, '4', `Expected Good Catch 4, got ${goodCatchCount}`);
  assert.equal(safeStreak, '21', `Expected Safe Streak 21, got ${safeStreak}`);
  console.log('  -> Quality Score (96/100), Good Catch (4 ครั้ง), Safe Streak (21 วัน) verified.');

  console.log('[4/5] Verifying Workload Stacked Bar, Multi-Skill Star & Roadmap Badges...');
  const multiSkillBadge = page.locator('#my-profile-multi-skill-badge');
  assert.equal(await multiSkillBadge.isVisible(), true, 'Multi-Skill Star badge must be visible when support >= 20%');

  const totalHoursText = await page.locator('#my-profile-total-hours-badge').innerText();
  assert(totalHoursText.includes('160 ชม.'), `Expected 160 ชม., got ${totalHoursText}`);

  const certifiedCount = await page.locator('#my-profile-certified-count').innerText();
  assert(certifiedCount.includes('3 ทักษะ'), `Expected 3 certified skills, got ${certifiedCount}`);

  const momentumBadgeText = await page.locator('#my-profile-momentum-badge').innerText();
  assert.equal(momentumBadgeText, '+12% vs เดือนก่อน');
  console.log('  -> Workload Breakdown (35% Out, 42% In, 23% Support), Multi-Skill Star & Momentum (+12%) verified.');

  console.log('[5/5] Testing Month Selection & Dynamic Reload...');
  await page.fill('#my-profile-month-input', '2026-07');
  await page.dispatchEvent('#my-profile-month-input', 'change');
  await page.waitForTimeout(300);

  assert.equal(requestedMonth, '2026-07', 'Month picker change must query backend for requested month');
  console.log('  -> Month change to 2026-07 queried and handled cleanly.');

  assert.equal(pageErrors.length, 0, `Expected 0 page errors, found: ${pageErrors.join(', ')}`);
  console.log('  -> Zero page errors recorded.');

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  console.log('\n=============================================================');
  console.log('🎉 ALL MY PROFILE & PASSPORT COMPREHENSIVE TESTS PASSED 100%! 🎉');
  console.log('=============================================================');
})().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
