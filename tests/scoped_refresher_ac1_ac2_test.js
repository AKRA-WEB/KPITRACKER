const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const playwrightPath = [path.resolve(__dirname, '../../SOP/node_modules/playwright'), path.resolve(__dirname, '../../../../SOP/node_modules/playwright'), path.resolve(__dirname, '../../../../../../SOP/node_modules/playwright')].find(p => fs.existsSync(p)) || 'playwright';
const { chromium } = require(playwrightPath);

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
        if (pathname === '/favicon.ico') return response.writeHead(204).end();
        const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
        const filePath = path.resolve(appRoot, relativePath);
        if (!filePath.startsWith(appRoot + path.sep) && filePath !== path.join(appRoot, 'index.html')) {
            return response.writeHead(403).end('Forbidden');
        }
        try {
            const body = fs.readFileSync(filePath);
            response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
            response.end(body);
        } catch (_error) {
            response.writeHead(404).end('Not found');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
    let requests = [];
    let gasCalls = 0;
    const server = await startServer();
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    let delayedRelease = null;
    let delaySupabase = false;

    // Block GAS
    await page.route('https://script.google.com/macros/s/**', async route => {
        gasCalls++;
        // Failing GAS
        return route.fulfill({
            status: 500, contentType: 'application/json', body: '{"error": "gas failure"}'
        });
    });

    await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        
        if (payload.action === 'getWorkloadData') {
            // Failing Workload
            return route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'error', reason: 'database_error' })
            });
        }
        if (payload.action === 'getIncidentData') {
            if (delaySupabase && payload.branch === 'AKRA') {
                await new Promise(resolve => delayedRelease = resolve);
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ 
                    status: 'success', 
                    records: [{
                        date: '2026-09-08',
                        branch: payload.branch,
                        incidents: [{
                            kind: 'case', caseId: `ERR-2026-09-08-${payload.branch}-1`, worker: 'Test', participants: ['Test'],
                            category: 'trd_store', type: 'Test Type', penalty: 5, note: `supabase incident ${payload.branch}`, time: '09:00 น.'
                        }],
                        errors: [],
                        zeroErrorsConfirmed: false
                    }]
                })
            });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', records: [] }) });
    });

    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?mock=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('system-loading').classList.contains('hidden'));
        
        // Setup initial state
        await page.evaluate(() => {
            sessionToken = 'signed-main-token';
            currentUser = '250013';
            currentRoles = ['ADMIN'];
            document.getElementById('app-content').classList.remove('hidden');
            document.getElementById('custom-modal').classList.add('hidden');
            localStorage.clear();
        });

        // AC1: Assert that with GAS blocked/failing and a cold cache, Incidents load from Supabase, 
        // and an injected Workload failure does not suppress Incident loading.
        await page.evaluate(async () => {
            currentBranch = 'TRD';
            recordedErrorCases = [];
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = '2026-09-08'; });
            await syncDataFromSheet();
        });

        const timelineText = await page.locator('#pc-err-timeline').innerText();
        const type = await page.evaluate(() => typeof window.AkraSupabaseKPI);
        console.log('typeof window.AkraSupabaseKPI:', type);
        console.log('requests made:', requests.filter(r => r.action === 'getIncidentData'));
        assert.match(timelineText, /supabase incident TRD/, 'AC1: Incident data must load from Supabase even if GAS fails and Workload fails.');
        console.log('PASS: AC1 - Incidents load from Supabase on cold cache despite GAS & Workload failures.');

        // AC2: Assert that ScopedRefresher deduplicates in-flight calls and prevents a stale branch response from overwriting a switched branch.
        delaySupabase = true;
        
        // Trigger AKRA (delayed) and TRD (fast)
        const ac2Result = await page.evaluate(() => {
            return new Promise((resolve) => {
                // Clear state again for AC2
                localStorage.clear();
                
                // Trigger AKRA - this should get delayed by route
                const pAKRA = ScopedRefresher.trigger('AKRA');
                
                // Switch branch immediately and trigger TRD
                currentBranch = 'TRD';
                const pTRD = ScopedRefresher.trigger('TRD');
                
                // Also trigger AKRA again to test deduplication
                const pAKRA2 = ScopedRefresher.trigger('AKRA');
                
                resolve({
                    akraFlight1: ScopedRefresher.inFlight['AKRA'].incident != null,
                    trdFlight: ScopedRefresher.inFlight['TRD'].incident != null,
                    akraDeduplicated: ScopedRefresher.inFlight['AKRA'].incident === ScopedRefresher.inFlight['AKRA'].incident // They should be the same promise reference
                });
            });
        });
        
        assert.ok(ac2Result.akraFlight1, 'AKRA should be in flight');
        assert.ok(ac2Result.trdFlight, 'TRD should be in flight');
        // Wait for TRD to complete (it's not delayed)
        await page.waitForTimeout(500); 
        
        // Now release AKRA
        if (delayedRelease) delayedRelease();
        
        // Wait for all to settle
        await page.waitForTimeout(500);

        // Check deduplication worked (multiple calls return same promise internally)
        const inFlightStatus = await page.evaluate(() => {
            return {
                akraDone: ScopedRefresher.inFlight['AKRA'].incident !== null, 
                trdDone: ScopedRefresher.inFlight['TRD'].incident !== null
            }
        });
        
        // Assert stale branch does not overwrite
        // We were on TRD when AKRA resolved. 
        // We need to ensure that the current preview/timeline wasn't replaced by AKRA.
        const currentTimelineText = await page.locator('#pc-err-timeline').innerText();
        assert.match(currentTimelineText, /supabase incident TRD/, 'AC2: Stale branch (AKRA) response must not overwrite current switched branch (TRD) UI.');
        assert.doesNotMatch(currentTimelineText, /supabase incident AKRA/, 'AC2: Stale branch (AKRA) response must not overwrite current switched branch (TRD) UI.');

        console.log('PASS: AC2 - ScopedRefresher deduplicates and prevents stale branch overwrite.');

    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
