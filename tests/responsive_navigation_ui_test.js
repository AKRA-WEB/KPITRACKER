const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(path.resolve(__dirname, '../../SOP/node_modules/playwright'));

const appRoot = path.resolve(__dirname, '..');
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function startServer() {
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/favicon.ico') {
            response.writeHead(204).end();
            return;
        }

        const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
        const filePath = path.resolve(appRoot, relativePath);
        if (!filePath.startsWith(appRoot + path.sep) && filePath !== path.join(appRoot, 'index.html')) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        try {
            const body = fs.readFileSync(filePath);
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
            response.end(body);
        } catch (error) {
            response.writeHead(404).end('Not found');
        }
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function isVisible(locator) {
    return locator.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
}

async function verifyAuthenticatedSupabaseInitialization(page, origin) {
    let getConfigCalls = 0;
    let getWorkloadDataCalls = 0;
    await page.route('https://script.google.com/macros/s/**', route => {
        const action = new URL(route.request().url()).searchParams.get('action');
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: action === 'verifyToken'
                ? JSON.stringify({
                    valid: true,
                    user: { id: '250001', name: 'Somchai', roles: ['WAREHOUSE'], perms: {} }
                })
                : JSON.stringify([])
        });
    });
    await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
        const payload = route.request().postDataJSON();
        assert.ok(payload.token, 'Authenticated initialization must forward the Main token');
        if (payload.action === 'getWorkloadData') {
            getWorkloadDataCalls++;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success', records: [] })
            });
        }
        assert.equal(payload.action, 'getConfig');
        getConfigCalls++;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'success',
                viewer: { uid: '250001', name: 'Somchai', roles: ['WAREHOUSE'], status: 'Active' },
                employees: [
                    { uid: '250001', name: 'Somchai', roles: ['WAREHOUSE'], branches: 'AKRA', status: 'Active' },
                    { uid: 'AKRA12123', name: 'TRAINEE (SORN)', aliasUids: ['TRAINEE_SORN'], aliasNames: ['SORN'], roles: ['AKRA'], branches: 'AKRA', status: 'Active' }
                ],
                workload: { date: '2026-08-23', hour: 12, recordedEmployees: [] }
            })
        });
    });

    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        id: '250001', name: 'Somchai', roles: ['WAREHOUSE'], exp: Math.floor(Date.now() / 1000) + 3600
    })}.test-signature`;
    await page.goto(`${origin}/?sso=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('system-loading').classList.contains('hidden'));
    await page.evaluate(async () => {
        localStorage.removeItem('kpiData_AKRA_ts');
        await syncDataFromSheet();
    });

    assert.equal(getConfigCalls, 1, 'Authenticated initialization must call Supabase getConfig exactly once');
    assert.ok(getWorkloadDataCalls >= 1, 'Authenticated sync must load authoritative AKRA Workload');
    assert.equal(await page.evaluate(() => typeof window.AkraSupabaseKPI?.getConfig), 'function');
    assert.deepEqual(
        await page.evaluate(() => GLOBAL_CONFIG_LIST.map(employee => employee.name)),
        ['Somchai', 'TRAINEE (SORN)'],
        'Authenticated initialization must keep the exact Main name and suppress its verified legacy alias'
    );
    assert.equal(await page.locator('#custom-modal').evaluate(element => element.classList.contains('hidden')), true);
    await page.evaluate(() => localStorage.clear());
}

