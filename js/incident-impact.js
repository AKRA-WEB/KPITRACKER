/* Explicit Incident type/impact model; legacy scores are read-only history. */
(function (root) {
    'use strict';
    const labels = { contained: 'แก้ไขทันก่อนส่ง / ก่อนเกิดผลกระทบ', escaped_internal: 'ออกจากจุดงานแล้ว แต่ยังไม่ถึงลูกค้า',
        reached_customer: 'ถึงลูกค้าแล้ว / กระทบลูกค้าแล้ว', unknown: 'ยังไม่ทราบ / รอตรวจสอบ', not_applicable: 'ไม่เกี่ยวกับขั้นตอนส่งมอบ' };
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const state = { branch: '', date: '', typeId: '', impact: '', revision: 0, editing: null, pending: null, busy: false };
    const model = () => typeof KPI_SYSTEM_CONFIG !== 'undefined' ? KPI_SYSTEM_CONFIG?.incidentModel : null;
    const enabled = () => model()?.schemaVersion === 3 && (model().active === true || Boolean(model().activatedAt));
    const byId = id => document.getElementById(id);
    const types = () => model()?.branches?.[currentBranch]?.types || [];
    const selected = () => types().find(t => t.id === state.typeId && t.active);
    const isNew = row => row?.schemaVersion === 3 && row?.scoringMode === 'none';
    function isAchievement(row) {
        return !isNew(row) && String(row?.type || '').startsWith('ผลงาน: ')
            && ['good_catch','team_support','kaizen','special','service','5s'].includes(row?.category)
            && row?.responsibility === 'process' && Number(row?.penalty) === 0;
    }
    function legacyImpact(row) {
        let meta={};const note=String(row.note || '');const marker=note.match(/\[(?:AKRA|TRD)_CASE:([^\]]+)\]/);
        if(marker){try{meta=JSON.parse(decodeURIComponent(marker[1]));}catch{ /* Unreadable history stays unknown. */ }}
        const type=meta.type || row.type;
        if(['หยิบผิด ถึงลูกค้าแล้ว','ส่งถึงลูกค้าแล้ว','จัดสินค้าผิด (ถึงลูกค้าแล้ว)','จัดสินค้าผิด (ถึงลูกค้า / ร้องเรียน)','ปล่อยของผิดถึงลูกค้า (Checker)'].includes(type) || note.startsWith('[ถึงลูกค้าแล้ว]'))return 'reached_customer';
        if(['หยิบผิด แก้ทันก่อนจัดส่ง','แก้ไขได้ก่อนจัดส่ง','จัดสินค้าผิด (แก้ไขทัน)','จัดสินค้าผิด (ตรวจพบและแก้ทัน)'].includes(type) || note.startsWith('[แก้ไขได้ก่อนส่ง]'))return 'contained';
        if(type==='หยิบผิด ถึงหน้าร้านแล้ว')return 'escaped_internal';
        return 'unknown';
    }
    function summarize(rows) {
        const unique = new Map();
        (rows || []).forEach((row, i) => {
            if (row.kind === 'zero' || row.caseId === 'NO_ERRORS' || row.type === 'ไม่มีความผิดพลาด' || isAchievement(row) || row.cancelled) return;
            const key = `${row.branch || ''}|${row.caseId || `legacy-${i}`}`;
            if (!unique.has(key)) unique.set(key, row);
        });
        const result = { total: unique.size, impact: Object.fromEntries(Object.keys(labels).map(k => [k,0])), types: {}, people: {} };
        for (const row of unique.values()) {
            const impact = isNew(row) && labels[row.impact] ? row.impact : legacyImpact(row);
            result.impact[impact]++;
            const key = row.typeId || row.type || 'ไม่ระบุประเภท';
            result.types[key] = (result.types[key] || 0) + 1;
            for (const name of new Set(row.participants || [row.worker || row.emp].filter(Boolean))) result.people[name] = (result.people[name] || 0) + 1;
        }
        return result;
    }
    function dirty() { if (!state.busy) state.pending = null; }
    function choose(id) { if (state.busy) return; dirty(); state.typeId=id; state.impact=''; state.revision=model().catalogRevision; render(); }
    function impact(value) { if (state.busy || !selected()?.impacts.includes(value)) return; dirty(); state.impact=value; renderOptions(); }
    function reset() {
        if (state.busy) return;
        Object.assign(state,{typeId:'',impact:'',editing:null,pending:null});
        if (byId('pc-err-note-input')) byId('pc-err-note-input').value='';
        if (byId('impact-reason')) byId('impact-reason').value='';
        if (byId('impact-detector')) byId('impact-detector').value='';
        if (byId('inc-quick-search')) byId('inc-quick-search').value='';
        byId('inc-success-card')?.classList.add('hidden'); render(); renderErrEmpChips(); summary();
    }
    function render() {
        if (!enabled()) return;
        const body=byId('inc-form-body'); if (!body) return;
        const date=byId('record-date-error')?.value || '';
        if (state.branch !== currentBranch || state.date !== date || body.dataset.model !== '3') {
            Object.assign(state,{branch:currentBranch,date,typeId:'',impact:'',editing:null,pending:null});
            byId('inc-success-card')?.classList.add('hidden');
            body.dataset.model='3';
            body.innerHTML=`<div id="zero-error-wrapper"><button type="button" id="btn-confirm-zero-errors" onclick="handleZeroErrorClick()" class="w-full p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800">วันนี้ตรวจแล้ว ไม่พบข้อผิดพลาด <span id="zero-error-role-badge"></span></button></div>
                <fieldset id="impact-fields" class="space-y-3">
                <section class="bg-white p-4 rounded-2xl border space-y-3"><label for="inc-quick-search" class="font-bold text-sm">1. เกิดอะไรขึ้น?</label>
                <input id="inc-quick-search" placeholder="ค้นหาประเภทความผิดพลาด" class="w-full border rounded-xl p-3 text-sm" oninput="KpiIncident.search(this.value)">
                <p class="text-xs text-slate-500">ใช้บ่อย · เลือกจากรายการของสาขา</p><div id="inc-quick-templates" class="grid grid-cols-2 gap-2"></div></section>
                <section class="bg-white p-4 rounded-2xl border space-y-3"><h3 class="font-bold text-sm">2. ผลกระทบ / พบตอนไหน?</h3><div id="inc-impact-options" class="space-y-2"></div></section>
                <section class="bg-white p-4 rounded-2xl border space-y-3"><h3 id="inc-worker-label" class="font-bold text-sm">3. ใครเกี่ยวข้อง?</h3>
                <p class="text-xs text-slate-500">ผู้เกี่ยวข้องยังไม่ถือว่าเป็นผู้ผิดโดยอัตโนมัติ</p><span id="inc-worker-selected-badge"></span><div id="pc-err-emp-chips" class="grid grid-cols-2 gap-2"></div>
                <label class="block text-xs">ลักษณะความรับผิดชอบ<select id="impact-responsibility" class="w-full border rounded-lg p-2" onchange="selectedIncidentResponsibility=this.value;KpiIncident.dirty();KpiIncident.summary()"><option value="individual">รายบุคคล</option><option value="team">ทีม</option><option value="process">กระบวนการ / ระบบ</option><option value="pending">รอตรวจสอบ</option></select></label>
                <label class="block text-xs">ผู้ตรวจพบ (ไม่บังคับ)<select id="impact-detector" class="w-full border rounded-lg p-2" onchange="KpiIncident.dirty()"></select></label></section>
                <section class="bg-white p-4 rounded-2xl border space-y-3"><label for="pc-err-note-input" class="font-bold text-sm">4. รายละเอียด / เลขบิล (ไม่บังคับ)</label>
                <textarea id="pc-err-note-input" maxlength="1000" class="w-full border rounded-lg p-3 text-sm" oninput="KpiIncident.dirty()"></textarea>
                <label id="impact-reason-label" class="hidden block text-xs">เหตุผลที่แก้ไข<input id="impact-reason" maxlength="1000" class="w-full border rounded-lg p-2" oninput="KpiIncident.dirty()"></label></section>
                <p id="impact-summary" role="status" class="p-3 rounded-xl bg-blue-50 text-blue-900 text-sm"></p>
                <button id="btn-save-error-preview" type="button" onclick="saveErrorCaseFromPreview()" class="w-full rounded-xl p-4 bg-red-600 text-white font-bold">บันทึกเหตุการณ์</button>
                <button type="button" onclick="KpiIncident.reset()" class="w-full p-2 text-slate-600">ล้างรายการ / ยกเลิกการแก้ไข</button></fieldset>
                <button type="button" onclick="KpiIncident.history()" class="w-full p-3 border rounded-xl text-sm">ประวัติการบันทึกและแก้ไขของวันที่เลือก</button>`;
            renderErrEmpChips();
            byId('impact-detector').innerHTML='<option value="">ไม่ระบุ / ตรวจพบเอง</option>'+getBranchActiveRoster(currentBranch).map(n=>`<option>${escape(n)}</option>`).join('');
            byId('impact-responsibility').value=selectedIncidentResponsibility || 'individual';
        }
        search(byId('inc-quick-search')?.value || ''); renderOptions();
        byId('impact-reason-label').classList.toggle('hidden',!state.editing);
        byId('btn-save-error-preview').textContent=state.editing?'บันทึกการแก้ไข':'บันทึกเหตุการณ์';
        renderConfirmZeroErrorsButton();
        byId('impact-fields').disabled=state.busy;
    }
    function search(query) {
        const q=String(query || '').trim().toLowerCase();
        const list=types().filter(t=>t.active && (q?t.name.toLowerCase().includes(q):t.quick));
        byId('inc-quick-templates').innerHTML=list.map(t=>`<button type="button" data-type-id="${escape(t.id)}" onclick="KpiIncident.choose('${escape(t.id)}')" aria-pressed="${t.id===state.typeId}" class="p-3 border rounded-xl text-left text-xs ${t.id===state.typeId?'bg-blue-50 border-blue-500':'bg-white'}">${escape(t.name)}</button>`).join('') || '<p class="text-xs text-slate-500">ไม่พบรายการ ลองค้นหาประเภทอื่น</p>';
    }
    function renderOptions() {
        const type=selected();
        byId('inc-impact-options').innerHTML=type?type.impacts.map(i=>`<button type="button" data-impact="${i}" onclick="KpiIncident.impact('${i}')" aria-pressed="${state.impact===i}" class="w-full p-3 rounded-xl border text-left text-sm ${state.impact===i?'bg-amber-50 border-amber-500':'bg-white'}">${escape(labels[i])}</button>`).join(''):'<p class="text-xs text-slate-500">เลือกประเภทก่อน แล้วระบุผลกระทบ</p>';
        summary();
    }
    function summary() {
        if (!byId('impact-summary')) return;
        const people=state.editing&&!state.participantsChanged?state.editing.participants:selectedErrWorker==='ทุกคนในกะ'?getBranchActiveRoster(currentBranch):[selectedErrWorker].filter(Boolean);
        byId('impact-summary').textContent=`${currentBranch} · ${selected()?.name || 'ยังไม่เลือกประเภท'} · ${labels[state.impact] || 'ยังไม่เลือกผลกระทบ'} · ${people.join(', ') || 'ยังไม่เลือกผู้เกี่ยวข้อง'}`;
    }
    function message(error) {
        return {catalog_changed:'รายการมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วเลือกอีกครั้ง',incident_conflict:'รายการนี้มีการแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่ก่อนแก้ไข',incident_update_required:'กรุณาโหลดแอปเวอร์ชันล่าสุดก่อนบันทึก',incident_model_unavailable:'ระบบบันทึกใหม่ยังไม่เปิดใช้งาน',same_day_required:'แก้ไขได้เฉพาะรายการของวันนี้'}[error?.message] || error?.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
    }
    function applyResult(branch,date,result) {
        applyIncidentSaveResultToCache(date,branch,result);
        if(currentBranch===branch && byId('record-date-error')?.value===date){recordedErrorCases=result.incidents;incidentZeroConfirmed=result.zeroConfirmed;renderErrTimeline();renderErrTeamHp();}
        loadDashboardData();updateDailyDashboard();
    }
    async function save() {
        if(state.busy)return;
        const type=selected(),date=byId('record-date-error')?.value;
        if(!type || !type.impacts.includes(state.impact))return showToast('กรุณาเลือกประเภทและผลกระทบให้ครบ',true);
        if(state.revision!==model().catalogRevision)return showToast('รายการมีการเปลี่ยนแปลง กรุณาเลือกใหม่',true);
        if(!date || !selectedErrWorker)return showToast('กรุณาเลือกวันที่และผู้เกี่ยวข้อง',true);
        const reason=byId('impact-reason').value.trim();if(state.editing&&!reason)return showToast('กรุณาระบุเหตุผลที่แก้ไข',true);
        if(!state.pending){
            const now=new Date();
            const preservePeople=state.editing && !state.participantsChanged;
            const roster=preservePeople?[...state.editing.participants]:getBranchActiveRoster(currentBranch);
            state.pending={branch:currentBranch,date,expectedRevision:state.editing?.revision || 0,reason,incident:{
                schemaVersion:3,scoringMode:'none',kind:'case',caseId:state.editing?.caseId || `ERR-${date}-${Date.now()}-${Math.floor(Math.random()*100000)}`,
                typeId:type.id,impact:state.impact,catalogRevision:state.revision,worker:preservePeople?state.editing.worker:selectedErrWorker,
                participants:preservePeople?[...state.editing.participants]:selectedErrWorker==='ทุกคนในกะ'?roster:[selectedErrWorker],roster,
                responsibility:selectedIncidentResponsibility || 'individual',detectedBy:byId('impact-detector').value,
                note:byId('pc-err-note-input').value.trim(),time:state.editing?.time || `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} น.`}};
        }
        const request=JSON.parse(JSON.stringify(state.pending));state.busy=true;byId('impact-fields').disabled=true;
        const dateInputs=[...document.querySelectorAll('.app-record-date')].map(el=>({el,disabled:el.disabled}));dateInputs.forEach(({el})=>el.disabled=true);
        try{
            const result=state.editing?await AkraSupabaseKPI.updateIncident(sessionToken,request):await AkraSupabaseKPI.saveIncident(sessionToken,request.branch,request.date,request.incident);
            const saved=result.incidents.find(i=>i.caseId===request.incident.caseId);if(!saved)throw Error('invalid_incident_response');
            applyResult(request.branch,request.date,result);
            if(currentBranch===request.branch && byId('record-date-error').value===request.date){
                byId('inc-success-summary').textContent=`${request.branch} · ${saved.type} · ${labels[saved.impact]} · ${(saved.participants || [saved.worker]).join(', ')}`;
                byId('inc-success-card').classList.remove('hidden');
                state.pending=null;state.editing=null;state.typeId='';state.impact='';byId('pc-err-note-input').value='';render();
            }
            showToast(`บันทึกเหตุการณ์ ${request.branch} แล้ว`);
        }catch(e){showToast(message(e),true);}finally{state.busy=false;if(byId('impact-fields'))byId('impact-fields').disabled=false;dateInputs.forEach(({el,disabled})=>el.disabled=disabled);}
    }
    function edit(caseId){
        const row=recordedErrorCases.find(r=>r.caseId===caseId);if(!row || isAchievement(row) || state.busy)return;
        const date=byId('record-date-error').value;state.branch=currentBranch;state.date=date;
        state.editing=row;state.participantsChanged=false;state.typeId=row.typeId || types().find(t=>t.active && t.legacyNames?.includes(row.type))?.id || '';state.impact=isNew(row)?row.impact:'';state.revision=model().catalogRevision;state.pending=null;
        selectedErrWorker=row.worker;selectedIncidentResponsibility=row.responsibility;render();renderErrEmpChips();
        const detector=byId('impact-detector');if(row.detectedBy && !Array.from(detector.options).some(o=>o.value===row.detectedBy))detector.add(new Option(row.detectedBy,row.detectedBy));
        byId('pc-err-note-input').value=row.note || '';byId('impact-detector').value=row.detectedBy || '';byId('impact-responsibility').value=row.responsibility;
        byId('impact-reason').value='';if(!isNew(row))showToast('รายการเดิม: เลือกประเภทและผลกระทบใหม่ คะแนนเดิมจะเก็บไว้ในประวัติ');byId('inc-form-body').scrollIntoView({block:'start'});
    }
    function dialog(title){
        byId('impact-dialog')?.remove();const d=document.createElement('dialog');d.id='impact-dialog';d.className='rounded-2xl p-5 w-full max-w-xl';
        d.innerHTML=`<h3 class="font-bold mb-3">${escape(title)}</h3><div id="impact-dialog-body" class="space-y-3 max-h-96 overflow-auto"></div><button type="button" class="mt-4 p-2 border rounded-lg" onclick="document.getElementById('impact-dialog').close()">ปิด</button>`;
        document.body.appendChild(d);d.showModal();return byId('impact-dialog-body');
    }
    function cancel(caseId){
        const row=recordedErrorCases.find(r=>r.caseId===caseId);if(!row)return;
        const branch=currentBranch,date=byId('record-date-error').value;
        const body=dialog('ลบ Incident โดยเก็บประวัติ');
        body.innerHTML=`<p class="text-sm">${escape(row.type)}</p><label class="block text-sm">เหตุผล<textarea id="impact-cancel-reason" maxlength="1000" class="w-full border p-2"></textarea></label><button id="impact-cancel-submit" type="button" class="p-3 bg-red-600 text-white rounded-lg">ยืนยันลบรายการ</button>`;
        byId('impact-cancel-submit').onclick=async()=>{
            const reason=byId('impact-cancel-reason').value.trim();if(!reason)return;
            const button=byId('impact-cancel-submit');button.disabled=true;
            try{const result=await AkraSupabaseKPI.deleteIncident(sessionToken,branch,date,caseId,row.revision || 0,reason);applyResult(branch,date,result);byId('impact-dialog').close();}
            catch(e){showToast(message(e),true);}finally{button.disabled=false;}
        };
    }
    async function history(caseId=''){
        const body=dialog('ประวัติเหตุการณ์และการแก้ไข');body.textContent='กำลังโหลด...';
        try{const result=await AkraSupabaseKPI.getIncidentHistory(sessionToken,currentBranch,byId('record-date-error').value,caseId);
            body.innerHTML=result.revisions.map(r=>{const before=r.before_entries?.[0],after=r.after_entries?.[0];return `<article class="border rounded-lg p-3 text-xs"><p>${escape(r.created_at)} · ${escape(r.actor)} · ครั้งที่ ${r.revision}</p><p>${escape({create:'บันทึก',update:'แก้ไข',cancel:'ลบ'}[r.action])}: ${escape((after||before)?.type)}</p>${before?`<p>เดิม: ${escape(labels[before.impact]||'ข้อมูลเดิม')} · ${escape(before.displayNote)}</p>`:''}${after?`<p>ใหม่: ${escape(labels[after.impact]||'ข้อมูลเดิม')} · ${escape(after.displayNote)}</p>`:''}<p>${escape(r.reason)}</p></article>`;}).join('')||'ยังไม่มีประวัติการแก้ไข';
        }catch(e){body.textContent=message(e);}
    }
    function timeline(){
        const rows=recordedErrorCases.filter(r=>!isAchievement(r));byId('err-case-count').textContent=`${rows.length} เคส`;
        const today=byId('record-date-error').value===formatDateKeyLocal(new Date());
        byId('pc-err-timeline').innerHTML=rows.map(r=>`<article class="border rounded-xl p-3 space-y-2 text-xs"><p class="font-bold">${escape(r.type)} · ${isNew(r)?escape(labels[r.impact]):'ข้อมูลเดิม'}</p><p>${escape(r.worker)} · ${escape(r.time)}</p><p>${escape(r.note)}</p>${!isNew(r)?`<p class="text-slate-500">คะแนนเดิม: -${Number(r.penalty)||0} HP</p>`:''}<div class="flex gap-3">${`<button class="px-3 py-2 rounded-lg border border-blue-200 text-blue-700" onclick="KpiIncident.edit('${escape(r.caseId)}')">แก้ไข</button>`}${`<button class="px-3 py-2 rounded-lg border border-red-200 text-red-700" onclick="KpiIncident.cancel('${escape(r.caseId)}')">ลบ</button>`}<button onclick="KpiIncident.history('${escape(r.caseId)}')">ประวัติ</button></div></article>`).join('')||`<p class="text-sm text-slate-500">${incidentZeroConfirmed?'ตรวจแล้ว ไม่พบข้อผิดพลาด':'ยังไม่มีเหตุการณ์ที่บันทึก'}</p>`;
        const positive=recordedErrorCases.filter(isAchievement);
        if(positive.length)byId('pc-err-timeline').innerHTML+=`<h3 class="font-bold text-emerald-800 pt-3">ผลงาน / Good Catch · ${positive.length} รายการ</h3>`+positive.map(r=>`<article class="border border-emerald-200 bg-emerald-50 rounded-xl p-3 text-xs space-y-2"><p class="font-bold">${escape(r.type)}</p><p>${escape(r.worker)} · ${escape(r.time)}</p><p>${escape(r.note)}</p>${today?`<button onclick="KpiIncident.cancel('${escape(r.caseId)}')">ยกเลิกผลงาน</button>`:''}</article>`).join('');
    }
    function metrics(rows){const s=summarize(rows);return `<div class="col-span-2 grid grid-cols-2 gap-2 text-sm"><p>เหตุการณ์ <strong>${s.total}</strong> เคส</p><p>ถึงลูกค้า <strong>${s.impact.reached_customer}</strong></p><p>แก้ทัน <strong>${s.impact.contained}</strong></p><p>ยังไม่ทราบ <strong>${s.impact.unknown}</strong></p><p>กระทบภายใน <strong>${s.impact.escaped_internal}</strong></p><p>ไม่เกี่ยวกับส่งมอบ <strong>${s.impact.not_applicable}</strong></p></div>`;}
    function detail(row,branch){
        let meta=null,note=row.displayNote ?? row.note ?? '';
        if(!isNew(row)){
            const parsed=branch==='TRD'?parseTrdCaseNote(row.note):parseAkraCaseNote(row.note);
            if(!isNew(parsed.meta))return null;meta=parsed.meta;note=parsed.note;
        }
        const data={...row,...meta};
        return {schemaVersion:3,scoringMode:'none',penalty:0,typeId:data.typeId,type:data.type,impact:data.impact,
            isReachedCustomer:data.impact==='reached_customer',isFixedBefore:data.impact==='contained',
            caseId:data.caseId,meta:data,cleanNote:note,core:data.category,coreLabel:getIncidentCategoryLabel(data.category,branch),isAkraCase:branch==='AKRA'};
    }
    let adminDraft=null;
    function admin(){
        const host=byId('admin-incident-categories-list');
        if(!host)return;
        if(!adminDraft)adminDraft=JSON.parse(JSON.stringify(model()));
        const branch=ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA',data=adminDraft.branches[branch];
        byId('admin-incident-heading').textContent='ตั้งค่าประเภทและผลกระทบ';byId('admin-incident-description').textContent='เพิ่มประเภท เปลี่ยนชื่อ หรือปิดใช้งาน โดยเก็บข้อมูลเดิมไว้';
        byId('btn-save-admin-incidents').textContent='บันทึกประเภทและผลกระทบ';
        host.innerHTML=`<p class="text-sm mb-3">หมวดหมู่</p><div class="grid grid-cols-2 gap-2 mb-4">${data.categories.map(c=>`<label class="text-xs">${escape(c.key)}<input aria-label="ชื่อหมวด" value="${escape(c.label)}" class="w-full border p-2 rounded" onchange="KpiIncident.adminCategory('${c.key}',this.value)"></label>`).join('')}</div><p class="text-sm mb-3">ประเภทและผลกระทบ · รหัสรายการคงเดิมเมื่อเปลี่ยนชื่อ</p>`+data.types.map(t=>`<article class="border rounded-lg p-3 mb-2 space-y-2"><input aria-label="ชื่อประเภท" value="${escape(t.name)}" class="w-full border rounded p-2" onchange="KpiIncident.adminChange('${t.id}','name',this.value)">
            <select aria-label="หมวด" class="border p-2" onchange="KpiIncident.adminChange('${t.id}','category',this.value)">${data.categories.map(c=>`<option value="${escape(c.key)}" ${c.key===t.category?'selected':''}>${escape(c.label)}</option>`).join('')}</select>
            <label><input type="checkbox" ${t.active?'checked':''} onchange="KpiIncident.adminChange('${t.id}','active',this.checked)"> ใช้งาน</label>
            <label><input type="checkbox" ${t.quick?'checked':''} onchange="KpiIncident.adminChange('${t.id}','quick',this.checked)"> ใช้บ่อย</label>
            <div class="flex flex-wrap gap-2 text-xs">${Object.entries(labels).map(([id,label])=>`<label><input type="checkbox" ${t.impacts.includes(id)?'checked':''} onchange="KpiIncident.adminImpact('${t.id}','${id}',this.checked)"> ${label}</label>`).join('')}</div></article>`).join('')+
            `<button type="button" class="p-3 border rounded-lg" onclick="KpiIncident.adminAdd()">เพิ่มประเภท</button>`;
    }
    function adminChange(id,field,value){const b=ADMIN_SETTINGS_STATE.incidentBranch||'AKRA';const t=adminDraft.branches[b].types.find(t=>t.id===id);if(t)t[field]=value;}
    function adminImpact(id,impact,on){const b=ADMIN_SETTINGS_STATE.incidentBranch||'AKRA';const t=adminDraft.branches[b].types.find(t=>t.id===id);if(t)t.impacts=on?[...new Set([...t.impacts,impact])]:t.impacts.filter(i=>i!==impact);}
    function adminAdd(){const b=ADMIN_SETTINGS_STATE.incidentBranch||'AKRA',d=adminDraft.branches[b];d.types.push({id:`${b.toLowerCase()}-${crypto.randomUUID()}`,name:'ประเภทใหม่',category:d.categories[0].key,active:true,quick:false,impacts:['unknown']});admin();}
    function adminCategory(key,label){const b=ADMIN_SETTINGS_STATE.incidentBranch||'AKRA';adminDraft.branches[b].categories.find(c=>c.key===key).label=label;}
    function adminAddCategory(){if(!adminDraft)admin();const b=ADMIN_SETTINGS_STATE.incidentBranch||'AKRA';adminDraft.branches[b].categories.push({key:`cat_${crypto.randomUUID()}`,label:'หมวดใหม่'});admin();}
    async function adminSave(){try{const r=await AkraSupabaseKPI.saveIncidentCatalog(sessionToken,adminDraft);KPI_SYSTEM_CONFIG.incidentModel=r.configValue;adminDraft=null;admin();showToast('บันทึกประเภทและผลกระทบแล้ว');}catch(e){showToast(message(e),true);}}
    const api={labels,state,enabled,isNew,isAchievement,legacyImpact,summarize,render,choose,impact,search,summary,dirty,reset,save,edit,cancel,history,timeline,metrics,detail,admin,adminChange,adminImpact,adminAdd,adminSave,adminCategory,adminAddCategory};
    if(typeof module==='object'&&module.exports)module.exports=api;else root.KpiIncident=api;
})(typeof window==='undefined'?globalThis:window);
