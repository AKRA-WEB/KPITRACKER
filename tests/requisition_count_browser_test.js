const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require(path.resolve(__dirname, '../../SOP/node_modules/playwright'));
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const view = html.slice(html.indexOf('<div id="view-billcount"'), html.indexOf('            <!-- Vendor Bills Card')) + '</div>';
const controller = html.slice(html.indexOf('        const LINE_REQUISITION_API_URL'), html.indexOf('        function applyAkraWorkloadDraft'));
(async () => {
    const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    try {
        const page = await browser.newPage({viewport:{width:390,height:844}});
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.setContent(view);
        await page.addScriptTag({content: `function esc(value) {const el=document.createElement('span'); el.textContent=String(value); return el.innerHTML;} function syncAppRecordDate() {}\n` + controller});
        assert.equal(await page.locator('#live-bill-count').innerText(), '—');
        await page.evaluate(() => {
            window.readCalls = 0;
            window.fetch = async () => {window.readCalls++; return {ok:true,json:async()=>({success:true,requisitions:[
                {uid:'1',status:'done',doneBy:'hidden actor',requester:'staff A',itemsSummary:'Milk 12',rawText:'original message'},
                {uid:'2',status:'ของหมด',requester:'staff B',itemsSummary:'Flour 2'},
                {uid:'1',status:'waiting'}
            ]})};};
        });
        await page.locator('#record-date-billcount').fill('2026-09-09');
        await page.getByRole('button', {name:'รีเฟรชข้อมูล'}).click();
        await page.waitForFunction(() => document.getElementById('live-bill-count').innerText === '2');
        const list = page.locator('#live-bill-list-cards');
        assert.equal(await list.locator(':scope > div').count(), 2);
        assert.doesNotMatch(await page.locator('#view-billcount').innerText(), /จัดเสร็จ|ของขาด|อัตราจ่าย|Reaction|hidden actor/);
        assert.equal(await page.locator('#view-billcount button').count(), 1, 'Only refresh, no mutation controls');
        await page.getByText('ข้อความต้นทาง', {exact:true}).click();
        assert.ok(await page.getByText('original message', {exact:true}).isVisible());
        await page.evaluate(() => { window.fetch = async () => { throw new Error('offline'); }; });
        await page.getByRole('button', {name:'รีเฟรชข้อมูล'}).click();
        await page.waitForFunction(() => document.getElementById('live-bill-read-state').innerText.includes('ไม่สำเร็จ'));
        assert.equal(await page.locator('#live-bill-count').innerText(), '—');
        assert.deepEqual(errors, []);
        console.log('PASS actual count view/controller: refresh, records, original text disclosure, no status UI, offline state, zero page errors');
    } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