async function verifyResponsivePrimaryNavigation(page) {
    const desktopNav = page.locator('#desktop-primary-nav');
    const mobileNav = page.locator('#bottom-nav');
    assert.equal(await desktopNav.getAttribute('aria-label'), 'เมนูหลักบนเดสก์ท็อป');
    assert.equal(await mobileNav.getAttribute('aria-label'), 'เมนูหลักบนมือถือ');

    for (const [width, desktopVisible] of [[320, false], [390, false], [768, true], [1280, true]]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
            await isVisible(desktopNav),
            desktopVisible,
            `${width}px viewport must ${desktopVisible ? 'expose' : 'hide'} the desktop primary tabs`
        );
        assert.equal(
            await isVisible(mobileNav),
            !desktopVisible,
            `${width}px viewport must ${desktopVisible ? 'hide' : 'expose'} the mobile bottom navigation`
        );
        assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
            `${width}px viewport must not introduce page-level horizontal overflow`
        );
        if (!desktopVisible) {
            const mobileClearance = await page.evaluate(() => ({
                contentPaddingBottom: parseFloat(getComputedStyle(document.querySelector('#app-content')).paddingBottom),
                navigationHeight: document.querySelector('#bottom-nav').getBoundingClientRect().height
            }));
            assert.ok(
                mobileClearance.contentPaddingBottom >= mobileClearance.navigationHeight,
                `${width}px content padding must keep final content clear of the fixed navigation`
            );
        }
    }

    await page.setViewportSize({ width: 1280, height: 900 });

    for (const [buttonId, viewId] of [
        ['dtab-workload', 'view-workload'],
        ['dtab-error', 'view-error'],
        ['dtab-billcount', 'view-billcount'],
        ['dtab-dashboard', 'view-dashboard']
    ]) {
        await page.locator(`#${buttonId}`).evaluate(button => button.click());
        const isSelectedView = await page.locator(`#${viewId}`).evaluate(element => !element.classList.contains('hidden'));
        assert.equal(isSelectedView, true, `${buttonId} must select ${viewId}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await isVisible(desktopNav), false, 'Mobile must hide the desktop primary tabs');
    assert.equal(await isVisible(mobileNav), true, 'Mobile must expose the bottom primary navigation');

    for (const [buttonId, viewId] of [
        ['tab-workload', 'view-workload'],
        ['tab-error', 'view-error'],
        ['tab-billcount', 'view-billcount'],
        ['tab-dashboard', 'view-dashboard']
    ]) {
        await page.locator(`#${buttonId}`).evaluate(button => button.click());
        assert.equal(
            await page.locator(`#${viewId}`).evaluate(element => !element.classList.contains('hidden')),
            true,
            `${buttonId} must select ${viewId}`
        );
    }

    const utilityTrigger = page.getByRole('button', { name: 'เปิดเครื่องมือเพิ่มเติม' });
    assert.equal(await isVisible(utilityTrigger), true, 'Mobile must keep secondary utilities reachable');
    await utilityTrigger.click({ force: true });

    const utilityPanel = page.locator('#drawer-panel');
    assert.equal(await utilityPanel.getAttribute('aria-label'), 'เครื่องมือเพิ่มเติม');
    assert.equal(await isVisible(utilityPanel), true, 'The secondary utility panel must open');
    const duplicatedPrimaryRoutes = utilityPanel.getByRole('button', {
        name: /Workload|ความผิดพลาด|บิลเบิกย้าย|แดชบอร์ด/
    });
    assert.equal(await duplicatedPrimaryRoutes.count(), 0, 'Secondary utilities must not duplicate primary routes');

    const closeButton = page.getByRole('button', { name: 'ปิดเมนู' });
    assert.equal(await closeButton.evaluate(element => element === document.activeElement), true, 'Opening utilities must focus the close button');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await utilityPanel.getAttribute('aria-hidden'), 'true', 'Escape must close the utility panel');
    assert.equal(await utilityPanel.getAttribute('inert'), '', 'A closed utility panel must be inert');
    assert.equal(await utilityTrigger.evaluate(element => element === document.activeElement), true, 'Closing utilities must restore trigger focus');

    for (const [buttonId, viewId] of [
        ['drawer-admin-dash-btn', 'view-admin-dash'],
        ['drawer-admin-btn', 'view-admin']
    ]) {
        await page.evaluate(() => {
            sessionToken = 'test-signed-session';
            currentUser = '250013';
            currentRoles = ['Admin'];
            IS_ADMIN = canAccessAdminSettings(currentRoles, sessionToken);
            window.AkraSupabaseKPI = window.AkraSupabaseKPI || {};
            window.AkraSupabaseKPI.getAdminStatus = async () => ({
                status: 'success', employees: GLOBAL_CONFIG_LIST,
                workload: { date: '2026-08-23', hour: 12, recordedEmployees: [] }
            });
            refreshActions = async () => {};
            updateDrawerUserInfo();
        });
        await utilityTrigger.click({ force: true });
        const button = page.locator(`#${buttonId}`);
        assert.equal(await isVisible(button), true, `${buttonId} must remain reachable for an authorized administrator`);
        await button.evaluate(element => element.click());
        assert.equal(
            await page.locator(`#${viewId}`).evaluate(element => !element.classList.contains('hidden')),
            true,
            `${buttonId} must select ${viewId}`
        );
    }
}

function rgbLightness(rgb) {
    const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
    return channels.reduce((sum, channel) => sum + channel, 0) / (255 * 3);
}

