/**
 * KPI Current Duty Matrix
 * Person-by-duty allocation with primary/secondary toggling, atomic primary demotion,
 * workload weight calculation, capacity limits, headcount targets, and soft disabling.
 */
(function(window) {
    'use strict';

    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(val) {
        return String(val ?? '').replace(/[&<>"']/g, c => ESC_MAP[c] || c);
    }

    function jsArg(value) { return esc(JSON.stringify(String(value))); }

    const vehicles={motorcycle:'มอเตอร์ไซค์',cargo34:'รถเครื่องขนสินค้า 3 ล้อ / 4 ล้อ',car_pickup:'รถยนต์ / รถกระบะ'};
    const drivingStatuses={unknown:'ยังไม่ระบุ',capable:'ขับได้',supervised:'ต้องมีคนประกบ',unable:'ขับไม่ได้'};
    function drivingBadges(uid){
        const skills=state.driving[uid]?.capabilities||{};
        const recorded=Object.keys(vehicles).some(key=>skills[key]&&skills[key]!=='unknown');
        if(!recorded)return '';
        return `<button type="button" onclick="window.KpiDutyMatrix.openPerson(${jsArg(uid)})" aria-label="ดูทักษะขับขี่" title="จิ้มเพื่อดูประเภทรถและสถานะ" class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 bg-emerald-50 text-emerald-800 border-emerald-200"><i class="fa-solid fa-car" aria-hidden="true"></i>ทักษะขับขี่</button>`;
    }

    const state = {
        driving: {},
        drivingFilter: '',
        duties: [],
        assignments: {}, // { [uid]: { [dutyId]: 'primary' | 'secondary' } }
        employees: [],
        revisions: {},
        capacityRevisions: {},
        busy: false,
        capacities: {},  // { [uid]: limitNumber }
        search: '',
        filter: 'all', // 'all' | 'over' | 'free'
        isInitialized: false
    };

    function baseContext(){return window.getKpiTaskContext?.()||{token:null,branch:'',employees:[],can:()=>false};}
    function context(){const c=baseContext();return {...c,branch:state.activeBranch||c.branch};}
    function branches(){const c=baseContext();const privileged=(c.roles||[]).some(role=>['ADMIN','SUPERVISOR'].includes(String(role).trim().toUpperCase()));return [...new Set((privileged?(c.allowedBranches||[c.branch]):[c.branch]).filter(b=>['AKRA','TRD'].includes(b)))];}
    function scope(){return branches().includes(state.branchScope)||state.branchScope==='ALL'&&branches().length>1?state.branchScope:baseContext().branch;}
    function scopedBranches(){return scope()==='ALL'?branches():[scope()];}
    function renderBranchScope(){const el=document.getElementById('kb-duty-branch-scope');if(el){el.innerHTML=branches().map(b=>`<option value="${b}">${b}</option>`).join('')+(branches().length>1?'<option value="ALL">ทั้งสองสาขา</option>':'');el.value=scope();}}
    async function setBranchScope(value){if(state.busy)return;if(value!=='ALL'&&!branches().includes(value)||value==='ALL'&&branches().length<2)return;state.branchScope=value;state.activeBranch=null;closeDrawer();await loadDutyMatrix();}
    async function runBranch(branch,method,...args){if(state.busy||!branches().includes(branch)||!state.matrices?.[branch])return;state.activeBranch=branch;applyMatrix(state.matrices[branch]);return window.KpiDutyMatrix[method](...args);}

    function applyMatrix(res){
        if(!Array.isArray(res.catalog)||!Array.isArray(res.assignments))throw Error('invalid_response');
        state.duties=res.catalog.map(d=>({id:d.id,name:d.name,description:d.name,weight:d.weight,target:d.targetHeadcount??null,active:d.isActive!==false,revision:d.revision??0}));
        state.assignments={};state.revisions=res.employeeRevisions||{};state.capacities={};state.capacityRevisions={};
        res.assignments.forEach(a=>{(state.assignments[a.employeeUid]??={})[a.dutyId]=a.assignmentType;});
        (res.capacities||[]).forEach(c=>{state.capacities[c.employeeUid]=c.capacityWeight;state.capacityRevisions[c.employeeUid]=c.revision;});
        state.employees=res.employees||[];
        state.driving=Object.fromEntries((res.drivingCapabilities||[]).map(row=>[row.employeeUid,row]));
    }
    async function write(method,payload,grant='manageDutyAllocations'){
        const c=context(),homeBranch=baseContext().branch;if(state.busy)return false;
        if(!c.token||!c.can(grant)){notify('ไม่มีสิทธิ์จัดการตารางงาน');return false;}
        state.busy=true;
        if(method==='setDutyAssignment')setAssignmentSaving(c.branch,payload,true);
        try{
            const result=await window.AkraSupabaseKPI[method](c.token,{branch:c.branch,...payload});
            if(c.token!==baseContext().token||homeBranch!==baseContext().branch)return false;
            if(method==='setDutyAssignment'&&state.matrices?.[c.branch]&&Array.isArray(result?.catalog)&&Array.isArray(result?.assignments)&&result.employeeRevisions){
                state.loadTicket=(state.loadTicket||0)+1;
                const existing=state.matrices[c.branch];
                state.matrices[c.branch]={...existing,...result,drivingCapabilities:result.drivingCapabilities??existing.drivingCapabilities};
                renderDuties();
            }else await loadDutyMatrix();
            return true;
        }
        catch(err){
            notify(err.reason==='request_timeout'?'รอระบบนานเกินไป สถานะอาจบันทึกแล้ว กรุณารีเฟรชก่อนลองใหม่':'บันทึกไม่สำเร็จ กรุณารีเฟรชข้อมูลก่อนลองอีกครั้ง');
            if(err.reason==='record_conflict')await loadDutyMatrix();
            return false;
        }
        finally{state.busy=false;if(method==='setDutyAssignment')setAssignmentSaving(c.branch,payload,false);}
    }
    function setAssignmentSaving(branch,payload,saving){
        const content=document.getElementById('kb-duty-content');
        for(const button of content?.querySelectorAll('[data-duty-cell]')||[]){
            button.disabled=saving;
            const selected=button.dataset.dutyBranch===branch&&button.dataset.dutyPerson===payload.employeeUid&&button.dataset.dutyId===payload.dutyId;
            if(!selected)continue;
            if(saving){button.dataset.savedHtml=button.innerHTML;button.setAttribute('aria-busy','true');button.innerHTML='<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span class="sr-only">กำลังบันทึกหน้าที่</span>';}
            else{button.removeAttribute('aria-busy');if(button.dataset.savedHtml!==undefined){button.innerHTML=button.dataset.savedHtml;delete button.dataset.savedHtml;}}
        }
    }
    function catalogPayload(d){return {dutyId:d.id,name:d.name,weight:d.weight,targetHeadcount:d.target,isActive:d.active,expectedRevision:d.revision??0};}

    function notify(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else {
            console.log('[Duty Toast]', msg);
        }
    }

    function getPeople(){return state.employees.map(e=>({id:e.employeeUid,uid:e.employeeUid,name:e.name,initial:(e.name||'ก').slice(0,1),area:e.role||'คลัง '+context().branch,limit:state.capacities[e.employeeUid]??null}));}

    function activeDuties() {
        return state.duties.filter(d => d.active);
    }

    function coverage(duty) {
        return getPeople().filter(p => state.assignments[p.id]?.[duty.id]).length;
    }

    function load(personId) {
        return activeDuties().reduce((sum, d) => sum + (state.assignments[personId]?.[d.id] ? d.weight : 0), 0);
    }

    function selectedPeople() {
        const q = state.search.trim().toLowerCase();
        return getPeople().filter(p => {
            if (q && !p.name.toLowerCase().includes(q)) return false;
            if(state.drivingFilter&&state.driving[p.id]?.capabilities?.[state.drivingFilter]!=='capable')return false;
            if (state.filter === 'over' && !(p.limit != null && load(p.id) > p.limit)) return false;
            if (state.filter === 'free' && Object.keys(state.assignments[p.id] || {}).length > 0) return false;
            return true;
        });
    }

    async function loadDutyMatrix(){
        const c=baseContext(),ticket=(state.loadTicket||0)+1;state.loadTicket=ticket;
        const selected=scope();renderBranchScope();
        try{
            if(!c.token)throw Error('session_required');
            const rows=await Promise.all(scopedBranches().map(async branch=>({branch,res:await window.AkraSupabaseKPI.getDutyMatrix(c.token,branch)})));
            if(ticket!==state.loadTicket||c.token!==baseContext().token||c.branch!==baseContext().branch||selected!==scope())return;
            if(rows.some(({res})=>!Array.isArray(res.catalog)||!Array.isArray(res.assignments)))throw Error('invalid_response');
            state.matrices=Object.fromEntries(rows.map(({branch,res})=>[branch,res]));
            if(!state.matrices[state.activeBranch])state.activeBranch=rows[0]?.branch;
            renderDuties();
        }catch(err){if(ticket!==state.loadTicket)return;state.matrices={};state.duties=[];state.assignments={};state.employees=[];
            const content=document.getElementById('kb-duty-content');if(content)content.innerHTML='<p role="alert" class="p-6 text-red-700 bg-red-50 rounded-xl">โหลดตารางงานไม่สำเร็จ กรุณารีเฟรชข้อมูลหรือตรวจสอบสิทธิ์</p>';
            const summary=document.getElementById('kb-duty-summary');if(summary)summary.innerHTML='';
        }
    }

    function initDefaults() {}

    function renderDuties(){
        const content=document.getElementById('kb-duty-content'),summary=document.getElementById('kb-duty-summary');if(!content)return;
        const scrollPositions=new Map([...content.querySelectorAll('[data-duty-scroll]')].map(el=>[el.dataset.dutyScroll,el.scrollLeft]));
        const previous=state.activeBranch;let html='',summaries='';
        for(const branch of scopedBranches()){
            if(!state.matrices?.[branch])continue;
            state.activeBranch=branch;applyMatrix(state.matrices[branch]);renderSingleMatrix();
            const body=content.innerHTML.replace(/window\.KpiDutyMatrix\.(openPerson|cycleAssignment)\(/g,(_,method)=>`window.KpiDutyMatrix.runBranch(${jsArg(branch)},${jsArg(method)},`);
            html+=`<section class="mb-8" aria-label="ตารางงานสาขา ${branch}"><div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold text-slate-900">สาขา ${branch}</h3><button type="button" class="text-xs font-bold text-blue-700 p-2 border rounded-lg" onclick="window.KpiDutyMatrix.runBranch(${jsArg(branch)},'openCatalog')">จัดการหน้าที่ ${branch}</button></div><div class="mb-3 rounded-xl bg-slate-50 p-3">${summary?.innerHTML||''}</div>${body}</section>`;
            summaries+=`<span class="font-bold text-slate-700">${branch}: ${getPeople().length} คน · ${activeDuties().filter(d=>d.target!=null&&coverage(d)<d.target).length} หน้าที่ขาดคน</span>`;
        }
        content.innerHTML=html;if(summary)summary.innerHTML=`<div class="flex flex-wrap gap-4 text-xs">${summaries}</div>`;
        for(const el of content.querySelectorAll('[data-duty-scroll]'))el.scrollLeft=scrollPositions.get(el.dataset.dutyScroll)||0;
        state.activeBranch=previous;if(state.matrices?.[previous])applyMatrix(state.matrices[previous]);
    }
    function renderSingleMatrix() {
        const container = document.getElementById('kb-duty-content');
        if (!container) return;

        const active = activeDuties();
        const visible = selectedPeople();
        const allPeople = getPeople();
        const shortDuties = active.filter(d => d.target != null && coverage(d) < d.target);
        const overloadedPeople = allPeople.filter(p => p.limit != null && load(p.id) > p.limit);
        const freePeople = allPeople.filter(p => !Object.keys(state.assignments[p.id] || {}).length);

        // Allocation Summary
        const summaryEl = document.getElementById('kb-duty-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="flex items-center flex-wrap gap-4 text-xs font-medium">
                    <span class="flex items-center gap-1.5 text-slate-700">
                        <i class="fa-solid fa-users text-slate-400"></i>
                        <strong>${allPeople.length}</strong> คนในทีม
                    </span>
                    <span class="flex items-center gap-1.5 ${shortDuties.length ? 'text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200' : 'text-slate-500'}">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <strong>${shortDuties.length}</strong> หน้าที่ขาดคน
                    </span>
                    <span class="flex items-center gap-1.5 ${overloadedPeople.length ? 'text-red-700 bg-red-50 px-2 py-1 rounded-lg border border-red-200' : 'text-slate-500'}">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <strong>${overloadedPeople.length}</strong> คนภาระงานสูง
                    </span>
                    <span class="flex items-center gap-1.5 text-slate-600">
                        <i class="fa-solid fa-user-plus text-slate-400"></i>
                        <strong>${freePeople.length}</strong> คนยังไม่มีหน้าที่
                    </span>
                    <small class="text-slate-400 ml-auto hidden sm:inline">น้ำหนักช่วยจัดคน ไม่ใช่ชั่วโมงทำงานหรือคะแนน KPI</small>
                </div>
            `;
        }

        container.innerHTML = `
            <!-- Desktop Matrix Table -->
            <div class="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm mb-4">
                <div class="overflow-x-auto" data-duty-scroll="${esc(context().branch)}">
                    <table class="w-full text-xs text-center border-collapse">
                        <thead>
                            <tr class="bg-slate-50/80 text-slate-600 border-b border-slate-200">
                                <th class="text-left p-3.5 pl-4 w-48 font-bold">
                                    พนักงาน <span class="text-slate-400 font-normal">(${visible.length} คน)</span>
                                </th>
                                ${active.map(d => {
                                    const cov = coverage(d);
                                    const isShort = d.target != null && cov < d.target;
                                    return `
                                        <th class="p-3 font-semibold min-w-[100px] border-l border-slate-100" title="${esc(d.description)}">
                                            <div class="text-slate-900 font-bold">${esc(d.name)}</div>
                                            <div class="text-[10px] text-slate-400 mt-0.5">น้ำหนัก ${d.weight}</div>
                                            <span class="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-bold font-num ${isShort ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
                                                ${cov}${d.target != null ? ` / ${d.target}` : ' คน'}${isShort ? ` · ขาด ${d.target - cov}` : ''}
                                            </span>
                                        </th>
                                    `;
                                }).join('')}
                                <th class="p-3.5 w-32 border-l border-slate-100 font-bold">
                                    <div>ภาระรวม</div>
                                    <div class="text-[10px] text-slate-400 font-normal mt-0.5">น้ำหนัก / ขีดจำกัด</div>
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${visible.map(p => {
                                const w = load(p.id);
                                const isOver = p.limit != null && w > p.limit;
                                const dutyCount = Object.keys(state.assignments[p.id] || {}).length;
                                return `
                                    <tr class="hover:bg-slate-50/80 transition-colors">
                                        <td class="text-left p-3.5 pl-4">
                                            <div class="flex items-center gap-2.5">
                                                <span class="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                                                    ${esc(p.initial)}
                                                </span>
                                                <div class="min-w-0">
                                                    <button type="button" onclick="window.KpiDutyMatrix.openPerson(${jsArg(p.id)})" class="font-bold text-slate-900 hover:text-blue-600 underline text-xs text-left block truncate">
                                                        ${esc(p.name)}
                                                    </button>
                                                    <small class="text-[10px] text-slate-400 block truncate">${esc(p.area)}</small>${drivingBadges(p.id)}
                                                </div>
                                            </div>
                                        </td>
                                        ${active.map(d => {
                                            const role = state.assignments[p.id]?.[d.id];
                                            return `
                                                <td class="p-2 border-l border-slate-100">
                                                    <button type="button"
                                                            data-duty-cell data-duty-branch="${esc(context().branch)}" data-duty-person="${esc(p.id)}" data-duty-id="${esc(d.id)}"
                                                            onclick="window.KpiDutyMatrix.cycleAssignment(${jsArg(p.id)}, ${jsArg(d.id)})"
                                                            class="w-12 h-9 rounded-lg font-bold text-xs transition-all flex items-center justify-center mx-auto ${
                                                                role === 'primary'
                                                                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-400 shadow-sm'
                                                                    : (role === 'secondary'
                                                                        ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                                                        : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500 border border-transparent')
                                                            }"
                                                            title="${esc(p.name)} · ${esc(d.name)}: ${role === 'primary' ? 'งานหลัก' : (role === 'secondary' ? 'งานเสริม' : 'ว่าง')} (คลิกเพื่อเปลี่ยน)">
                                                        ${role === 'primary' ? 'หลัก' : (role === 'secondary' ? 'เสริม' : '<i class="fa-solid fa-plus text-[10px]"></i>')}
                                                    </button>
                                                </td>
                                            `;
                                        }).join('')}
                                        <td class="p-3.5 border-l border-slate-100">
                                            <div class="text-xs font-bold font-num ${isOver ? 'text-red-600' : 'text-slate-800'}">
                                                ${w}${p.limit != null ? ` / ${p.limit}` : ''}
                                            </div>
                                            <div class="w-16 h-1.5 bg-slate-100 rounded-full mx-auto my-1 overflow-hidden">
                                                <div class="h-full rounded-full ${isOver ? 'bg-red-500' : 'bg-blue-500'}" style="width: ${p.limit ? Math.min(100, (w / p.limit) * 100) : 0}%"></div>
                                            </div>
                                            <div class="text-[10px] ${isOver ? 'text-red-500 font-bold' : 'text-slate-400'}">
                                                ${isOver ? 'เกินขีดจำกัด' : `${dutyCount} หน้าที่`}
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('') || `<tr><td colspan="${active.length + 2}" class="p-8 text-center text-slate-400">ไม่พบพนักงานตามตัวกรองนี้</td></tr>`}
                        </tbody>
                        <tfoot class="bg-slate-50 text-slate-500 border-t border-slate-200 font-bold text-xs">
                            <tr>
                                <td class="p-3.5 pl-4 text-left">คนที่รับหน้าที่</td>
                                ${active.map(d => `<td class="p-3 border-l border-slate-200 font-num">${coverage(d)} คน</td>`).join('')}
                                <td class="p-3.5 border-l border-slate-200 font-num text-slate-800">
                                    ${allPeople.reduce((sum, p) => sum + load(p.id), 0)} น้ำหนักรวม
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            <!-- Mobile People Cards -->
            <div class="md:hidden space-y-3">
                ${visible.map(p => {
                    const w = load(p.id);
                    const isOver = p.limit != null && w > p.limit;
                    const pDuties = active.filter(d => state.assignments[p.id]?.[d.id]);
                    return `
                        <article class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm text-xs">
                            <div class="flex items-center justify-between gap-2 mb-2.5">
                                <div class="flex items-center gap-2">
                                    <span class="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">
                                        ${esc(p.initial)}
                                    </span>
                                    <div>
                                        <strong class="text-sm font-bold text-slate-900 block">${esc(p.name)}</strong>
                                        <small class="text-[10px] text-slate-400">${esc(p.area)}</small>${drivingBadges(p.id)}
                                    </div>
                                </div>
                                <div class="text-right">
                                    <span class="font-bold text-xs font-num ${isOver ? 'text-red-600' : 'text-slate-800'}">
                                        น้ำหนัก ${w}${p.limit != null ? ` / ${p.limit}` : ''}
                                    </span>
                                    <div class="w-16 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden ml-auto">
                                        <div class="h-full rounded-full ${isOver ? 'bg-red-500' : 'bg-blue-500'}" style="width: ${p.limit ? Math.min(100, (w / p.limit) * 100) : 0}%"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex flex-wrap gap-1.5 mb-3">
                                ${pDuties.map(d => {
                                    const role = state.assignments[p.id][d.id];
                                    return `
                                        <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                            role === 'primary' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                        }">
                                            ${esc(d.name)} · ${role === 'primary' ? 'หลัก' : 'เสริม'}
                                        </span>
                                    `;
                                }).join('') || '<span class="text-slate-400 text-xs">ยังไม่มีหน้าที่</span>'}
                            </div>
                            <button type="button" onclick="window.KpiDutyMatrix.openPerson(${jsArg(p.id)})" class="w-full py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5">
                                <i class="fa-solid fa-pen-to-square"></i>
                                <span>ปรับหน้าที่ของ ${esc(p.name)}</span>
                            </button>
                        </article>
                    `;
                }).join('') || '<div class="p-8 text-center text-slate-400">ไม่พบพนักงานตามตัวกรองนี้</div>'}
            </div>
        `;
    }

    async function cycleAssignment(personId,dutyId){
        const old=state.assignments[personId]?.[dutyId]||'none';
        const targetType=old==='primary'?'secondary':old==='secondary'?'none':'primary';
        if(await write('setDutyAssignment',{employeeUid:personId,dutyId,targetType,expectedRevision:state.revisions[personId]??0,requestId:crypto.randomUUID()}))notify('อัปเดตหน้าที่แล้ว');
    }

    // Drawer System
    function showDrawer(html) {
        const backdrop = document.getElementById('kpi-task-drawer-backdrop');
        const drawer = document.getElementById('kpi-task-drawer');
        if (!backdrop || !drawer) return;

        drawer.innerHTML = `<p class="mb-3 px-3 py-2 rounded-lg bg-blue-50 text-blue-900 font-bold text-sm">${state.activeBranch?'สาขา '+esc(state.activeBranch):'เลือกสาขาที่ต้องการจัดการ'}</p>`+html;
        backdrop.classList.remove('hidden');
        drawer.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        drawer.focus();
    }

    function closeDrawer() {
        const backdrop = document.getElementById('kpi-task-drawer-backdrop');
        const drawer = document.getElementById('kpi-task-drawer');
        if (backdrop) backdrop.classList.add('hidden');
        if (drawer) drawer.classList.add('hidden');
        document.body.style.overflow = '';
    }

    function openPerson(personId) {
        const p = getPeople().find(person => person.id === personId);
        if (!p) return;

        const active = activeDuties();
        const entries = state.assignments[p.id] || {};

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <span class="text-xs font-bold text-slate-500">ปรับหน้าที่ปัจจุบัน</span>
                <button type="button" onclick="window.KpiDutyMatrix.closeDrawer()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <h2 class="text-base font-bold text-slate-900 mb-1">หน้าที่ของ ${esc(p.name)}</h2>
            <p class="text-xs text-slate-500 mb-4">${esc(p.area)} · งานหลักได้ 1 อย่าง และเพิ่มงานเสริมได้หลายอย่าง</p>

            <form onsubmit="window.KpiDutyMatrix.saveDrivingCapabilities(event,${jsArg(p.id)})" class="mb-6 p-3 rounded-xl border border-emerald-200 bg-emerald-50/40">
                <h3 class="text-sm font-bold text-slate-900 mb-1">ทักษะขับขี่</h3>
                <p class="text-xs text-slate-500 mb-3">ระบุรถที่ขับได้ แยกจากหน้าที่ปัจจุบัน</p>
                ${Object.entries(vehicles).map(([key,label])=>`<label class="block mb-3 text-xs font-bold text-slate-700">${label}<select name="${key}" aria-label="${label}" ${context().can('manageDutyAllocations')?'':'disabled'} class="block mt-1 w-full p-2 rounded-lg border border-slate-200 bg-white">${Object.entries(drivingStatuses).map(([value,text])=>`<option value="${value}" ${(state.driving[p.id]?.capabilities?.[key]||'unknown')===value?'selected':''}>${text}</option>`).join('')}</select></label>`).join('')}
                ${context().can('manageDutyAllocations')?'<button type="submit" class="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold text-xs">บันทึกทักษะขับขี่</button>':'<p class="text-xs text-slate-500">ดูข้อมูลได้ · ผู้มีสิทธิ์จัดตารางงานเป็นผู้แก้ไข</p>'}
            </form>
            <div class="space-y-2 mb-6">
                ${active.map(d => {
                    const currentVal = entries[d.id] || '';
                    return `
                        <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/70 text-xs">
                            <div>
                                <strong class="font-bold text-slate-800 block">${esc(d.name)}</strong>
                                <small class="text-slate-400 text-[10px]">น้ำหนัก ${d.weight} · ${esc(d.description)}</small>
                            </div>
                            <select onchange="window.KpiDutyMatrix.handlePersonDutyChange(${jsArg(p.id)}, ${jsArg(d.id)}, this.value)" class="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none">
                                <option value="" ${currentVal === '' ? 'selected' : ''}>ว่าง</option>
                                <option value="primary" ${currentVal === 'primary' ? 'selected' : ''}>งานหลัก</option>
                                <option value="secondary" ${currentVal === 'secondary' ? 'selected' : ''}>งานเสริม</option>
                            </select>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 mb-6">
                <label class="block text-xs font-bold text-slate-700 mb-1">
                    ขีดจำกัดน้ำหนักของ ${esc(p.name)} (คะแนนรวม)
                </label>
                <div class="flex gap-2">
                    <input type="number" min="0" max="99" id="kb-person-limit-input" value="${p.limit ?? ''}" placeholder="เว้นว่างถ้าไม่จำกัด" class="w-32 p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold font-num outline-none focus:ring-2 focus:ring-blue-500">
                    <button type="button" onclick="window.KpiDutyMatrix.savePersonLimit(${jsArg(p.id)})" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold">
                        บันทึกขีดจำกัด
                    </button>
                </div>
                <p class="text-[10px] text-slate-400 mt-1">ใช้เพื่อตรวจสอบภาระงานร่วมกัน ไม่ใช่การคิดคะแนนผลงาน</p>
            </div>

            <button type="button" onclick="window.KpiDutyMatrix.closeDrawer()" class="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs">
                เรียบร้อย
            </button>
        `;

        showDrawer(html);
    }

    async function handlePersonDutyChange(personId,dutyId,role){
        if(await write('setDutyAssignment',{employeeUid:personId,dutyId,targetType:role||'none',expectedRevision:state.revisions[personId]??0,requestId:crypto.randomUUID()})){openPerson(personId);notify('อัปเดตหน้าที่แล้ว');}
    }

    async function savePersonLimit(personId){
        const value=document.getElementById('kb-person-limit-input')?.value;
        const capacityWeight=value===''?null:Number(value);
        if(await write('setDutyCapacity',{employeeUid:personId,capacityWeight,expectedRevision:state.capacityRevisions[personId]??0}))notify('บันทึกขีดจำกัดแล้ว');
    }

    async function saveDrivingCapabilities(event,personId){
        event.preventDefault();if(!getPeople().some(p=>p.id===personId))return;
        const data=new FormData(event.target),capabilities=Object.fromEntries(Object.keys(vehicles).map(key=>[key,data.get(key)]));
        if(Object.values(capabilities).some(value=>!Object.hasOwn(drivingStatuses,value))){notify('กรุณาระบุสถานะทักษะขับขี่');return;}
        if(await write('setDrivingCapabilities',{employeeUid:personId,capabilities,expectedRevision:state.driving[personId]?.revision??0})){openPerson(personId);notify('บันทึกทักษะขับขี่แล้ว');}
    }
    function setDrivingFilter(value){if(value&&!Object.hasOwn(vehicles,value))return;state.drivingFilter=value;renderDuties();}

    function openCatalog() {
        if(scope()==='ALL'&&!state.activeBranch){showDrawer(`<h2 class="font-bold mb-3">เลือกสาขาที่จะจัดการหน้าที่</h2>${branches().map(b=>`<button type="button" class="p-3 border rounded-lg mr-2" onclick="window.KpiDutyMatrix.runBranch(${jsArg(b)},'openCatalog')">${b}</button>`).join('')}<button type="button" class="p-3 border rounded-lg" onclick="window.KpiDutyMatrix.closeDrawer()">ยกเลิก</button>`);return;}
        const active = activeDuties();

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <span class="text-xs font-bold text-slate-500">จัดการแคตตาล็อกหน้าที่</span>
                <button type="button" onclick="window.KpiDutyMatrix.closeDrawer()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <h2 class="text-base font-bold text-slate-900 mb-1">จัดการหน้าที่ (Duty Catalog)</h2>
            <p class="text-xs text-slate-500 mb-4">แก้ไขชื่อ น้ำหนัก และจำนวนคนที่ต้องการ หน้าที่ที่ปิดใช้งานจะถูกนำออกจากตารางปัจจุบัน</p>

            <div class="space-y-3 mb-6 max-h-72 overflow-y-auto pr-1">
                ${active.map(d => `
                    <div class="p-3 rounded-xl border border-slate-200 bg-slate-50/50 text-xs space-y-2">
                        <input type="text" value="${esc(d.name)}" onchange="window.KpiDutyMatrix.updateDutyProperty(${jsArg(d.id)}, 'name', this.value)" class="w-full p-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 outline-none">
                        <div class="flex items-center gap-2">
                            <label class="text-[11px] text-slate-500 flex items-center gap-1">
                                น้ำหนัก:
                                <select onchange="window.KpiDutyMatrix.updateDutyProperty(${jsArg(d.id)}, 'weight', parseInt(this.value, 10))" class="p-1 bg-white border border-slate-200 rounded text-xs">
                                    <option value="1" ${d.weight === 1 ? 'selected' : ''}>1 (เบา)</option>
                                    <option value="2" ${d.weight === 2 ? 'selected' : ''}>2 (กลาง)</option>
                                    <option value="3" ${d.weight === 3 ? 'selected' : ''}>3 (หนัก)</option>
                                </select>
                            </label>
                            <label class="text-[11px] text-slate-500 flex items-center gap-1">
                                ต้องการคน:
                                <input type="number" min="0" max="99" value="${d.target ?? ''}" placeholder="—" onchange="window.KpiDutyMatrix.updateDutyProperty(${jsArg(d.id)}, 'target', this.value === '' ? null : parseInt(this.value, 10))" class="w-14 p-1 bg-white border border-slate-200 rounded text-center text-xs font-num font-bold">
                            </label>
                            <button type="button" onclick="window.KpiDutyMatrix.confirmDisableDuty(${jsArg(d.id)})" class="ml-auto px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold border border-red-200">
                                <i class="fa-solid fa-box-archive mr-1"></i>ปิด
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- Add Duty Section -->
            <section class="pt-4 border-t border-slate-200 mb-6">
                <h3 class="text-xs font-bold text-slate-800 mb-2.5 flex items-center gap-1.5">
                    <i class="fa-solid fa-plus text-blue-600"></i>
                    <span>เพิ่มหน้าที่ใหม่</span>
                </h3>
                <form onsubmit="window.KpiDutyMatrix.handleAddDuty(event)" class="space-y-3">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">ชื่อหน้าที่ <span class="text-red-500">*</span></label>
                        <input type="text" name="name" required placeholder="เช่น แพ็กสินค้าสำหรับออนไลน์" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[11px] font-bold text-slate-700 mb-1">น้ำหนัก</label>
                            <select name="weight" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="1">1 (เบา)</option>
                                <option value="2" selected>2 (กลาง)</option>
                                <option value="3">3 (หนัก)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-700 mb-1">ต้องการคน</label>
                            <input type="number" name="target" min="0" max="99" placeholder="ยังไม่ตั้ง" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm">
                        เพิ่มหน้าที่
                    </button>
                </form>
            </section>

            <button type="button" onclick="window.KpiDutyMatrix.closeDrawer()" class="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs">
                เรียบร้อย
            </button>
        `;

        showDrawer(html);
    }

    async function updateDutyProperty(dutyId,prop,val){
        const d=state.duties.find(d=>d.id===dutyId);if(!d)return;
        if(await write('saveDutyCatalog',catalogPayload({...d,[prop]:val}),'manageDutyCatalog'))notify('บันทึกหน้าที่แล้ว');
    }

    async function handleAddDuty(e){
        e.preventDefault();const data=new FormData(e.target),name=data.get('name')?.trim();if(!name)return;
        const d={id:'duty-'+crypto.randomUUID(),name,weight:Number(data.get('weight'))||2,target:data.get('target')===''?null:Number(data.get('target')),active:true,revision:0};
        if(await write('saveDutyCatalog',catalogPayload(d),'manageDutyCatalog')){openCatalog();notify('เพิ่มหน้าที่แล้ว');}
    }

    function confirmDisableDuty(dutyId) {
        const d = state.duties.find(duty => duty.id === dutyId);
        if (!d) return;

        const assignedCount = coverage(d);

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <span class="text-xs font-bold text-red-600">ยืนยันการปิดหน้าที่</span>
                <button type="button" onclick="window.KpiDutyMatrix.openCatalog()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <h2 class="text-base font-bold text-slate-900 mb-2">ปิดหน้าที่ "${esc(d.name)}"?</h2>
            <p class="text-xs text-slate-600 leading-relaxed mb-4">
                ปัจจุบันมีผู้รับหน้าที่นี้ <strong>${assignedCount} คน</strong><br>
                การปิดใช้งานจะนำหน้าที่นี้ออกจากตารางปัจจุบันและออกจากพนักงานทุกคนทันที โดยไม่กระทบงานใน Kanban Board หรือประวัติย้อนหลัง
            </p>

            <div class="flex gap-2">
                <button type="button" onclick="window.KpiDutyMatrix.openCatalog()" class="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50">
                    กลับไปจัดการ
                </button>
                <button type="button" onclick="window.KpiDutyMatrix.executeDisableDuty(${jsArg(d.id)})" class="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-sm">
                    ยืนยันปิดหน้าที่
                </button>
            </div>
        `;

        showDrawer(html);
    }

    async function executeDisableDuty(dutyId){
        const d=state.duties.find(d=>d.id===dutyId);if(!d)return;
        if(await write('saveDutyCatalog',catalogPayload({...d,active:false}),'manageDutyCatalog')){openCatalog();notify('ปิดหน้าที่แล้ว');}
    }

    function setFilter(filterMode) {
        state.filter = filterMode;
        document.querySelectorAll('.kb-duty-filter-btn').forEach(btn => {
            const active = btn.dataset.people === filterMode;
            btn.classList.toggle('bg-white', active);
            btn.classList.toggle('text-blue-700', active);
            btn.classList.toggle('shadow-sm', active);
            btn.classList.toggle('text-slate-600', !active);
        });
        renderDuties();
    }

    function initEventListeners() {
        if (state.isInitialized) return;
        state.isInitialized = true;

        const searchInput = document.getElementById('kb-duty-person-search');
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                state.search = e.target.value;
                renderDuties();
            });
        }
    }

    // Public API
    window.KpiDutyMatrix = {
        loadDutyMatrix,
        renderDuties,
        cycleAssignment,
        openPerson,
        handlePersonDutyChange,
        savePersonLimit,
        saveDrivingCapabilities,
        setDrivingFilter,
        openCatalog,
        updateDutyProperty,
        handleAddDuty,
        confirmDisableDuty,
        executeDisableDuty,
        closeDrawer,
        setFilter,
        initEventListeners,
        setBranchScope,
        runBranch,
        chooseCatalogBranch:()=>{if(state.busy)return;if(scope()==='ALL'){state.activeBranch=null;}openCatalog();}
    };

})(window);
