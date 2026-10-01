/**
 * KPI Kanban Board
 * Multi-status task management with incoming issue intake lane,
 * checklists, comments, activity log, drag & drop, and 5S history link.
 */
(function(window) {
    'use strict';

    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(val) {
        return String(val ?? '').replace(/[&<>"']/g, c => ESC_MAP[c] || c);
    }

    const STATUSES = [
        { id: 'open', label: 'รอเริ่ม', dotClass: 'bg-slate-400', badgeClass: 'bg-slate-100 text-slate-700' },
        { id: 'progress', label: 'กำลังทำ', dotClass: 'bg-blue-500', badgeClass: 'bg-blue-50 text-blue-700' },
        { id: 'blocked', label: 'ติดขัด / รอ', dotClass: 'bg-amber-500', badgeClass: 'bg-amber-50 text-amber-800' },
        { id: 'done', label: 'เสร็จแล้ว', dotClass: 'bg-emerald-500', badgeClass: 'bg-emerald-50 text-emerald-800' }
    ];

    function jsArg(value) { return esc(JSON.stringify(String(value))); }

    // State container
    const state = {
        tasks: [],
        incomingIssues: [],
        view: 'board', // 'board' | 'list' | 'mine'
        search: '',
        ownerFilter: '',
        categoryFilter: '',
        overdueOnly: false,
        activeTaskId: null,
        draggedTaskId: null,
        isInitialized: false
    };

    function context() { return window.getKpiTaskContext?.() || {token:null,branch:'',userUid:'',name:'',employees:[],can:()=>false}; }
    function branches(){const c=context();const privileged=(c.roles||[]).some(role=>['ADMIN','SUPERVISOR'].includes(String(role).trim().toUpperCase()));return [...new Set((privileged?(c.allowedBranches||[c.branch]):[c.branch]).filter(b=>['AKRA','TRD'].includes(b)))];}
    function scope(){return branches().includes(state.branchScope)||state.branchScope==='ALL'&&branches().length>1?state.branchScope:context().branch;}
    function scopedBranches(){return scope()==='ALL'?branches():[scope()];}
    function renderBranchScope(){const el=document.getElementById('kb-branch-scope');if(el){el.innerHTML=branches().map(b=>`<option value="${b}">${b}</option>`).join('')+(branches().length>1?'<option value="ALL">ทั้งสองสาขา</option>':'');el.value=scope();}}
    async function setBranchScope(value){if(state.saving)return;if(value!=='ALL'&&!branches().includes(value)||value==='ALL'&&branches().length<2)return;state.branchScope=value;closeDrawer();await loadKanbanBoard();}
    function findTask(id){return state.tasks.find(t=>t.id===id)||(state.tasks.filter(t=>t.actionId===id).length===1?state.tasks.find(t=>t.actionId===id):null);}
    function canEdit(task) { const c=context(); return c.can('manageTeamTasks') || (c.can('updateOwnTasks') && String(task.owner).toLowerCase()===String(c.userUid).toLowerCase()); }
    function taskPayload(t) { return {actionId:t.actionId||t.id,branch:t.branch||context().branch,title:t.title,detail:t.detail,ownerUid:t.owner,owner:t.ownerName,category:t.category,area:t.area,priority:t.priority==='high'?'High':'Medium',status:{open:'Open',progress:'In Progress',blocked:'Blocked',done:'Resolved'}[t.status],dueDate:t.due,nextStep:t.next,blockedReason:t.blocked,resolutionNote:t.note,checklist:t.checklist,comments:t.comments,revision:t.revision}; }
    async function persistTask(candidate) {
        if (state.saving) return null;
        const c=context();
        if (!c.token || !canEdit(candidate)) { notify('ไม่มีสิทธิ์แก้ไขงานนี้'); return null; }
        state.saving=true;
        try {
            const res=await window.AkraSupabaseKPI.saveKanbanTask(c.token,taskPayload(candidate),candidate.revision??0);
            if (!res?.task) throw Error('invalid_response');
            if (context().token!==c.token || context().branch!==c.branch) return null;
            const task=normalizeTask({...res.task,branch:candidate.branch||c.branch}); const i=state.tasks.findIndex(t=>t.id===task.id);
            if(i<0) state.tasks.unshift(task); else state.tasks[i]=task;
            renderBoard(); return task;
        } catch(err) { notify('บันทึกไม่สำเร็จ กรุณารีเฟรชข้อมูลก่อนลองอีกครั้ง'); await loadKanbanBoard(); return null; }
        finally {state.saving=false;}
    }

    function normalizeTask(t) {
        const rawStatus = String(t.status || 'Open').toLowerCase();
        let status = 'open';
        if (rawStatus === 'in progress' || rawStatus === 'progress') status = 'progress';
        else if (rawStatus === 'blocked') status = 'blocked';
        else if (rawStatus === 'resolved' || rawStatus === 'completed' || rawStatus === 'done') status = 'done';

        return {
            id: `${t.branch||context().branch}::${t.actionId || t.action_id || t.id}`,
            branch:t.branch||context().branch,
            dbId: t.id,
            actionId: t.actionId || t.action_id || t.id,
            title: t.title || t.action_name || t.actionName || '',
            detail: t.detail || t.action_plan || t.actionPlan || '',
            owner: t.ownerUid || t.owner_uid || '',
            ownerName: t.ownerName || t.owner_name || t.owner || t.display_owner || t.responsible || '',
            category: t.category || 'คลังสินค้า',
            priority: ['high','critical'].includes(String(t.priority||'').toLowerCase()) ? 'high' : 'normal',
            area: t.area || 'คลังสินค้า',
            status: status,
            due: t.due_date || t.dueDate || '',
            next: t.next_step || t.nextStep || '',
            blocked: t.blocked_reason || t.blockedReason || '',
            revision: t.revision ?? 0,
            note: t.resolution_note || t.resolutionNote || t.note || '',
            checklist: Array.isArray(t.checklist) ? t.checklist.map(c=>({...c,done:c.done ?? c.completed ?? false})) : [],
            comments: Array.isArray(t.comments) ? t.comments : [],
            history: Array.isArray(t.activityLog) ? t.activityLog : (Array.isArray(t.activity_log) ? t.activity_log : (Array.isArray(t.history) ? t.history : [])),
            sourceIssueId: t.source_issue_id || t.sourceIssueId || null,
            attachments: Array.isArray(t.attachments) ? t.attachments : []
        };
    }

    function getEmployees(branch) { return (state.employees || context().employees || []).map(e=>({...e,uid:e.employeeUid||e.uid})).filter(e=>e.uid && (!branch || e.branch===branch)); }

    function resolveEmployeeName(uid,branch) {
        const emp = getEmployees(branch).find(e => String(e.uid || '').toLowerCase() === String(uid || '').toLowerCase() || String(e.name || '').toLowerCase() === String(uid || '').toLowerCase());
        return emp ? emp.name : (uid || 'ไม่ระบุ');
    }

    function isOverdue(task) {
        if (task.status === 'done') return false;
        if (!task.due) return false;
        const today = typeof window.getTodayBangkokDateStr === 'function' ? window.getTodayBangkokDateStr() : new Date().toISOString().slice(0, 10);
        return task.due < today;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        try {
            return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(`${dateStr}T12:00:00+07:00`));
        } catch (_) {
            return dateStr;
        }
    }

    function notify(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else {
            console.log('[Kanban Toast]', msg);
        }
    }

    async function loadKanbanBoard() {
        const c=context(); const ticket=(state.loadTicket||0)+1; state.loadTicket=ticket;
        try {
            if (!c.token) throw Error('session_required');
            const selected=scope();renderBranchScope();
            const results=await Promise.all(scopedBranches().map(async branch=>({branch,res:await window.AkraSupabaseKPI.getKanbanBoard(c.token,branch)})));
            if(ticket!==state.loadTicket||c.token!==context().token||c.branch!==context().branch||selected!==scope())return;
            if(results.some(({res})=>!Array.isArray(res.tasks)))throw Error('invalid_response');
            state.tasks=results.flatMap(({branch,res})=>res.tasks.filter(t=>!t.isArchived&&t.status!=='Cancelled').map(t=>normalizeTask({...t,branch})));
            state.incomingIssues=results.flatMap(({branch,res})=>(res.incomingIssues||[]).map(i=>({...i,branch,id:branch+'::'+i.id,sourceId:i.id,taskId:i.taskId?branch+'::'+i.taskId:null})));
            state.employees=results.flatMap(({branch,res})=>(res.employees||c.employees||[]).map(e=>({...e,branch})));
            state.issueReady=results.every(({res})=>res.issueIntegrationReady===true);
            populateOwnerSelect(); renderBoard();
        } catch(err) {
            if(ticket!==state.loadTicket)return;
            state.tasks=[];state.incomingIssues=[];
            state.employees=[];
            const summary=document.getElementById('kb-summary');if(summary)summary.textContent='';
            const content=document.getElementById('kb-board-content');
            if(content)content.innerHTML='<p role="alert" class="p-6 text-red-700 bg-red-50 rounded-xl">โหลดบอร์ดไม่สำเร็จ กรุณารีเฟรชข้อมูลหรือตรวจสอบสิทธิ์</p>';
        }
    }

    function populateOwnerSelect() {
        const select = document.getElementById('kb-filter-owner');
        if (!select) return;
        const currentUid = String(context().userUid || '').toLowerCase();
        let html = '<option value="">ทุกคน</option>';
        getEmployees().forEach(e => {
            const isMe = String(e.uid || '').toLowerCase() === currentUid || String(e.name || '').toLowerCase() === currentUid;
            html += `<option value="${esc(e.uid)}">${esc(e.name)}${isMe ? ' (ฉัน)' : ''}</option>`;
        });
        select.innerHTML = html;
    }

    function filteredTasks() {
        const q = state.search.trim().toLowerCase();
        const currentUid = String(context().userUid || '').toLowerCase();
        return state.tasks.filter(t => {
            if (q && !`${t.title} ${t.detail} ${t.id}`.toLowerCase().includes(q)) return false;
            if (state.ownerFilter && t.owner !== state.ownerFilter && String(t.ownerName).toLowerCase() !== state.ownerFilter.toLowerCase()) return false;
            if (state.categoryFilter && t.category !== state.categoryFilter) return false;
            if (state.overdueOnly && !isOverdue(t)) return false;
            if (state.view === 'mine') {
                const isMe = String(t.owner).toLowerCase() === currentUid || String(t.ownerName).toLowerCase() === currentUid;
                if (!isMe) return false;
            }
            return true;
        });
    }

    function renderBoard() {
        const container = document.getElementById('kb-board-content');
        if (!container) return;

        const filtered = filteredTasks();
        const totalOpen = state.tasks.filter(t => t.status !== 'done').length;
        const overdueCount = state.tasks.filter(isOverdue).length;

        const summaryEl = document.getElementById('kb-summary');
        if (summaryEl) {
            summaryEl.textContent = `${filtered.length} งาน (${totalOpen} งานที่เปิดอยู่)`;
        }

        const overdueCountEl = document.getElementById('kb-overdue-count');
        if (overdueCountEl) overdueCountEl.textContent = overdueCount;

        if (state.view === 'list' || state.view === 'mine') {
            container.innerHTML = renderListView(filtered);
        } else {
            container.innerHTML = renderKanbanView(filtered);
            setupDragAndDrop();
        }
    }

    function renderKanbanView(filtered) {
        return `
            <div class="kanban-grid grid grid-cols-1 md:grid-cols-5 gap-3.5 items-start overflow-x-auto pb-4">
                ${renderIntakeLane()}
                ${STATUSES.map(s => renderColumn(s, filtered.filter(t => t.status === s.id))).join('')}
            </div>
        `;
    }

    function renderIntakeLane() {
        const q = state.search.trim().toLowerCase();
        const issues = (state.issueReady ? state.incomingIssues : []).filter(i => {
            if (q && !`${i.title} ${i.description}`.toLowerCase().includes(q)) return false;
            if (state.categoryFilter && i.category !== state.categoryFilter) return false;
            return true;
        });
        const pending = issues.filter(i => !i.taskId);
        const claimed = issues.filter(i => i.taskId);

        return `
            <section class="column issue-column rounded-2xl p-3 border border-purple-200/70 bg-[#eee8fa] min-h-[440px] flex flex-col" aria-label="ปัญหาแจ้งเข้า">
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-purple-200">
                    <div class="flex items-center gap-2 font-bold text-xs text-purple-900">
                        <span class="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"></span>
                        <span>ปัญหาแจ้งเข้า</span>
                        <span class="px-2 py-0.5 rounded-full bg-purple-200 text-purple-800 text-[11px] font-bold font-num">${state.issueReady ? pending.length : '—'}</span>
                    </div>
                    <i class="fa-solid fa-inbox text-purple-600 text-sm"></i>
                </div>
                <p class="text-[11px] text-purple-700 mb-2.5 font-medium">${state.issueReady ? 'จากระบบแจ้งปัญหา' : 'รอเชื่อมระบบแจ้งปัญหา'}</p>
                <div class="space-y-2.5 flex-1">
                    ${pending.map(i => `
                        <article class="bg-white rounded-xl p-3 border border-purple-200 shadow-sm text-xs hover:border-purple-400 transition-all">
                            <div class="flex items-center justify-between gap-1 mb-1.5">
                                <span class="text-[10px] font-bold text-purple-800">${esc(i.id.replace('ISS-DEMO-', 'IS-'))}</span>
                                <span class="text-[10px] px-2 py-0.5 rounded font-bold ${i.priority === 'high' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700'}">${i.priority === 'high' ? 'สำคัญสูง' : 'ปกติ'}</span>
                            </div>
                            <h4 class="font-bold text-slate-900 leading-snug mb-1">${esc(i.title)}</h4>
                            <p class="text-[11px] text-slate-600 leading-relaxed line-clamp-2 mb-2">${esc(i.description)}</p>
                            <div class="space-y-0.5 text-[10px] text-slate-500 mb-2">
                                <div class="flex items-center gap-1.5"><i class="fa-solid fa-location-dot text-slate-400 w-3"></i><span>${esc(i.area)}</span></div>
                                <div class="flex items-center gap-1.5"><i class="fa-solid fa-user text-slate-400 w-3"></i><span>${esc(i.reporter)}</span></div>
                            </div>
                            <button type="button" onclick="window.KpiKanbanBoard.openClaimIssueModal(${jsArg(i.id)})" class="w-full py-1.5 px-2 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all">
                                <i class="fa-solid fa-hand"></i>
                                <span>รับงานนี้</span>
                            </button>
                        </article>
                    `).join('') || (state.issueReady
                        ? '<div class="text-center py-8 text-purple-700 text-xs">ไม่มีปัญหารอรับงาน</div>'
                        : '<div class="py-8 px-2 text-center text-purple-900 text-xs"><i class="fa-solid fa-plug text-xl mb-3" aria-hidden="true"></i><strong class="block mb-2">ยังไม่เชื่อมข้อมูล</strong><p class="text-purple-800 leading-relaxed">เมื่อเชื่อมระบบแล้ว ปัญหาที่แจ้งเข้ามาจะแสดงที่นี่ และทีมสามารถเลือกรับไปทำต่อในบอร์ดงานได้</p></div>')}
                </div>
                ${claimed.length ? `
                    <div class="mt-3 pt-2.5 border-t border-purple-200">
                        <strong class="text-[11px] text-purple-800 block mb-1">รับงานแล้ว (${claimed.length})</strong>
                        <div class="space-y-1">
                            ${claimed.map(i => `
                                <button type="button" onclick="window.KpiKanbanBoard.openTask(${jsArg(i.taskId)})" class="w-full text-left p-1.5 rounded bg-purple-50/80 hover:bg-purple-100 text-[10px] text-purple-900 flex items-center justify-between gap-1">
                                    <span class="min-w-0"><span class="block truncate">${esc(i.title)}</span><span class="block mt-1 font-bold">${esc(state.tasks.find(t=>t.id===i.taskId)?.ownerName || 'ดูผู้รับผิดชอบในงาน')} · ${esc(STATUSES.find(s=>s.id===state.tasks.find(t=>t.id===i.taskId)?.status)?.label || '')}</span></span>
                                    <i class="fa-solid fa-arrow-up-right-from-square text-purple-500 text-[9px]"></i>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderColumn(statusDef, tasks) {
        const bgColors = {
            open: 'bg-[#e9edf3] border-slate-300/80 text-slate-800',
            progress: 'bg-[#e0edff] border-blue-200 text-blue-900',
            blocked: 'bg-[#fff0cf] border-amber-200 text-amber-900',
            done: 'bg-[#dff3e7] border-emerald-200 text-emerald-900'
        };
        const badgeColors = {
            open: 'bg-slate-200 text-slate-800',
            progress: 'bg-blue-200 text-blue-800',
            blocked: 'bg-amber-200 text-amber-800',
            done: 'bg-emerald-200 text-emerald-800'
        };

        return `
            <section class="column rounded-2xl p-3 border ${bgColors[statusDef.id]} min-h-[440px] flex flex-col" data-drop-status="${statusDef.id}" aria-label="${statusDef.label}">
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-black/5">
                    <div class="flex items-center gap-2 font-bold text-xs">
                        <span class="w-2.5 h-2.5 rounded-full ${statusDef.dotClass} inline-block"></span>
                        <span>${statusDef.label}</span>
                        <span class="px-2 py-0.5 rounded-full ${badgeColors[statusDef.id]} text-[11px] font-bold font-num">${tasks.length}</span>
                    </div>
                    ${statusDef.id === 'open' ? `
                        <button type="button" onclick="window.KpiKanbanBoard.openNewTaskModal('open')" aria-label="เพิ่มงานใหม่" class="w-6 h-6 rounded-lg bg-white/70 hover:bg-white text-slate-600 hover:text-blue-600 flex items-center justify-center text-xs transition-all shadow-sm">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    ` : ''}
                </div>
                <div class="space-y-2.5 flex-1 drop-zone" data-status="${statusDef.id}">
                    ${tasks.map(t => renderTaskCard(t)).join('') || `<div class="text-center py-8 text-slate-400 text-xs">ยังไม่มีงานในสถานะนี้</div>`}
                </div>
                ${statusDef.id === 'open' ? `
                    <button type="button" onclick="window.KpiKanbanBoard.openNewTaskModal('open')" class="mt-3 w-full py-2 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-white text-slate-600 hover:text-blue-600 font-bold text-xs flex items-center justify-center gap-1.5 transition-all">
                        <i class="fa-solid fa-plus"></i>
                        <span>เพิ่มงานใหม่</span>
                    </button>
                ` : ''}
            </section>
        `;
    }

    function renderTaskCard(t) {
        const overdue = isOverdue(t);
        const ownerName = (t.ownerName || resolveEmployeeName(t.owner));
        const initial = (ownerName || 'ก').slice(0, 1);
        const checkedCount = t.checklist.filter(c => c.done).length;

        return `
            <article class="task-card bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-sm text-xs cursor-pointer hover:shadow-md hover:border-blue-400 transition-all active:scale-[0.99]"
                     tabindex="0"
                     role="button"
                     draggable="true"
                     data-task-id="${esc(t.id)}"
                     onclick="window.KpiKanbanBoard.openTask(${jsArg(t.id)})">
                <div class="flex items-center justify-between gap-1 mb-1.5">
                    <span title="${esc(t.actionId)}" class="text-[10px] font-bold text-slate-400 font-num min-w-0 truncate">${esc(t.actionId)}</span><span class="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200 shrink-0">${esc(t.branch)}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded font-bold ${t.priority === 'high' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                        ${t.priority === 'high' ? 'สำคัญสูง' : 'ปกติ'}
                    </span>
                </div>
                <h4 class="font-bold text-slate-900 leading-snug mb-1 text-xs">${esc(t.title)}</h4>
                <div class="text-[11px] text-slate-500 mb-2">${esc(t.area)} · ${esc(t.category)}</div>
                ${t.sourceIssueId ? `
                    <div class="mb-2 px-2 py-1 rounded bg-purple-50 text-purple-700 text-[10px] font-bold flex items-center gap-1">
                        <i class="fa-solid fa-inbox text-[9px]"></i>
                        <span>จากเรื่อง ${esc(t.sourceIssueId.replace('ISS-DEMO-', 'IS-'))}</span>
                    </div>
                ` : ''}
                ${t.status === 'blocked' && t.blocked ? `
                    <div class="mb-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                        <div class="font-bold text-[10px] text-amber-700 flex items-center gap-1 mb-0.5">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <span>ติดขัด / รอ:</span>
                        </div>
                        ${esc(t.blocked)}
                    </div>
                ` : ''}
                ${t.status === 'done' && t.note ? `
                    <div class="mb-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] leading-relaxed">
                        <div class="font-bold text-[10px] text-emerald-700 flex items-center gap-1 mb-0.5">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>ผลการทำงาน:</span>
                        </div>
                        ${esc(t.note)}
                    </div>
                ` : (t.next ? `
                    <div class="mb-2 text-[11px] text-slate-600 border-t border-slate-100 pt-1.5">
                        <span class="text-slate-400 text-[10px]">ขั้นถัดไป:</span> ${esc(t.next)}
                    </div>
                ` : '')}
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px]">
                    <div class="flex items-center gap-1.5">
                        <span class="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                            ${esc(initial)}
                        </span>
                        <span class="font-medium text-slate-700 truncate max-w-[90px]">${esc(ownerName)}</span>
                    </div>
                    <span class="font-num text-[11px] ${overdue ? 'text-red-600 font-bold' : 'text-slate-500'}">
                        ${overdue ? 'เกินกำหนด · ' : ''}${formatDate(t.due)}
                    </span>
                </div>
                ${(t.checklist.length > 0 || t.comments.length > 0) ? `
                    <div class="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                        ${t.checklist.length > 0 ? `
                            <span class="flex items-center gap-1"><i class="fa-solid fa-list-check"></i>${checkedCount}/${t.checklist.length}</span>
                        ` : ''}
                        ${t.comments.length > 0 ? `
                            <span class="flex items-center gap-1"><i class="fa-solid fa-message"></i>${t.comments.length}</span>
                        ` : ''}
                    </div>
                ` : ''}
            </article>
        `;
    }

    function renderListView(filtered) {
        return `
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div class="overflow-x-auto">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <tr>
                                <th class="p-3.5 font-bold">งาน</th>
                                <th class="p-3.5 font-bold">ผู้รับผิดชอบ</th>
                                <th class="p-3.5 font-bold">สถานะ</th>
                                <th class="p-3.5 font-bold">กำหนดเสร็จ</th>
                                <th class="p-3.5 font-bold text-center">Checklist</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${filtered.map(t => {
                                const statusDef = STATUSES.find(s => s.id === t.status) || STATUSES[0];
                                const overdue = isOverdue(t);
                                return `
                                    <tr class="hover:bg-slate-50/80 transition-colors">
                                        <td class="p-3.5">
                                            <button type="button" onclick="window.KpiKanbanBoard.openTask(${jsArg(t.id)})" class="font-bold text-slate-900 hover:text-blue-600 text-left">
                                                ${esc(t.title)} <span class="text-[10px] text-violet-800">${esc(t.branch)}</span>
                                            </button>
                                            <div class="text-[11px] text-slate-400">${esc(t.id)} · ${esc(t.area)} · ${esc(t.category)}</div>
                                        </td>
                                        <td class="p-3.5 text-slate-700">${esc((t.ownerName || resolveEmployeeName(t.owner)))}</td>
                                        <td class="p-3.5">
                                            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${statusDef.badgeClass}">
                                                ${statusDef.label}
                                            </span>
                                        </td>
                                        <td class="p-3.5 font-num ${overdue ? 'text-red-600 font-bold' : 'text-slate-600'}">
                                            ${formatDate(t.due)}
                                        </td>
                                        <td class="p-3.5 text-center font-num text-slate-500">
                                            ${t.checklist.length ? `${t.checklist.filter(c => c.done).length}/${t.checklist.length}` : '—'}
                                        </td>
                                    </tr>
                                `;
                            }).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-400">ไม่พบงานที่ตรงกับตัวกรอง</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function setupDragAndDrop() {
        const cards = document.querySelectorAll('.task-card');
        const columns = document.querySelectorAll('.column[data-drop-status]');

        cards.forEach(card => {
            card.addEventListener('dragstart', e => {
                state.draggedTaskId = card.dataset.taskId;
                e.dataTransfer.setData('text/plain', state.draggedTaskId);
                card.classList.add('opacity-50');
            });
            card.addEventListener('dragend', () => {
                state.draggedTaskId = null;
                card.classList.remove('opacity-50');
                columns.forEach(col => col.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/50'));
            });
        });

        columns.forEach(col => {
            col.addEventListener('dragover', e => {
                e.preventDefault();
                col.classList.add('ring-2', 'ring-blue-500');
            });
            col.addEventListener('dragleave', () => {
                col.classList.remove('ring-2', 'ring-blue-500');
            });
            col.addEventListener('drop', async e => {
                e.preventDefault();
                col.classList.remove('ring-2', 'ring-blue-500');
                const taskId = state.draggedTaskId || e.dataTransfer.getData('text/plain');
                const targetStatus = col.dataset.dropStatus;
                if (!taskId || !targetStatus) return;

                const task = state.tasks.find(t => t.id === taskId);
                if (!task || task.status === targetStatus) return;

                // Mandatory reasons check for blocked and done
                if (targetStatus === 'blocked' && !task.blocked) {
                    openTask(taskId, 'blocked');
                    notify('กรุณาระบุสิ่งที่ติดขัดหรือกำลังรอก่อนย้ายงาน');
                    return;
                }
                if (targetStatus === 'done' && !task.note) {
                    openTask(taskId, 'done');
                    notify('กรุณาสรุปผลการทำงานก่อนปิดงาน');
                    return;
                }

                await updateTaskStatus(task, targetStatus);
            });
        });
    }

    async function updateTaskStatus(task,nextStatus) {
        await persistTask({...task,status:nextStatus});
    }

    // Modal / Drawer system
    function showDrawer(html) {
        const backdrop = document.getElementById('kpi-task-drawer-backdrop');
        const drawer = document.getElementById('kpi-task-drawer');
        if (!backdrop || !drawer) return;

        drawer.innerHTML = html;
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
        state.activeTaskId = null;
    }

    function openTask(id, forceStatus) {
        const t = findTask(id);
        if (!t) return;
        state.activeTaskId = t.id;
        const currentStatus = forceStatus || t.status;

        const ownerOptionsHtml = getEmployees(t.branch).map(e => `
            <option value="${esc(e.uid)}" ${String(e.uid) === String(t.owner) ? 'selected' : ''}>${esc(e.name)}</option>
        `).join('');

        const statusOptionsHtml = STATUSES.map(s => `
            <option value="${s.id}" ${s.id === currentStatus ? 'selected' : ''}>${s.label}</option>
        `).join('');

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <span class="text-xs font-bold text-slate-500 font-num">${esc(t.actionId)} · สาขา ${esc(t.branch)}</span>
                <button type="button" onclick="window.KpiKanbanBoard.closeDrawer()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>

            <h2 class="text-base font-bold text-slate-900 mb-2">${esc(t.title)}</h2>
            <div class="flex items-center gap-2 mb-3">
                <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${esc(t.category)}</span>
                <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${esc(t.area)}</span>
                <span class="text-[11px] font-bold px-2 py-0.5 rounded ${t.priority === 'high' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}">
                    ${t.priority === 'high' ? 'สำคัญสูง' : 'ปกติ'}
                </span>
            </div>
            <p class="text-xs text-slate-600 leading-relaxed mb-4 whitespace-pre-wrap">${esc(t.detail)}</p>

            ${t.sourceIssueId ? `
                <div class="mb-4 p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-inbox text-purple-600"></i>
                        <button type="button" onclick="window.KpiKanbanBoard.openClaimIssueModal(${jsArg(t.branch+'::'+t.sourceIssueId)})">รับจากเรื่องแจ้งปัญหา: <strong>${esc(t.sourceIssueId.replace('ISS-DEMO-', 'IS-'))}</strong> · ดูต้นทาง</button>
                    </div>
                </div>
            ` : ''}

            <!-- Task Edit Form -->
            <form id="kb-edit-task-form" onsubmit="window.KpiKanbanBoard.handleSaveTask(event)" class="space-y-3.5 mb-6">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">ผู้รับผิดชอบ</label>
                        <select name="owner" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                            ${ownerOptionsHtml}
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">กำหนดเสร็จ</label>
                        <input type="date" name="due" value="${esc(t.due)}" required class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">สถานะงาน</label>
                    <select name="status" id="kb-edit-status" onchange="window.KpiKanbanBoard.handleStatusFieldChange(this.value)" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500">
                        ${statusOptionsHtml}
                    </select>
                </div>

                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">ขั้นถัดไป</label>
                    <input type="text" name="next" value="${esc(t.next)}" placeholder="สิ่งที่ต้องทำต่อจากนี้" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                </div>

                <div id="kb-blocked-field" class="${currentStatus === 'blocked' ? '' : 'hidden'}">
                    <label class="block text-[11px] font-bold text-amber-800 mb-1">
                        <i class="fa-solid fa-triangle-exclamation mr-1"></i>ติดขัด / รออะไร (จำเป็นเมื่อเลือกสถานะนี้)
                    </label>
                    <input type="text" name="blocked" id="kb-blocked-input" value="${esc(t.blocked)}" placeholder="ระบุสิ่งที่รอและกำหนดนัดติดตาม" class="w-full p-2 bg-amber-50 border border-amber-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500">
                </div>

                <div id="kb-resolution-field" class="${currentStatus === 'done' ? '' : 'hidden'}">
                    <label class="block text-[11px] font-bold text-emerald-800 mb-1">
                        <i class="fa-solid fa-circle-check mr-1"></i>ผลการทำงาน / สรุปการปิดงาน (จำเป็นก่อนปิดงาน)
                    </label>
                    <textarea name="note" id="kb-resolution-input" placeholder="สรุปสิ่งที่ทำเสร็จแล้ว..." class="w-full p-2 bg-emerald-50 border border-emerald-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500 min-h-[70px]">${esc(t.note)}</textarea>
                </div>

                <div id="kb-form-error" class="hidden text-xs text-red-600 font-bold p-2 bg-red-50 rounded-lg"></div>

                <button type="submit" class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all">
                    <i class="fa-solid fa-check"></i>
                    <span>บันทึกการเปลี่ยนแปลง</span>
                </button>
            </form>

            <!-- Checklist Section -->
            <section class="mb-6 pt-4 border-t border-slate-200">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <i class="fa-solid fa-list-check text-blue-600"></i>
                        <span>Checklist</span>
                    </h3>
                    <span class="text-[11px] text-slate-400 font-num">${t.checklist.filter(c => c.done).length}/${t.checklist.length}</span>
                </div>
                <div class="space-y-1.5 mb-2.5">
                    ${t.checklist.map((c, idx) => `
                        <label class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 text-xs cursor-pointer">
                            <input type="checkbox" ${c.done ? 'checked' : ''} onchange="window.KpiKanbanBoard.toggleChecklist(${idx}, this.checked)" class="rounded text-blue-600 focus:ring-blue-500 w-4 h-4">
                            <span class="${c.done ? 'line-through text-slate-400' : 'text-slate-700'}">${esc(c.text)}</span>
                        </label>
                    `).join('') || '<p class="text-xs text-slate-400 py-1">ยังไม่มีขั้นตอนย่อย</p>'}
                </div>
                <form onsubmit="window.KpiKanbanBoard.addChecklistItem(event)" class="flex gap-2">
                    <input type="text" name="item" placeholder="เพิ่มขั้นตอนย่อย..." required class="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                    <button type="submit" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </form>
            </section>

            <!-- Comments Section -->
            <section class="mb-6 pt-4 border-t border-slate-200">
                <h3 class="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2.5">
                    <i class="fa-solid fa-message text-indigo-600"></i>
                    <span>ความคิดเห็น</span>
                </h3>
                <div class="space-y-2 mb-3 max-h-48 overflow-y-auto">
                    ${t.comments.map(c => `
                        <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                            <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                                <strong class="text-slate-700 font-bold">${esc(c.author)}</strong>
                                <span>${esc(c.time || '')}</span>
                            </div>
                            <p class="text-slate-700 whitespace-pre-wrap">${esc(c.text)}</p>
                        </div>
                    `).join('') || '<p class="text-xs text-slate-400 py-1">ยังไม่มีความคิดเห็น</p>'}
                </div>
                <form onsubmit="window.KpiKanbanBoard.addComment(event)" class="space-y-2">
                    <textarea name="comment" placeholder="พิมพ์ความคิดเห็น หรืออัปเดตงาน..." required class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px]"></textarea>
                    <button type="submit" class="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
                        <i class="fa-solid fa-paper-plane text-[10px]"></i>
                        <span>ส่งความคิดเห็น</span>
                    </button>
                </form>
            </section>

            <!-- History Log -->
            <section class="pt-4 border-t border-slate-200">
                <h3 class="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                    <i class="fa-solid fa-clock-rotate-left text-slate-400"></i>
                    <span>ประวัติงาน</span>
                </h3>
                <div class="space-y-1 text-[11px] text-slate-500">
                    ${t.history.map(h => `
                        <div class="flex items-start gap-1.5">
                            <i class="fa-solid fa-angle-right text-[10px] text-slate-400 mt-0.5"></i>
                            <span>${esc(typeof h==='string'?h:[h.details,h.actorUid,h.timestamp].filter(Boolean).join(' · '))}</span>
                        </div>
                    `).join('') || '<p class="text-xs text-slate-400">ไม่มีประวัติ</p>'}
                </div>
            </section>
        `;

        showDrawer(html);
        if(!canEdit(t)) { const drawer=document.getElementById('kpi-task-drawer'); drawer?.querySelectorAll('input,select,textarea,button[type="submit"]').forEach(el=>el.disabled=true); }
    }

    function handleStatusFieldChange(newStatus) {
        const blockedField = document.getElementById('kb-blocked-field');
        const resField = document.getElementById('kb-resolution-field');
        if (blockedField) blockedField.classList.toggle('hidden', newStatus !== 'blocked');
        if (resField) resField.classList.toggle('hidden', newStatus !== 'done');
    }

    async function handleSaveTask(e) {
        e.preventDefault();
        const form = e.target;
        const errEl = document.getElementById('kb-form-error');
        if (errEl) errEl.classList.add('hidden');

        const t = state.tasks.find(task => task.id === state.activeTaskId);
        if (!t) return;

        const formData = new FormData(form);
        const owner = formData.get('owner');
        if(!getEmployees(t.branch).some(employee=>employee.uid===owner)){notify('กรุณาเลือกผู้รับผิดชอบในสาขานี้');return;}
        const due = formData.get('due');
        const nextStatus = formData.get('status');
        const nextStep = (formData.get('next') || '').trim();
        const blocked = (formData.get('blocked') || '').trim();
        const note = (formData.get('note') || '').trim();

        if (nextStatus === 'blocked' && !blocked) {
            if (errEl) {
                errEl.textContent = 'กรุณาระบุสิ่งที่ติดขัดหรือกำลังรอก่อนบันทึก';
                errEl.classList.remove('hidden');
            }
            return;
        }

        if (nextStatus === 'done' && !note) {
            if (errEl) {
                errEl.textContent = 'กรุณาสรุปผลการทำงานก่อนปิดงาน';
                errEl.classList.remove('hidden');
            }
            return;
        }

        const saved=await persistTask({...t,owner,ownerName:resolveEmployeeName(owner,t.branch),due,next:nextStep,blocked,note,status:nextStatus});
        if(saved){closeDrawer();notify('บันทึกการเปลี่ยนแปลงแล้ว');}
    }

    async function toggleChecklist(index,done) {
        const t=state.tasks.find(t=>t.id===state.activeTaskId);if(!t||!t.checklist[index])return;
        const checklist=t.checklist.map((c,i)=>i===index?{...c,done}:c);
        const saved=await persistTask({...t,checklist});if(saved)openTask(saved.id);
    }

    async function addChecklistItem(e) {
        e.preventDefault();const t=state.tasks.find(t=>t.id===state.activeTaskId);if(!t)return;
        const text=e.target.querySelector('input[name="item"]')?.value.trim();if(!text)return;
        const saved=await persistTask({...t,checklist:[...t.checklist,{id:crypto.randomUUID(),text,done:false}]});if(saved)openTask(saved.id);
    }

    async function addComment(e) {
        e.preventDefault();const t=state.tasks.find(t=>t.id===state.activeTaskId);if(!t)return;
        const text=e.target.querySelector('textarea[name="comment"]')?.value.trim();if(!text)return;
        const saved=await persistTask({...t,comments:[...t.comments,{id:crypto.randomUUID(),text}]});if(saved){openTask(saved.id);notify('เพิ่มความคิดเห็นแล้ว');}
    }

    function updateCreationOwners(branch){const el=document.getElementById('kpi-task-drawer')?.querySelector('select[name="owner"]');if(el)el.innerHTML=getEmployees(branch).map(e=>`<option value="${esc(e.uid)}" ${e.uid===context().userUid?'selected':''}>${esc(e.name)}</option>`).join('');}
    function openNewTaskModal(initialStatus = 'open') {
        const currentUid = String(context().userUid || '').toLowerCase();
        const initialBranch=scope()==='ALL'?'':scope();
        const ownerOptionsHtml = getEmployees(initialBranch||'unselected').map(e => `
            <option value="${esc(e.uid)}" ${String(e.uid).toLowerCase() === currentUid ? 'selected' : ''}>${esc(e.name)}</option>
        `).join('');

        const today = typeof window.getTodayBangkokDateStr === 'function' ? window.getTodayBangkokDateStr() : new Date().toISOString().slice(0, 10);

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <span class="text-xs font-bold text-slate-500">สร้างงานใหม่</span>
                <button type="button" onclick="window.KpiKanbanBoard.closeDrawer()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <h2 class="text-base font-bold text-slate-900 mb-1">เพิ่มงานใหม่ให้ทีม</h2>
            <p class="text-xs text-slate-500 mb-4">ระบุงาน คนรับผิดชอบ และวันที่ต้องการให้เสร็จ</p>

            <form onsubmit="window.KpiKanbanBoard.handleCreateTask(event)" class="space-y-3.5">
                <input type="hidden" name="status" value="${esc(initialStatus)}">
                <label class="block text-xs font-bold text-slate-700">สาขาของงาน<select name="branch" required aria-label="สาขาของงาน" onchange="window.KpiKanbanBoard.updateCreationOwners(this.value)" class="mt-1 w-full p-2 border rounded-xl"><option value="">เลือกสาขา</option>${scopedBranches().map(b=>`<option value="${b}" ${b===initialBranch?'selected':''}>${b}</option>`).join('')}</select></label>
                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">ชื่องาน <span class="text-red-500">*</span></label>
                    <input type="text" name="title" required placeholder="เช่น จัดพื้นที่สินค้าโซน B" class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">รายละเอียด</label>
                    <textarea name="detail" placeholder="เป้าหมายหรือรายละเอียดที่ทีมควรรู้..." class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 min-h-[70px]"></textarea>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">ผู้รับผิดชอบ</label>
                        <select name="owner" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                            ${ownerOptionsHtml}
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">กำหนดเสร็จ</label>
                        <input type="date" name="due" required value="${today}" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">หมวดงาน</label>
                        <select name="category" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                            <option>คลังสินค้า</option>
                            <option>งานปรับปรุง</option>
                            <option>เอกสาร/ระบบ</option>
                            <option>หน้าร้าน TRD</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">ความสำคัญ</label>
                        <select name="priority" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="normal">ปกติ</option>
                            <option value="high">สำคัญสูง</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">พื้นที่</label>
                    <input type="text" name="area" placeholder="เช่น W1 / แร็ค A3" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">ขั้นถัดไป</label>
                    <input type="text" name="next" placeholder="สิ่งที่ต้องเริ่มทำก่อน" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500">
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="button" onclick="window.KpiKanbanBoard.closeDrawer()" class="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50">
                        ยกเลิก
                    </button>
                    <button type="submit" class="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all">
                        สร้างงาน
                    </button>
                </div>
            </form>
        `;

        showDrawer(html);
    }

    async function handleCreateTask(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const branch=formData.get('branch');if(!scopedBranches().includes(branch)){notify('กรุณาเลือกสาขาของงาน');return;}
        const title = (formData.get('title') || '').trim();
        if (!title) return;

        const id = `KB-${crypto.randomUUID()}`;
        const owner = formData.get('owner');
        if(!getEmployees(branch).some(employee=>employee.uid===owner)){notify('กรุณาเลือกผู้รับผิดชอบในสาขานี้');return;}
        const ownerName = resolveEmployeeName(owner,branch);
        const status = formData.get('status') || 'open';

        const newTask = {
            id,
            actionId: id,
            branch,
            title,
            detail: (formData.get('detail') || '').trim(),
            owner,
            ownerName,
            category: formData.get('category'),
            priority: formData.get('priority'),
            area: (formData.get('area') || 'คลัง '+branch).trim(),
            status,
            due: formData.get('due'),
            next: (formData.get('next') || 'รอเริ่มดำเนินงาน').trim(),
            blocked: '',
            note: '',
            checklist: [],
            comments: [],
            history: [`สร้างงาน · ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`],
            sourceIssueId: null,
            attachments: []
        };

        const saved=await persistTask({...newTask,revision:0});
        if(saved){closeDrawer();notify(`สร้างงาน ${saved.id} เรียบร้อยแล้ว`);}
    }

    function openClaimIssueModal(issueId) {
        if (!state.issueReady) { notify('ยังไม่ได้เชื่อมข้อมูลปัญหาต้นทาง'); return; }
        const issue = state.incomingIssues.find(i => i.id === issueId);
        if (!issue) { notify('ยังไม่ได้เชื่อมข้อมูลปัญหาต้นทาง'); return; }
        if (issue.taskId) {
            const task=state.tasks.find(t=>t.id===issue.taskId);
            showDrawer(`<h2 class="font-bold text-lg mb-4">${esc(issue.title)}</h2><p class="text-sm mb-3">${esc(issue.description)}</p><p class="text-xs mb-3">ผู้แจ้ง: ${esc(issue.reporter)} · ${esc(issue.area)}</p><p class="font-bold mb-3">ผู้รับผิดชอบ: ${esc(task?.ownerName||'ดูในงาน')} · ${esc(STATUSES.find(s=>s.id===task?.status)?.label||'')}</p><button type="button" class="p-3 bg-purple-100 rounded-lg" onclick="window.KpiKanbanBoard.openTask(${jsArg(issue.taskId)})">เปิดงานที่รับแล้ว</button><button type="button" class="p-3 ml-2" onclick="window.KpiKanbanBoard.closeDrawer()">ปิด</button>`);
            return;
        }

        const currentUid = String(context().userUid || '').toLowerCase();
        const ownerOptionsHtml = getEmployees(issue.branch).map(e => `
            <option value="${esc(e.uid)}" ${String(e.uid).toLowerCase() === currentUid ? 'selected' : ''}>${esc(e.name)}</option>
        `).join('');

        const today = typeof window.getTodayBangkokDateStr === 'function' ? window.getTodayBangkokDateStr() : new Date().toISOString().slice(0, 10);

        const html = `
            <div class="flex items-center justify-between pb-3 mb-4 border-b border-purple-200">
                <span class="text-xs font-bold text-purple-700">${esc(issue.id.replace('ISS-DEMO-', 'IS-'))} · เรื่องแจ้งปัญหา</span>
                <button type="button" onclick="window.KpiKanbanBoard.closeDrawer()" class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>
            <h2 class="text-base font-bold text-slate-900 mb-2">${esc(issue.title)}</h2>
            <p class="text-xs text-slate-600 leading-relaxed mb-4">${esc(issue.description)}</p>

            <div class="space-y-1 text-xs text-slate-500 mb-4 p-3 bg-purple-50/70 rounded-xl border border-purple-100">
                <div>ผู้แจ้ง: <strong>${esc(issue.reporter)}</strong></div>
                <div>พื้นที่: <strong>${esc(issue.area)}</strong></div>
                <div>ทีมที่เกี่ยวข้อง: <strong>${esc(issue.team)}</strong></div>
            </div>

            <form onsubmit="window.KpiKanbanBoard.handleClaimIssue(event, ${jsArg(issue.id)})" class="space-y-3.5">
                <div>
                    <label class="block text-[11px] font-bold text-slate-700 mb-1">ผู้รับงาน</label>
                    <select name="owner" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500">
                        ${ownerOptionsHtml}
                    </select>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">กำหนดเสร็จ</label>
                        <input type="date" name="due" required value="${today}" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">สถานะหลังรับงาน</label>
                        <select name="status" class="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="open">รอเริ่ม</option>
                            <option value="progress">กำลังทำ</option>
                        </select>
                    </div>
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="button" onclick="window.KpiKanbanBoard.closeDrawer()" class="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50">
                        ยกเลิก
                    </button>
                    <button type="submit" class="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm transition-all">
                        ยืนยันรับงาน
                    </button>
                </div>
            </form>
        `;

        showDrawer(html);
    }

    async function handleClaimIssue(e,issueId) {
        e.preventDefault();if(state.saving)return;
        const issue=state.incomingIssues.find(i=>i.id===issueId);if(!issue||issue.taskId||!state.issueReady)return;
        const data=new FormData(e.target),c=context(); state.saving=true;
        try {
            const res=await window.AkraSupabaseKPI.claimIssueTask(c.token,{branch:issue.branch,issueId:issue.sourceId||issueId,ownerUid:data.get('owner'),dueDate:data.get('due'),initialStatus:data.get('status')==='open'?'Open':'In Progress'});
            if(!res?.task)throw Error('invalid_response');
            await loadKanbanBoard();closeDrawer();notify('รับงานแล้ว');
        } catch(err){notify('รับงานไม่สำเร็จ กรุณารีเฟรชข้อมูลก่อนลองอีกครั้ง');await loadKanbanBoard();}
        finally{state.saving=false;}
    }

    // Filter controls
    function setView(viewMode) {
        state.view = viewMode;
        document.querySelectorAll('.kb-view-btn').forEach(btn => {
            const active = btn.dataset.view === viewMode;
            btn.classList.toggle('bg-white', active);
            btn.classList.toggle('text-blue-700', active);
            btn.classList.toggle('shadow-sm', active);
            btn.classList.toggle('text-slate-600', !active);
        });
        renderBoard();
    }

    function toggleOverdue() {
        state.overdueOnly = !state.overdueOnly;
        const btn = document.getElementById('kb-overdue-toggle');
        if (btn) {
            btn.classList.toggle('bg-red-50', state.overdueOnly);
            btn.classList.toggle('border-red-300', state.overdueOnly);
            btn.classList.toggle('text-red-700', state.overdueOnly);
        }
        renderBoard();
    }

    function initEventListeners() {
        if (state.isInitialized) return;
        state.isInitialized = true;

        const searchInput = document.getElementById('kb-search');
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                state.search = e.target.value;
                renderBoard();
            });
        }

        const ownerSelect = document.getElementById('kb-filter-owner');
        if (ownerSelect) {
            ownerSelect.addEventListener('change', e => {
                state.ownerFilter = e.target.value;
                renderBoard();
            });
        }

        const catSelect = document.getElementById('kb-filter-category');
        if (catSelect) {
            catSelect.addEventListener('change', e => {
                state.categoryFilter = e.target.value;
                renderBoard();
            });
        }
    }

    // Public API
    window.KpiKanbanBoard = {
        loadKanbanBoard,
        setBranchScope,
        updateCreationOwners,
        renderBoard,
        openTask,
        closeDrawer,
        openNewTaskModal,
        handleCreateTask,
        handleSaveTask,
        handleStatusFieldChange,
        toggleChecklist,
        addChecklistItem,
        addComment,
        openClaimIssueModal,
        handleClaimIssue,
        setView,
        toggleOverdue,
        initEventListeners
    };

})(window);
