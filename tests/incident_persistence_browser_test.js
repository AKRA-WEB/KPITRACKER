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
    const requests = [];
    let retryFailureRemaining = true;
    const persistedByBranch = { AKRA: new Map(), TRD: new Map() };
    const server = await startServer();
    const browser = await chromium.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('https://script.google.com/macros/s/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: '[]'
    }));
    await page.route('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/kpi-api', async route => {
        const payload = route.request().postDataJSON();
        requests.push(payload);
        if (payload.action === 'saveIncident') {
            if (payload.incident.note === 'retain this note' && retryFailureRemaining) {
                retryFailureRemaining = false;
                return route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 'error', reason: 'database_error' })
                });
            }
            if (payload.incident.note === 'single flight') {
                await new Promise(resolve => setTimeout(resolve, 120));
            }
            const zeroConfirmed = payload.incident.kind === 'zero';
            const errors = zeroConfirmed ? [{
                ...payload.incident, emp: 'SYSTEM', displayNote: '', createdBy: '250013'
            }] : [{
                ...payload.incident, emp: payload.incident.participants[0], displayNote: payload.incident.note, createdBy: '250013'
            }];
            persistedByBranch[payload.branch].set(payload.date, {
                date: payload.date,
                incidents: zeroConfirmed ? [] : [payload.incident],
                errors,
                zeroConfirmed
            });
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'success',
                    incidents: payload.incident.kind === 'zero' ? [] : [payload.incident],
                    errors,
                    zeroConfirmed
                })
            });
        }
        if (payload.action === 'getIncidentData') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success', records: [...persistedByBranch[payload.branch].values()] })
            });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', records: [] }) });
    });

    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?mock=1`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('system-loading').classList.contains('hidden'));
        await page.evaluate(() => {
            sessionToken = 'signed-main-token';
            currentUser = '250013';
            currentRoles = ['ADMIN'];
            document.getElementById('app-content').classList.remove('hidden');
            document.getElementById('custom-modal').classList.add('hidden');
        });

        for (const [branch, date, note] of [
            ['TRD', '2026-08-23', 'TRD regression case'],
            ['AKRA', '2026-08-24', 'AKRA regression case']
        ]) {
            await page.evaluate(({ branch, date }) => {
                currentBranch = branch;
                recordedErrorCases = [];
                incidentZeroConfirmed = false;
                document.querySelectorAll('.app-record-date').forEach(input => { input.value = date; });
                renderErrSeverity();
                renderErrEmpChips();
                renderErrTimeline();
                renderErrTeamHp();
                switchTab('error');
            }, { branch, date });
            await page.locator('#pc-err-note-input').fill(note);
            await page.evaluate(() => {
                selectedErrWorker = getBranchActiveRoster(currentBranch)[0];
                renderErrEmpChips();
            });
            await page.getByRole('button', { name: 'บันทึกเคสความผิดพลาดทันที' }).click();

            const request = requests.filter(item => item.action === 'saveIncident').at(-1);
            assert.ok(request, `${branch} visible Incident button must call the authenticated persistence API`);
            assert.equal(request.token, 'signed-main-token');
            assert.equal(request.branch, branch);
            assert.equal(request.date, date);
            assert.equal(request.incident.note, note);
            assert.match(request.incident.caseId, /^ERR-/);
            assert.equal(await page.locator('#err-case-count').innerText(), '1 เคส');
            assert.match(await page.locator('#pc-err-timeline').innerText(), new RegExp(note));
            assert.equal(await page.locator('#pc-err-note-input').inputValue(), '', 'confirmed save may clear the note');
        }

        await page.evaluate(() => {
            const date = formatDateKeyLocal(new Date());
            const cachedCase = {
                kind: 'case', caseId: `ERR-${date}-cached-1`, worker: 'ท็อป', participants: ['ท็อป'],
                category: 'trd_store', type: 'จัดบิลผิด', penalty: 5, note: 'fresh cached Incident', time: '09:00 น.'
            };
            localStorage.setItem('kpiData_TRD', JSON.stringify([{
                date, branch: 'TRD', errors: [], incidentCases: [cachedCase], zeroErrorsConfirmed: false
            }]));
            localStorage.setItem('kpiData_TRD_ts', String(Date.now()));
            currentBranch = 'TRD';
            recordedErrorCases = [];
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = date; });
            initApp('TRD', ['TRD']);
        });
        assert.equal(await page.locator('#err-case-count').innerText(), '1 เคส', 'fresh cached startup must hydrate Incident state');
        assert.match(await page.locator('#pc-err-timeline').innerText(), /fresh cached Incident/);

        await page.evaluate(async () => {
            currentBranch = 'TRD';
            localStorage.removeItem('kpiData_TRD');
            localStorage.removeItem('kpiData_TRD_ts');
            recordedErrorCases = [];
            incidentZeroConfirmed = false;
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = '2026-08-23'; });
            await syncDataFromSheet();
        });
        assert.equal(await page.locator('#err-case-count').innerText(), '1 เคส', 'server read must hydrate the selected TRD day');
        assert.match(await page.locator('#pc-err-timeline').innerText(), /TRD regression case/);

        await page.evaluate(() => {
            currentBranch = 'TRD';
            recordedErrorCases = [];
            incidentZeroConfirmed = false;
            pendingIncidentCaseId = '';
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = '2026-08-22'; });
            selectedErrWorker = getBranchActiveRoster('TRD')[0];
            renderErrSeverity();
            renderErrEmpChips();
            renderErrTimeline();
            renderErrTeamHp();
        });
        await page.locator('#pc-err-note-input').fill('retain this note');
        await page.getByRole('button', { name: 'บันทึกเคสความผิดพลาดทันที' }).click();
        await page.waitForFunction(() => !document.getElementById('custom-modal').classList.contains('hidden'));
        const firstAttempt = requests.filter(item => item.action === 'saveIncident' && item.incident.note === 'retain this note')[0];
        assert.equal(await page.locator('#pc-err-note-input').inputValue(), 'retain this note', 'failed save must retain user input');
        assert.equal(await page.locator('#err-case-count').innerText(), '0 เคส', 'failed save must not create an in-memory success');
        await page.evaluate(() => {
            document.getElementById('custom-modal').classList.add('hidden');
            releaseFocusFromModal('custom-modal');
        });
        await page.getByRole('button', { name: 'บันทึกเคสความผิดพลาดทันที' }).click();
        const retryAttempts = requests.filter(item => item.action === 'saveIncident' && item.incident.note === 'retain this note');
        assert.equal(retryAttempts.length, 2);
        assert.equal(retryAttempts[1].incident.caseId, firstAttempt.incident.caseId, 'retry must reuse the stable case ID');
        assert.equal(await page.locator('#err-case-count').innerText(), '1 เคส');

        await page.evaluate(async () => {
            recordedErrorCases = [];
            incidentZeroConfirmed = false;
            pendingIncidentCaseId = '';
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = '2026-08-20'; });
            document.getElementById('pc-err-note-input').value = 'single flight';
            await Promise.all([saveErrorCaseFromPreview(), saveErrorCaseFromPreview()]);
        });
        assert.equal(
            requests.filter(item => item.action === 'saveIncident' && item.incident.note === 'single flight').length,
            1,
            'duplicate submit while a save is in flight must create one request'
        );

        await page.evaluate(() => {
            recordedErrorCases = [];
            incidentZeroConfirmed = false;
            document.querySelectorAll('.app-record-date').forEach(input => { input.value = '2026-08-21'; });
            renderErrTimeline();
            renderErrTeamHp();
        });
        await page.getByRole('button', { name: /ยืนยัน Zero Error/ }).click();
        await page.waitForFunction(() => incidentZeroConfirmed === true);
        const zeroRequest = requests.filter(item => item.action === 'saveIncident' && item.incident.kind === 'zero').at(-1);
        assert.ok(zeroRequest, 'Zero Error control must persist its confirmation');
        assert.equal(zeroRequest.branch, 'TRD');
        assert.equal(zeroRequest.date, '2026-08-21');
        assert.match(await page.locator('#pc-err-timeline').innerText(), /ยืนยันแล้วว่าไม่พบข้อผิดพลาด/);

        console.log('PASS: visible TRD and AKRA Incident QC saves round-trip through the authenticated API.');
        console.log('PASS: failed Incident saves retain input and retry the same stable case ID.');
        console.log('PASS: visible Zero Error confirmation persists through the authenticated API.');
        console.log('PASS: authoritative Incident read hydrates the selected day after cache loss.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