async function verifyVisualHierarchy(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const colors = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        header: getComputedStyle(document.querySelector('.app-header')).backgroundColor,
        cockpit: getComputedStyle(document.querySelector('#dashboard-branch-context')).backgroundColor
    }));

    assert.ok(rgbLightness(colors.body) > 0.9, `Application canvas must be light, received ${colors.body}`);
    assert.ok(rgbLightness(colors.header) < 0.3, `Header must remain intentionally dark, received ${colors.header}`);
    assert.ok(rgbLightness(colors.cockpit) < 0.3, `Dashboard cockpit must remain a contained dark surface, received ${colors.cockpit}`);

    const desktopHeaderHeight = await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(desktopHeaderHeight <= 80, `Desktop header must be compact, received ${desktopHeaderHeight}px`);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileHeaderHeight = await page.locator('.app-header').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(mobileHeaderHeight <= 80, `Mobile header must be compact, received ${mobileHeaderHeight}px`);
}

async function verifyBranchDashboardIsolation(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
        const now = String(Date.now());
        const currentWeekDate = formatDateKeyLocal(getStartOfWeek(new Date()));
        localStorage.setItem('kpiData_AKRA', JSON.stringify([{
            date: currentWeekDate,
            volume: { transfer: 111, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            errors: [{ emp: 'เอส', type: 'AKRA_ONLY_CASE', note: 'AKRA_ONLY_NOTE' }],
            tasks: [{ taskName: 'AKRA_ONLY_TASK', status: 'กำลังทำ', assignee: 'เอส' }],
            workload: []
        }]));
        localStorage.setItem('kpiData_TRD', JSON.stringify([{
            date: currentWeekDate,
            errors: [{ emp: 'ท็อป', type: 'TRD_ONLY_CASE', note: 'TRD_ONLY_NOTE' }],
            tasks: [{ taskName: 'TRD_ONLY_TASK', status: 'กำลังทำ', assignee: 'ท็อป' }]
        }]));
        localStorage.setItem('kpiData_AKRA_ts', now);
        localStorage.setItem('kpiData_TRD_ts', now);
    });

    for (const [branch, ownMarker, otherMarker] of [
        ['TRD', 'TRD_ONLY', 'AKRA_ONLY'],
        ['AKRA', 'AKRA_ONLY', 'TRD_ONLY']
    ]) {
        await page.evaluate(selectedBranch => {
            currentBranch = selectedBranch;
            initApp(selectedBranch, ['AKRA', 'TRD']);
            switchTab('dashboard');
        }, branch);

        const dashboard = page.locator('#view-dashboard');
        assert.match(
            await page.locator('#dashboard-branch-title').innerText(),
            new RegExp(branch),
            `Normal Dashboard heading must identify the active ${branch} branch`
        );
        assert.equal(
            await dashboard.locator('[id^="cockpit-"]').count(),
            0,
            'Normal Dashboard must not retain fixed sample cockpit metrics'
        );
        assert.match(await dashboard.innerText(), new RegExp(ownMarker), `${branch} Dashboard must render its own records`);
        assert.doesNotMatch(await dashboard.innerText(), new RegExp(otherMarker), `${branch} Dashboard must not render the other branch`);
    }
}

async function verifyFocusedUiDefects(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => switchTab('error'));

    const categoryContainer = page.locator('#err-cat-pills');
    const categories = categoryContainer.locator('.cat-chip');
    assert.equal(await categories.count(), 5, 'AKRA Incident QC must expose all five categories');

    const categoryLayout = await categoryContainer.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        containerRight: element.getBoundingClientRect().right,
        categoryRights: [...element.querySelectorAll('.cat-chip')].map(button => button.getBoundingClientRect().right),
        categoryHeights: [...element.querySelectorAll('.cat-chip')].map(button => button.getBoundingClientRect().height)
    }));
    assert.ok(categoryLayout.scrollWidth <= categoryLayout.clientWidth + 1, 'QC categories must not require horizontal scrolling');
    assert.ok(categoryLayout.categoryRights.every(right => right <= categoryLayout.containerRight + 1), 'Every QC category must fit in the visible container');
    assert.ok(
        categoryLayout.categoryHeights.every(height => height >= 44),
        `Every QC category must provide at least a 44px touch target, received ${JSON.stringify(categoryLayout.categoryHeights)}`
    );

    await page.evaluate(() => switchTab('workload'));
    const w2Icon = page.locator('#wl-core-grid button').filter({ hasText: 'คลังสำรอง W2' }).locator('i');
    const iconState = await w2Icon.evaluate(element => ({
        content: getComputedStyle(element, '::before').content,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height
    }));
    assert.notEqual(iconState.content, 'none', 'W2 must use an icon available in the loaded Font Awesome asset');
    assert.notEqual(iconState.content, '""', 'W2 icon glyph must not be blank');
    assert.ok(iconState.width > 0 && iconState.height > 0, 'W2 icon must occupy visible pixels');
}

async function verifyWorkloadDurationChoices(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        currentBranch = 'AKRA';
        workloadState.core = 'คลัง W1';
        workloadState.coreLabel = 'คลังหลัก W1';
        workloadState.support = [];
        renderWorkload();
        openSupportModal();
    });

    const durationButtons = page.locator('#modal-time-grid .modal-time-chip');
    assert.deepEqual(
        await durationButtons.allTextContents().then(values => values.map(value => value.trim())),
        ['30 นาที', '1 ชม.', '2 ชม.', '3 ชม.', 'ครึ่งวัน (5h)'],
        'secondary-work duration choices must expose exactly 0.5, 1, 2, 3, and 5 hours'
    );
    await page.getByRole('button', { name: '3 ชม.', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันเพิ่มงาน', exact: true }).click();

    const workload = await page.evaluate(() => getAkraWorkloadValues()[0]);
    assert.equal(workload.supportDuties.length, 1);
    assert.equal(workload.supportDuties[0].hours, 3, 'the 3-hour control must add a 3-hour secondary duty');
    assert.equal(workload.outbound, 7, 'a 3-hour secondary duty must recalculate primary work to 7 hours');
}

async function verifyBoundedLiveBillList(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        fetchLiveRequisitions = async () => {};
        liveRequisitionsList = Array.from({ length: 8 }, (_, index) => ({
            billNo: `#${8 - index}`,
            billType: index % 2 ? 'บิลด่วน' : 'เติมหน้าร้าน TRD',
            itemsSummary: 'สินค้าทดสอบหลายรายการสำหรับตรวจพื้นที่แสดงผลของการ์ดใบเบิก',
            requester: 'ผู้ทดสอบ',
            time: `0${index + 1}:00`,
            skuCount: 3,
            totalUnits: 12,
            status: 'waiting'
        }));
        switchTab('billcount');
        renderLiveRequisitions();
    });

    const list = page.locator('#live-bill-list-cards');
    assert.equal(await list.locator(':scope > div').count(), 8, 'Bounded list must retain every rendered bill');
    const dimensions = await list.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
    }));
    assert.ok(dimensions.clientHeight > 0, 'Live Bill list must remain visible');
    assert.ok(
        dimensions.scrollHeight > dimensions.clientHeight,
        `More than about five bills must scroll inside a bounded list: ${JSON.stringify(dimensions)}`
    );
    assert.equal(await list.getAttribute('tabindex'), '0', 'Scrollable Live Bill list must be keyboard focusable');
    await list.focus();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(100);
    assert.ok(await list.evaluate(element => element.scrollTop > 0), 'Keyboard users must be able to scroll the Live Bill list');
}

(async () => {
    const server = await startServer();
    const port = server.address().port;
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    try {
        const origin = `http://127.0.0.1:${port}`;
        await verifyAuthenticatedSupabaseInitialization(page, origin);
        await page.goto(`${origin}/?mock=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#bottom-nav')).position === 'fixed');
        await page.waitForFunction(() => document.getElementById('system-loading').classList.contains('hidden'));
        await page.evaluate(() => {
            currentBranch = 'AKRA';
            document.getElementById('app-content').classList.remove('hidden');
            document.getElementById('custom-modal').classList.add('hidden');
            releaseFocusFromModal('custom-modal');
        });
        await verifyResponsivePrimaryNavigation(page);
        await verifyVisualHierarchy(page);
        await verifyBranchDashboardIsolation(page);
        await verifyFocusedUiDefects(page);
        await verifyWorkloadDurationChoices(page);
        await verifyBoundedLiveBillList(page);
        assert.deepEqual(pageErrors, [], `Browser runtime must have zero page errors: ${pageErrors.join(' | ')}`);
        assert.deepEqual(consoleErrors, [], `Browser runtime must have zero console errors: ${consoleErrors.join(' | ')}`);
        console.log('PASS: responsive primary navigation and non-duplicating utilities');
        console.log('PASS: light application canvas and contained dark surfaces');
        console.log('PASS: active-branch Dashboard isolation without fixed sample metrics');
        console.log('PASS: visible W2 icon and non-clipped Incident QC categories');
        console.log('PASS: exact Workload duration choices and 3-hour recalculation');
        console.log('PASS: bounded, keyboard-scrollable Live Bill list');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
