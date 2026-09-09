/* Explicit Incident type/impact model; legacy scores are read-only history. */
(function (root) {
    'use strict';
    const labels = {
        contained: 'แก้ไขทันก่อนส่ง / ก่อนเกิดผลกระทบ',
        escaped_internal: 'ออกจากจุดงานแล้ว แต่ยังไม่ถึงลูกค้า',
        reached_customer: 'ถึงลูกค้าแล้ว / กระทบลูกค้าแล้ว',
        unknown: 'ยังไม่ทราบ / รอตรวจสอบ',
        not_applicable: 'ไม่เกี่ยวกับขั้นตอนส่งมอบ'
    };

    const impactMeta = {
        contained: {
            title: 'แก้ไขทันก่อนส่ง',
            sub: 'ก่อนเกิดผลกระทบ / ตรวจพบและแก้ทัน',
            badge: 'สกัดกั้นได้ทัน',
            icon: 'fa-shield-halved',
            borderAccent: 'border-l-emerald-500',
            bgLight: 'bg-emerald-50',
            borderLight: 'border-emerald-200',
            textColor: 'text-emerald-800',
            iconColor: 'text-emerald-600',
            activeRing: 'border-emerald-500 bg-gradient-to-r from-emerald-50/90 to-teal-50/50 ring-2 ring-emerald-500/25 text-emerald-950',
            dot: 'bg-emerald-500'
        },
        escaped_internal: {
            title: 'ออกจากจุดงานแล้ว',
            sub: 'ส่งผลข้ามจุดงาน แต่ยังไม่ถึงมือลูกค้า',
            badge: 'กระทบภายใน',
            icon: 'fa-arrows-split-up-and-left',
            borderAccent: 'border-l-amber-500',
            bgLight: 'bg-amber-50',
            borderLight: 'border-amber-200',
            textColor: 'text-amber-800',
            iconColor: 'text-amber-600',
            activeRing: 'border-amber-500 bg-gradient-to-r from-amber-50/90 to-orange-50/50 ring-2 ring-amber-500/25 text-amber-950',
            dot: 'bg-amber-500'
        },
        reached_customer: {
            title: 'ถึงลูกค้าแล้ว',
            sub: 'กระทบลูกค้าแล้ว / ได้รับข้อร้องเรียน',
            badge: 'ถึงมือลูกค้า',
            icon: 'fa-triangle-exclamation',
            borderAccent: 'border-l-rose-500',
            bgLight: 'bg-rose-50',
            borderLight: 'border-rose-200',
            textColor: 'text-rose-800',
            iconColor: 'text-rose-600',
            activeRing: 'border-rose-500 bg-gradient-to-r from-rose-50/90 to-red-50/50 ring-2 ring-rose-500/25 text-rose-950',
            dot: 'bg-rose-500'
        },
        unknown: {
            title: 'ยังไม่ทราบ',
            sub: 'รอตรวจสอบสาเหตุและผลกระทบแน่ชัด',
            badge: 'รอตรวจสอบ',
            icon: 'fa-circle-question',
            borderAccent: 'border-l-sky-500',
            bgLight: 'bg-sky-50',
            borderLight: 'border-sky-200',
            textColor: 'text-sky-800',
            iconColor: 'text-sky-600',
            activeRing: 'border-sky-500 bg-gradient-to-r from-sky-50/90 to-blue-50/50 ring-2 ring-sky-500/25 text-sky-950',
            dot: 'bg-sky-500'
        },
        not_applicable: {
            title: 'ไม่เกี่ยวกับส่งมอบ',
            sub: 'ขั้นตอนภายใน เช่น 5ส, การแต่งกาย, เข้างาน',
            badge: 'ไม่เกี่ยวส่งมอบ',
            icon: 'fa-ban',
            borderAccent: 'border-l-slate-400',
            bgLight: 'bg-slate-50',
            borderLight: 'border-slate-200',
            textColor: 'text-slate-700',
            iconColor: 'text-slate-500',
            activeRing: 'border-slate-400 bg-slate-100 ring-2 ring-slate-400/25 text-slate-900',
            dot: 'bg-slate-400'
        }
    };

    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const state = { branch: '', date: '', typeId: '', impact: '', revision: 0, editing: null, pending: null, busy: false, participantsChanged: false };
    const model = () => typeof KPI_SYSTEM_CONFIG !== 'undefined' ? KPI_SYSTEM_CONFIG?.incidentModel : null;
    const enabled = () => model()?.schemaVersion === 3 && (model().active === true || Boolean(model().activatedAt));
    const byId = id => document.getElementById(id);
    const types = () => model()?.branches?.[currentBranch]?.types || [];
    const selected = () => types().find(t => t.id === state.typeId && t.active);
    const isNew = row => row?.schemaVersion === 3 && row?.scoringMode === 'none';

    const impactDefinitions = (branch = currentBranch) => model()?.branches?.[branch]?.impacts
        || Object.entries(labels).map(([id, label]) => ({id, label}));

    function impactLabel(value, branch = currentBranch) {
        if (value && typeof value === 'object') {
            if (value.impact === '' || value.impact === null) return value.impactLabel || 'ไม่มีผลกระทบ';
            return value.impactLabel || labels[value.impact] || value.impact || 'ข้อมูลเดิม';
        }
        if (value === '' || value === null) return 'ไม่มีผลกระทบ';
        return impactDefinitions(branch).find(i => i.id === value)?.label || labels[value] || value || 'ไม่มีผลกระทบ';
    }

    function visualImpact(id) {
        if (!id) {
            return {
                title: 'ไม่มีผลกระทบ',
                sub: 'ไม่มีผลกระทบต่อลูกค้า',
                badge: 'ไม่มีผลกระทบ',
                icon: 'fa-minus',
                borderAccent: 'border-l-slate-300',
                bgLight: 'bg-slate-50',
                borderLight: 'border-slate-200',
                textColor: 'text-slate-600',
                iconColor: 'text-slate-400',
                activeRing: 'border-slate-400 bg-slate-100 ring-2 ring-slate-400/25 text-slate-800',
                dot: 'bg-slate-400'
            };
        }
        const original = impactMeta[id] || impactMeta.not_applicable;
        const label = impactLabel(id);
        return label === labels[id] ? original : {...original, badge: label, sub: label};
    }

    function weekRange(date) {
        const day = new Date(`${date}T00:00:00Z`);
        if (!Number.isFinite(day.getTime())) return {start: '', end: ''};
        day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
        const start = day.toISOString().slice(0, 10);
        day.setUTCDate(day.getUTCDate() + 6);
        return {start, end: day.toISOString().slice(0, 10)};
    }

    function weekCases() {
        const date = byId('record-date-error')?.value, range = weekRange(date);
        const days = JSON.parse(safeStorage.getItem(`kpiData_${currentBranch}`) || '[]');
        const byDate = new Map(days.filter(d => !d.branch || d.branch === currentBranch)
            .map(d => [normalizeClientDateKey(d.date), d.incidentCases || []]));
        // Keep the selected day's authoritative preview while a save refreshes the cache.
        if (recordedErrorCases.length || !byDate.has(date)) byDate.set(date, recordedErrorCases);
        return [...byDate].filter(([d]) => d >= range.start && d <= range.end)
            .flatMap(([recordDate, rows]) => rows.filter(r => r.caseId && r.caseId !== 'NO_ERRORS' && !r.cancelled)
                .map(r => ({...r, recordDate, branch: currentBranch})))
            .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || String(b.time || '').localeCompare(String(a.time || '')));
    }

    function isAchievement(row) {
        return !isNew(row) && String(row?.type || '').startsWith('ผลงาน: ')
            && ['good_catch','team_support','kaizen','special','service','5s'].includes(row?.category)
            && row?.responsibility === 'process' && Number(row?.penalty) === 0;
    }

    function legacyImpact(row) {
        let meta = {};
        const note = String(row.note || '');
        const marker = note.match(/\[(?:AKRA|TRD)_CASE:([^\]]+)\]/);
        if (marker) {
            try { meta = JSON.parse(decodeURIComponent(marker[1])); }
            catch { /* Unreadable history stays unknown. */ }
        }
        const type = meta.type || row.type;
        if (['หยิบผิด ถึงลูกค้าแล้ว','ส่งถึงลูกค้าแล้ว','จัดสินค้าผิด (ถึงลูกค้าแล้ว)','จัดสินค้าผิด (ถึงลูกค้า / ร้องเรียน)','ปล่อยของผิดถึงลูกค้า (Checker)'].includes(type) || note.startsWith('[ถึงลูกค้าแล้ว]')) return 'reached_customer';
        if (['หยิบผิด แก้ทันก่อนจัดส่ง','แก้ไขได้ก่อนจัดส่ง','จัดสินค้าผิด (แก้ไขทัน)','จัดสินค้าผิด (ตรวจพบและแก้ทัน)'].includes(type) || note.startsWith('[แก้ไขได้ก่อนส่ง]')) return 'contained';
        if (type === 'หยิบผิด ถึงหน้าร้านแล้ว') return 'escaped_internal';
        return 'unknown';
    }

    function summarize(rows) {
        const unique = new Map();
        (rows || []).forEach((row, i) => {
            if (row.kind === 'zero' || row.caseId === 'NO_ERRORS' || row.type === 'ไม่มีความผิดพลาด' || isAchievement(row) || row.cancelled) return;
            const key = `${row.branch || ''}|${row.caseId || `legacy-${i}`}`;
            if (!unique.has(key)) unique.set(key, row);
        });
        const result = { total: unique.size, impact: Object.fromEntries(Object.keys(labels).map(k => [k, 0])), types: {}, people: {} };
        for (const row of unique.values()) {
            const impact = isNew(row) ? row.impact : legacyImpact(row);
            result.impact[impact] = (result.impact[impact] || 0) + 1;
            const key = row.typeId || row.type || 'ไม่ระบุประเภท';
            result.types[key] = (result.types[key] || 0) + 1;
            for (const name of new Set(row.participants || [row.worker || row.emp].filter(Boolean))) {
                result.people[name] = (result.people[name] || 0) + 1;
            }
        }
        return result;
    }

    function dirty() { if (!state.busy) state.pending = null; }

    function choose(id) {
        if (state.busy) return;
        dirty();
        state.typeId = id;
        state.impact = '';
        state.revision = model()?.catalogRevision || 0;
        render();
    }

    function impact(value) {
        if (state.busy || !selected()?.impacts.includes(value)) return;
        dirty();
        state.impact = value;
        renderOptions();
    }

    function reset() {
        if (state.busy) return;
        Object.assign(state, { typeId: '', impact: '', editing: null, pending: null, participantsChanged: false });
        if (byId('pc-err-note-input')) byId('pc-err-note-input').value = '';
        if (byId('impact-reason')) byId('impact-reason').value = '';
        if (byId('impact-detector')) byId('impact-detector').value = '';
        if (byId('inc-quick-search')) byId('inc-quick-search').value = '';
        byId('inc-success-card')?.classList.add('hidden');
        render();
        renderErrEmpChips();
        summary();
    }

    function render() {
        if (!enabled()) return;
        const body = byId('inc-form-body');
        if (!body) return;
        const date = byId('record-date-error')?.value || '';

        if (state.branch !== currentBranch || state.date !== date || body.dataset.model !== '3') {
            Object.assign(state, { branch: currentBranch, date, typeId: '', impact: '', editing: null, pending: null, participantsChanged: false });
            byId('inc-success-card')?.classList.add('hidden');
            body.dataset.model = '3';
            body.innerHTML = `
                <!-- Zero Error Confirmation (Restricted to Checker / Lead / Admin) -->
                <div id="zero-error-wrapper">
                    <button type="button" id="btn-confirm-zero-errors" onclick="handleZeroErrorClick()" class="w-full py-2.5 px-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold text-xs flex items-center justify-between transition-all active:scale-98 shadow-sm cursor-pointer">
                        <div class="flex items-center gap-2">
                            <div class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs shrink-0">
                                <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                            </div>
                            <span>วันนี้ตรวจแล้ว ไม่พบข้อผิดพลาด</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span id="zero-error-role-badge" class="text-[9px] bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-md font-bold">Checker / Lead</span>
                            <span class="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-md font-bold">ยืนยัน Zero Error</span>
                        </div>
                    </button>
                </div>

                <!-- Active Editing Alert Banner (shown only when editing) -->
                <div id="inc-editing-banner" class="hidden p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between gap-2 text-xs">
                    <div class="flex items-center gap-2 text-amber-900 font-bold min-w-0">
                        <i class="fa-solid fa-pen-to-square text-amber-600 shrink-0" aria-hidden="true"></i>
                        <span id="inc-editing-title" class="truncate">กำลังอยู่ในโหมดแก้ไขรายการ</span>
                    </div>
                    <button type="button" onclick="KpiIncident.reset()" class="text-[11px] px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-800 font-bold rounded-lg border border-amber-200 transition-colors shrink-0">
                        ยกเลิก
                    </button>
                </div>

                <fieldset id="impact-fields" class="space-y-3.5">
                    <!-- Section 1: เกิดอะไรขึ้น? -->
                    <section class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div class="flex items-center justify-between">
                            <label for="inc-quick-search" class="font-bold text-sm text-slate-900 flex items-center gap-2">
                                <span class="w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-bold shadow-sm">1</span>
                                <span>เกิดอะไรขึ้น? (ประเภทความผิดพลาด)</span>
                            </label>
                            <span id="inc-type-selected-badge" class="text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 border border-slate-200">ยังไม่เลือก</span>
                        </div>

                        <!-- Live Search Input -->
                        <div class="relative">
                            <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-3.5 text-slate-400 text-xs pointer-events-none" aria-hidden="true"></i>
                            <input id="inc-quick-search" placeholder="ค้นหาประเภทความผิดพลาด (พิมพ์เพื่อค้นหาทุกประเภท)..." class="w-full pl-9 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400" oninput="KpiIncident.search(this.value)">
                            <button type="button" id="inc-search-clear-btn" onclick="document.getElementById('inc-quick-search').value='';KpiIncident.search('');this.classList.add('hidden');" class="hidden absolute right-3 top-3 text-slate-400 hover:text-slate-600 text-xs cursor-pointer">
                                <i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
                            </button>
                        </div>

                        <!-- Quick Templates Header -->
                        <div class="flex items-center justify-between text-xs text-slate-500 font-medium pt-0.5">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-star text-amber-500" aria-hidden="true"></i>ใช้บ่อย · เลือกจากรายการประจำสาขา</span>
                            <span class="text-[10px] text-slate-400">แตะเพื่อเลือก</span>
                        </div>
                        <div id="inc-quick-templates" class="grid grid-cols-2 gap-2"></div>
                    </section>

                    <!-- Section 2: ผลกระทบ / พบตอนไหน? -->
                    <section class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-2">
                                <span class="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold shadow-sm">2</span>
                                <span>ผลกระทบ / พบตอนไหน?</span>
                            </h3>
                            <span id="inc-impact-selected-badge" class="text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">ระดับผลกระทบ</span>
                        </div>
                        <div id="inc-impact-options" class="space-y-2"></div>
                    </section>

                    <!-- Section 3: ใครเกี่ยวข้อง? -->
                    <section class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 id="inc-worker-label" class="font-bold text-sm text-slate-900 flex items-center gap-2">
                                <span class="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shadow-sm">3</span>
                                <span>ใครเกี่ยวข้อง? (ผู้มีส่วนร่วม)</span>
                            </h3>
                            <span id="inc-worker-selected-badge" class="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200"></span>
                        </div>
                        <p class="text-xs text-slate-500 flex items-center gap-1">
                            <i class="fa-solid fa-circle-info text-blue-500" aria-hidden="true"></i>
                            <span>ผู้เกี่ยวข้องยังไม่ถือว่าเป็นผู้ผิดโดยอัตโนมัติ</span>
                        </p>
                        <div id="pc-err-emp-chips" class="grid grid-cols-2 sm:grid-cols-3 gap-2"></div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                            <label class="block text-xs font-bold text-slate-700 space-y-1">
                                <span class="flex items-center gap-1.5"><i class="fa-solid fa-users-gear text-slate-400" aria-hidden="true"></i>ลักษณะความรับผิดชอบ</span>
                                <div class="relative">
                                    <select id="impact-responsibility" class="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl p-2.5 pr-8 text-xs font-medium outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer" onchange="selectedIncidentResponsibility=this.value;KpiIncident.dirty();KpiIncident.summary()">
                                        <option value="individual">👤 รายบุคคล</option>
                                        <option value="team">👥 ทีมทั้งกะ</option>
                                        <option value="process">⚙️ กระบวนการ / ระบบ</option>
                                        <option value="pending">❓ รอตรวจสอบ</option>
                                    </select>
                                    <i class="fa-solid fa-chevron-down absolute right-3 top-3.5 text-slate-400 text-[10px] pointer-events-none" aria-hidden="true"></i>
                                </div>
                            </label>
                            <label class="block text-xs font-bold text-slate-700 space-y-1">
                                <span class="flex items-center gap-1.5"><i class="fa-solid fa-user-check text-slate-400" aria-hidden="true"></i>ผู้ตรวจพบ (ไม่บังคับ)</span>
                                <div class="relative">
                                    <select id="impact-detector" class="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl p-2.5 pr-8 text-xs font-medium outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer" onchange="KpiIncident.dirty()"></select>
                                    <i class="fa-solid fa-chevron-down absolute right-3 top-3.5 text-slate-400 text-[10px] pointer-events-none" aria-hidden="true"></i>
                                </div>
                            </label>
                        </div>
                    </section>

                    <!-- Section 4: รายละเอียด / เลขบิล -->
                    <section class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <label for="pc-err-note-input" class="font-bold text-sm text-slate-900 flex items-center justify-between">
                            <span class="flex items-center gap-2">
                                <span class="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shadow-sm">4</span>
                                <span>รายละเอียด / เลขบิล (ไม่บังคับ)</span>
                            </span>
                            <span class="text-[10px] text-slate-400 font-normal">เช่น เลขบิล, รายการที่ผิด</span>
                        </label>
                        <textarea id="pc-err-note-input" maxlength="1000" rows="3" placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี) เช่น เลขที่คำสั่งซื้อ, จำนวนที่ผิด, รายละเอียดที่พบ..." class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400" oninput="KpiIncident.dirty()"></textarea>

                        <label id="impact-reason-label" class="hidden block text-xs font-bold text-amber-900 bg-amber-50/80 p-3 rounded-xl border border-amber-200 space-y-1.5">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-pen-to-square text-amber-600" aria-hidden="true"></i>เหตุผลที่แก้ไข (จำเป็นสำหรับการบันทึกประวัติ) *</span>
                            <input id="impact-reason" maxlength="1000" placeholder="ระบุเหตุผลในการแก้ไขข้อมูล..." class="w-full border border-amber-300 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-amber-500/30 outline-none" oninput="KpiIncident.dirty()">
                        </label>
                    </section>

                    <!-- Review / Summary banner -->
                    <div class="p-3.5 rounded-2xl bg-gradient-to-r from-slate-50 to-blue-50/50 border border-blue-100 shadow-sm space-y-1">
                        <div class="flex items-center justify-between text-xs font-bold text-blue-900">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-clipboard-check text-blue-600" aria-hidden="true"></i>สรุปข้อมูลที่จะบันทึก</span>
                            <span class="text-[10px] text-slate-400 font-normal">ตรวจสอบก่อนกดบันทึก</span>
                        </div>
                        <p id="impact-summary" role="status" class="text-xs font-semibold text-slate-700 leading-relaxed"></p>
                    </div>

                    <!-- Submit & Controls -->
                    <div class="space-y-2 pt-1">
                        <button id="btn-save-error-preview" type="button" onclick="saveErrorCaseFromPreview()" class="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer">
                            <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                            <span>บันทึกเหตุการณ์</span>
                        </button>
                        <button type="button" onclick="KpiIncident.reset()" class="w-full py-2 px-3 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                            <i class="fa-solid fa-rotate-left text-slate-400" aria-hidden="true"></i>
                            <span>ล้างรายการ / ยกเลิกการแก้ไข</span>
                        </button>
                    </div>
                </fieldset>

                <button type="button" onclick="KpiIncident.history()" class="w-full py-3 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer">
                    <i class="fa-solid fa-clock-rotate-left text-slate-400" aria-hidden="true"></i>
                    <span>ประวัติการบันทึกและแก้ไขของวันที่เลือก</span>
                </button>
            `;

            renderErrEmpChips();
            byId('impact-detector').innerHTML = '<option value="">ไม่ระบุ / ตรวจพบเอง</option>' + getBranchActiveRoster(currentBranch).map(n => `<option>${escape(n)}</option>`).join('');
            byId('impact-responsibility').value = selectedIncidentResponsibility || 'individual';
        }

        search(byId('inc-quick-search')?.value || '');
        renderOptions();

        const isEditing = Boolean(state.editing);
        byId('impact-reason-label')?.classList.toggle('hidden', !isEditing);
        const editingBanner = byId('inc-editing-banner');
        if (editingBanner) {
            editingBanner.classList.toggle('hidden', !isEditing);
            if (isEditing) {
                const titleEl = byId('inc-editing-title');
                if (titleEl) titleEl.textContent = `กำลังแก้ไขเคส: ${state.editing.type || state.editing.caseId}`;
            }
        }

        const saveBtn = byId('btn-save-error-preview');
        if (saveBtn) {
            saveBtn.innerHTML = isEditing
                ? '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>บันทึกการแก้ไข</span>'
                : '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i><span>บันทึกเหตุการณ์</span>';
        }

        renderConfirmZeroErrorsButton();
        if (byId('impact-fields')) byId('impact-fields').disabled = state.busy;
    }

    function search(query) {
        const q = String(query || '').trim().toLowerCase();
        const list = types().filter(t => t.active && (q ? t.name.toLowerCase().includes(q) : t.quick));
        const container = byId('inc-quick-templates');
        const clearBtn = byId('inc-search-clear-btn');
        if (clearBtn) clearBtn.classList.toggle('hidden', !q);
        if (!container) return;

        if (!list.length) {
            container.innerHTML = `
                <div class="col-span-2 p-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 text-center text-xs text-slate-500 space-y-1">
                    <i class="fa-solid fa-magnifying-glass text-slate-400 text-sm mb-1 block" aria-hidden="true"></i>
                    <p class="font-semibold text-slate-700">ไม่พบประเภทที่ค้นหา</p>
                    <p class="text-[11px] text-slate-400">ลองพิมพ์คำอื่น หรือค้นหาคำสั้นๆ</p>
                </div>`;
            return;
        }

        container.innerHTML = list.map(t => {
            const isSelected = t.id === state.typeId;
            return `
                <button type="button" data-type-id="${escape(t.id)}" onclick="KpiIncident.choose('${escape(t.id)}')" aria-pressed="${isSelected}" class="p-3 rounded-2xl border text-left text-xs transition-all active:scale-[0.98] flex items-center justify-between gap-2 cursor-pointer ${isSelected ? 'border-blue-600 bg-gradient-to-r from-blue-50 to-indigo-50/80 text-blue-950 font-bold shadow-xs ring-2 ring-blue-500/30' : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-medium'}">
                    <span class="truncate">${escape(t.name)}</span>
                    ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-xs shrink-0" aria-hidden="true"></i>' : ''}
                </button>
            `;
        }).join('');
    }

    function renderOptions() {
        const type = selected();
        const container = byId('inc-impact-options');
        if (!container) return;

        if (!type) {
            container.innerHTML = `
                <div class="p-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 text-center space-y-2">
                    <div class="w-9 h-9 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm">
                        <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
                    </div>
                    <p class="text-xs font-bold text-slate-600">กรุณาเลือกประเภทข้อผิดพลาดในข้อ 1 ก่อน</p>
                    <p class="text-[11px] text-slate-400">ระบบจะแสดงระดับผลกระทบที่สอดคล้องกับประเภทที่เลือก</p>
                </div>`;
            summary();
            return;
        }

        if (!type.impacts || !type.impacts.length) {
            container.innerHTML = `
                <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/80 flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 text-sm border border-slate-200">
                        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                    </div>
                    <div>
                        <span class="font-bold text-xs text-slate-800">ไม่มีผลกระทบต่อลูกค้า</span>
                        <p class="text-[11px] text-slate-500 mt-0.5">ประเภทนี้ไม่มีผลกระทบถึงลูกค้า ไม่ต้องเลือกระดับผลกระทบ สามารถกดบันทึกได้ทันที</p>
                    </div>
                </div>`;
            summary();
            return;
        }

        container.innerHTML = type.impacts.map(i => {
            const isSelected = state.impact === i;
            const meta = visualImpact(i);
            const fullLabel = impactLabel(i);
            const radioStyle = isSelected ? `${meta.dot} border-transparent` : 'border-slate-300 bg-white';
            return `
                <button type="button" data-impact="${escape(i)}" onclick="KpiIncident.impact('${escape(i)}')" aria-pressed="${isSelected}" class="w-full p-3.5 rounded-2xl border text-left transition-all active:scale-[0.99] flex items-center justify-between gap-3 cursor-pointer ${isSelected ? meta.activeRing + ' shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50/80 hover:border-slate-300 text-slate-700'}">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-9 h-9 rounded-xl ${meta.bgLight} ${meta.textColor} flex items-center justify-center shrink-0 text-sm border ${meta.borderLight}">
                            <i class="fa-solid ${meta.icon}" aria-hidden="true"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-bold text-xs md:text-sm text-slate-900">${escape(fullLabel)}</span>
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.bgLight} ${meta.textColor} border ${meta.borderLight}">${escape(meta.badge)}</span>
                            </div>
                            <p class="text-[11px] text-slate-500 mt-0.5 truncate">${escape(meta.sub)}</p>
                        </div>
                    </div>
                    <div class="shrink-0 flex items-center">
                        <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${radioStyle}">
                            ${isSelected ? '<i class="fa-solid fa-check text-[10px] text-white" aria-hidden="true"></i>' : ''}
                        </div>
                    </div>
                </button>
            `;
        }).join('');
        summary();
    }

    function summary() {
        if (!byId('impact-summary')) return;
        const people = state.editing && !state.participantsChanged
            ? state.editing.participants
            : selectedErrWorker === 'ทุกคนในกะ'
                ? getBranchActiveRoster(currentBranch)
                : [selectedErrWorker].filter(Boolean);

        const typeBadge = byId('inc-type-selected-badge');
        if (typeBadge) {
            if (selected()) {
                typeBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200';
                typeBadge.textContent = selected().name;
            } else {
                typeBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-500 border border-slate-200';
                typeBadge.textContent = 'ยังไม่เลือก';
            }
        }

        const impactBadge = byId('inc-impact-selected-badge');
        if (impactBadge) {
            if (state.impact) {
                const m = visualImpact(state.impact);
                impactBadge.className = `text-[10px] font-bold px-2.5 py-0.5 rounded-lg ${m.bgLight} ${m.textColor} border ${m.borderLight}`;
                impactBadge.textContent = m.badge;
            } else if (selected() && (!selected().impacts || !selected().impacts.length)) {
                impactBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200';
                impactBadge.textContent = 'ไม่มีผลกระทบ';
            } else {
                impactBadge.className = 'text-[10px] font-bold px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200';
                impactBadge.textContent = 'ระดับผลกระทบ';
            }
        }

        const impactText = (selected() && (!selected().impacts || !selected().impacts.length))
            ? 'ไม่มีผลกระทบ'
            : (impactLabel(state.impact) || 'ยังไม่เลือกผลกระทบ');
        byId('impact-summary').textContent = `${currentBranch} · ${selected()?.name || 'ยังไม่เลือกประเภท'} · ${impactText} · ${people.join(', ') || 'ยังไม่เลือกผู้เกี่ยวข้อง'}`;
    }

    function message(error) {
        return {
            catalog_changed: 'รายการมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วเลือกอีกครั้ง',
            incident_conflict: 'รายการนี้มีการแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่ก่อนแก้ไข',
            incident_update_required: 'กรุณาโหลดแอปเวอร์ชันล่าสุดก่อนบันทึก',
            incident_model_unavailable: 'ระบบบันทึกใหม่ยังไม่เปิดใช้งาน',
            same_day_required: 'แก้ไขได้เฉพาะรายการของวันนี้'
        }[error?.message] || error?.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
    }

    function applyResult(branch, date, result) {
        applyIncidentSaveResultToCache(date, branch, result);
        if (currentBranch === branch && byId('record-date-error')?.value === date) {
            recordedErrorCases = result.incidents;
            incidentZeroConfirmed = result.zeroConfirmed;
            renderErrTimeline();
            renderErrTeamHp();
        }
        if (currentBranch === branch) renderErrTimeline();
        loadDashboardData();
        updateDailyDashboard();
    }

    async function save() {
        if (state.busy) return;
        const type = selected(), date = byId('record-date-error')?.value;
        if (!type) return showToast('กรุณาเลือกประเภทข้อผิดพลาด', true);
        if (type.impacts && type.impacts.length > 0 && !type.impacts.includes(state.impact)) {
            return showToast('กรุณาเลือกผลกระทบให้ครบ', true);
        }
        if (state.revision !== model().catalogRevision) return showToast('รายการมีการเปลี่ยนแปลง กรุณาเลือกใหม่', true);
        if (!date || !selectedErrWorker) return showToast('กรุณาเลือกวันที่และผู้เกี่ยวข้อง', true);
        const reason = byId('impact-reason').value.trim();
        if (state.editing && !reason) return showToast('กรุณาระบุเหตุผลที่แก้ไข', true);

        if (!state.pending) {
            const now = new Date();
            const preservePeople = state.editing && !state.participantsChanged;
            const roster = preservePeople ? [...state.editing.participants] : getBranchActiveRoster(currentBranch);
            state.pending = {
                branch: currentBranch,
                date,
                expectedRevision: state.editing?.revision || 0,
                reason,
                incident: {
                    schemaVersion: 3,
                    scoringMode: 'none',
                    kind: 'case',
                    caseId: state.editing?.caseId || `ERR-${date}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                    typeId: type.id,
                    impact: (type.impacts && type.impacts.length > 0) ? state.impact : '',
                    catalogRevision: state.revision,
                    worker: preservePeople ? state.editing.worker : selectedErrWorker,
                    participants: preservePeople ? [...state.editing.participants] : selectedErrWorker === 'ทุกคนในกะ' ? roster : [selectedErrWorker],
                    roster,
                    responsibility: selectedIncidentResponsibility || 'individual',
                    detectedBy: byId('impact-detector').value,
                    note: byId('pc-err-note-input').value.trim(),
                    time: state.editing?.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`
                }
            };
        }

        const request = JSON.parse(JSON.stringify(state.pending));
        state.busy = true;
        if (byId('impact-fields')) byId('impact-fields').disabled = true;
        const dateInputs = [...document.querySelectorAll('.app-record-date')].map(el => ({ el, disabled: el.disabled }));
        dateInputs.forEach(({ el }) => el.disabled = true);

        try {
            const result = state.editing
                ? await AkraSupabaseKPI.updateIncident(sessionToken, request)
                : await AkraSupabaseKPI.saveIncident(sessionToken, request.branch, request.date, request.incident);
            const saved = result.incidents.find(i => i.caseId === request.incident.caseId);
            if (!saved) throw Error('invalid_incident_response');
            applyResult(request.branch, request.date, result);
            if (currentBranch === request.branch && byId('record-date-error').value === request.date) {
                byId('inc-success-summary').textContent = `${request.branch} · ${saved.type} · ${impactLabel(saved)} · ${(saved.participants || [saved.worker]).join(', ')}`;
                byId('inc-success-card').classList.remove('hidden');
                state.pending = null;
                state.editing = null;
                state.typeId = '';
                state.impact = '';
                byId('pc-err-note-input').value = '';
                render();
            }
            showToast(`บันทึกเหตุการณ์ ${request.branch} แล้ว`);
        } catch (e) {
            showToast(message(e), true);
        } finally {
            state.busy = false;
            if (byId('impact-fields')) byId('impact-fields').disabled = false;
            dateInputs.forEach(({ el, disabled }) => el.disabled = disabled);
        }
    }

    function edit(caseId) {
        const row = weekCases().find(r => r.caseId === caseId);
        if (!row || isAchievement(row) || state.busy) return;
        const date = row.recordDate;
        if (byId('record-date-error').value !== date) syncAppRecordDate(date);
        state.branch = currentBranch;
        state.date = date;
        state.editing = row;
        state.participantsChanged = false;
        state.typeId = row.typeId || types().find(t => t.active && t.legacyNames?.includes(row.type))?.id || '';
        state.impact = isNew(row) ? row.impact : '';
        state.revision = model()?.catalogRevision || 0;
        state.pending = null;
        selectedErrWorker = row.worker;
        selectedIncidentResponsibility = row.responsibility;
        render();
        renderErrEmpChips();
        const detector = byId('impact-detector');
        if (row.detectedBy && !Array.from(detector.options).some(o => o.value === row.detectedBy)) {
            detector.add(new Option(row.detectedBy, row.detectedBy));
        }
        byId('pc-err-note-input').value = row.note || '';
        byId('impact-detector').value = row.detectedBy || '';
        byId('impact-responsibility').value = row.responsibility;
        byId('impact-reason').value = '';
        if (!isNew(row)) showToast('รายการเดิม: เลือกประเภทและผลกระทบใหม่ คะแนนเดิมจะเก็บไว้ในประวัติ');
        byId('inc-form-body').scrollIntoView({ block: 'start' });
    }

    function dialog(title) {
        byId('impact-dialog')?.remove();
        const d = document.createElement('dialog');
        d.id = 'impact-dialog';
        d.className = 'rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-slate-200 bg-white backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm';
        d.innerHTML = `
            <div class="flex items-center justify-between pb-3.5 border-b border-slate-100">
                <h3 class="font-bold text-base text-slate-900 flex items-center gap-2">
                    <i class="fa-solid fa-layer-group text-slate-400" aria-hidden="true"></i>
                    <span>${escape(title)}</span>
                </h3>
                <button type="button" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer" onclick="document.getElementById('impact-dialog').close()" aria-label="ปิด">
                    <i class="fa-solid fa-xmark text-sm" aria-hidden="true"></i>
                </button>
            </div>
            <div id="impact-dialog-body" class="mt-4 space-y-3.5 max-h-[65vh] overflow-y-auto pr-1"></div>
            <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                <button type="button" class="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-600 transition-all cursor-pointer" onclick="document.getElementById('impact-dialog').close()">ปิด</button>
            </div>
        `;
        document.body.appendChild(d);
        d.showModal();
        return byId('impact-dialog-body');
    }

    function cancel(caseId) {
        const row = weekCases().find(r => r.caseId === caseId);
        if (!row) return;
        const branch = currentBranch, date = row.recordDate;
        const body = dialog('ลบ Incident โดยเก็บประวัติ');
        body.innerHTML = `
            <div class="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-start gap-3">
                <div class="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-sm shrink-0 mt-0.5">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                </div>
                <div class="space-y-1">
                    <strong class="font-bold block text-red-950">ยืนยันการลบเหตุการณ์</strong>
                    <p class="text-red-800 leading-relaxed">การลบจะทำเครื่องหมายว่ายกเลิก โดยระบบจะบันทึกประวัติการขอยกเลิกและเหตุผลไว้ในระบบ Audit เสมอ</p>
                </div>
            </div>
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span class="text-[11px] text-slate-400 font-medium block">รายการที่ต้องการลบ:</span>
                <span class="font-bold text-slate-900 text-sm block">${escape(row.type)}</span>
                <span class="text-xs text-slate-500">${escape(row.worker)} · ${escape(row.time)}</span>
            </div>
            <label class="block text-xs font-bold text-slate-700 space-y-1.5">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-pen text-slate-400" aria-hidden="true"></i>เหตุผลในการขอลบ *</span>
                <textarea id="impact-cancel-reason" maxlength="1000" rows="3" placeholder="ระบุเหตุผล เช่น บันทึกผิดเคส, ซ้ำซ้อน, ตรวจสอบแล้วไม่พบปัญหา..." class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400"></textarea>
            </label>
            <div class="pt-2">
                <button id="impact-cancel-submit" type="button" class="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer">
                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                    <span>ยืนยันลบรายการ</span>
                </button>
            </div>
        `;
        byId('impact-cancel-submit').onclick = async () => {
            const reason = byId('impact-cancel-reason').value.trim();
            if (!reason) return showToast('กรุณาระบุเหตุผลในการลบ', true);
            const button = byId('impact-cancel-submit');
            button.disabled = true;
            try {
                const result = await AkraSupabaseKPI.deleteIncident(sessionToken, branch, date, caseId, row.revision || 0, reason);
                applyResult(branch, date, result);
                byId('impact-dialog').close();
            } catch (e) {
                showToast(message(e), true);
            } finally {
                button.disabled = false;
            }
        };
    }

    async function history(caseId = '') {
        const body = dialog('ประวัติเหตุการณ์และการแก้ไข');
        body.innerHTML = `
            <div class="p-6 text-center text-xs text-slate-500 space-y-2">
                <i class="fa-solid fa-spinner fa-spin text-lg text-slate-400" aria-hidden="true"></i>
                <p>กำลังโหลดประวัติ...</p>
            </div>
        `;
        try {
            const date = weekCases().find(r => r.caseId === caseId)?.recordDate || byId('record-date-error').value;
            const result = await AkraSupabaseKPI.getIncidentHistory(sessionToken, currentBranch, date, caseId);
            const actionMap = {
                create: { label: 'สร้างบันทึก', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
                update: { label: 'แก้ไขรายการ', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
                cancel: { label: 'ลบรายการ', badge: 'bg-red-100 text-red-800 border-red-200' }
            };
            body.innerHTML = result.revisions.map(r => {
                const before = r.before_entries?.[0], after = r.after_entries?.[0];
                const act = actionMap[r.action] || { label: r.action, badge: 'bg-slate-100 text-slate-800 border-slate-200' };
                const actName = { create: 'บันทึก', update: 'แก้ไข', cancel: 'ลบ' }[r.action] || r.action;
                const caseTitle = (after || before)?.type || 'เหตุการณ์';
                return `
                    <article class="border border-slate-200 bg-slate-50/60 rounded-2xl p-3.5 text-xs space-y-2 shadow-sm">
                        <div class="flex items-center justify-between flex-wrap gap-1.5">
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${act.badge}">${act.label}</span>
                            <span class="text-[10px] text-slate-400 font-mono">ครั้งที่ ${escape(r.revision)} · ${escape(r.created_at)}</span>
                        </div>
                        <div class="font-bold text-slate-900 text-sm">${escape(actName)}: ${escape(caseTitle)}</div>
                        <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <i class="fa-solid fa-user-pen text-slate-400" aria-hidden="true"></i>
                            <span>ผู้ดำเนินการ: <strong>${escape(r.actor)}</strong></span>
                        </div>
                        ${before ? `
                            <div class="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-[11px] space-y-0.5">
                                <span class="font-bold text-slate-500 block">เดิม:</span>
                                <p>${escape(impactLabel(before))} · ${escape(before.displayNote || before.note || 'ไม่มีโน้ต')}</p>
                            </div>
                        ` : ''}
                        ${after ? `
                            <div class="p-2 rounded-xl bg-blue-50/50 border border-blue-200 text-blue-900 text-[11px] space-y-0.5">
                                <span class="font-bold text-blue-700 block">ใหม่:</span>
                                <p>${escape(impactLabel(after))} · ${escape(after.displayNote || after.note || 'ไม่มีโน้ต')}</p>
                            </div>
                        ` : ''}
                        ${r.reason ? `
                            <div class="text-xs text-slate-700 bg-amber-50/80 p-2 rounded-xl border border-amber-200">
                                <strong class="text-amber-900">เหตุผล:</strong> ${escape(r.reason)}
                            </div>
                        ` : ''}
                    </article>
                `;
            }).join('') || '<div class="p-6 text-center text-xs text-slate-500">ยังไม่มีประวัติการแก้ไขสำหรับรายการนี้</div>';
        } catch (e) {
            body.innerHTML = `<div class="p-4 text-center text-xs text-red-600 bg-red-50 rounded-xl">${escape(message(e))}</div>`;
        }
    }

    function timeline() {
        const rows = weekCases().filter(r => !isAchievement(r));
        const range = weekRange(byId('record-date-error')?.value);
        const heading = byId('incident-timeline-heading');
        if (heading) heading.textContent = `ไทม์ไลน์เคสรายสัปดาห์ (จันทร์–อาทิตย์) · ${range.start} – ${range.end}`;
        const countEl = byId('err-case-count');
        if (countEl) countEl.textContent = `${rows.length} เคส`;
        const today = byId('record-date-error')?.value === formatDateKeyLocal(new Date());
        const timelineContainer = byId('pc-err-timeline');
        if (!timelineContainer) return;

        if (!rows.length) {
            timelineContainer.innerHTML = `
                <div class="p-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 text-center space-y-2">
                    <div class="w-10 h-10 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm">
                        <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                    </div>
                    <p class="text-xs font-bold text-slate-600">ยังไม่มีเหตุการณ์ที่บันทึกสำหรับสัปดาห์นี้</p>
                    <p class="text-[11px] text-slate-400">เหตุการณ์ที่บันทึกจะแสดงในหน้านี้ตามลำดับเวลา</p>
                </div>`;
        } else {
            timelineContainer.innerHTML = rows.map(r => {
                const isNewCase = isNew(r);
                const impactKey = isNewCase ? r.impact : 'legacy';
                const meta = isNewCase && !r.impact ? {
                    badge: 'ไม่มีผลกระทบ',
                    borderAccent: 'border-l-slate-300',
                    bgLight: 'bg-slate-100',
                    borderLight: 'border-slate-200',
                    textColor: 'text-slate-700',
                    icon: 'fa-minus'
                } : (impactMeta[impactKey] || {
                    badge: 'ข้อมูลเดิม',
                    borderAccent: 'border-l-slate-400',
                    bgLight: 'bg-slate-100',
                    borderLight: 'border-slate-200',
                    textColor: 'text-slate-700',
                    icon: 'fa-clock'
                });
                const rowImpactLabel = isNewCase ? impactLabel(r) : 'ข้อมูลเดิม';
                const workerDisplay = (r.participants && r.participants.length ? r.participants.join(', ') : r.worker) || 'ไม่ระบุ';

                const respLabels = {
                    individual: '👤 รายบุคคล',
                    team: '👥 ทีมทั้งกะ',
                    process: '⚙️ ระบบ/ขั้นตอน',
                    pending: '❓ รอตรวจ'
                };
                const respBadge = r.responsibility && respLabels[r.responsibility]
                    ? `<span class="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-medium">${respLabels[r.responsibility]}</span>`
                    : '';

                return `
                    <article class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2.5 transition-all hover:shadow-md border-l-4 ${meta.borderAccent}">
                        <div class="flex items-start justify-between gap-2">
                            <h4 class="font-bold text-slate-900 text-sm leading-snug break-words">${escape(r.type)}</h4>
                            <span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${meta.bgLight} ${meta.textColor} border ${meta.borderLight} shrink-0">
                                <i class="fa-solid ${meta.icon} text-[10px]" aria-hidden="true"></i>
                                <span>${escape(rowImpactLabel)}</span>
                            </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-800 font-semibold px-2.5 py-1 rounded-lg">
                                <i class="fa-solid fa-user text-[10px] text-slate-500" aria-hidden="true"></i>
                                <span>${escape(workerDisplay)}</span>
                            </span>
                            <span class="inline-flex items-center gap-1 text-slate-400">
                                <i class="fa-solid fa-clock text-[10px]" aria-hidden="true"></i>
                                <span>${escape(r.recordDate)} · ${escape(r.time)}</span>
                            </span>
                            ${respBadge}
                        </div>
                        ${r.note ? `
                            <div class="p-2.5 bg-slate-50 rounded-xl text-xs text-slate-700 border border-slate-100 flex items-start gap-2">
                                <i class="fa-solid fa-note-sticky text-slate-400 text-xs mt-0.5 shrink-0" aria-hidden="true"></i>
                                <span class="break-words">${escape(r.note)}</span>
                            </div>
                        ` : ''}
                        ${!isNewCase ? `
                            <div class="text-[11px] text-slate-500 font-medium">
                                <span class="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">คะแนนเดิม: -${Number(r.penalty) || 0} HP</span>
                            </div>
                        ` : ''}
                        <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
                            <button type="button" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-blue-700 font-bold text-xs transition-all active:scale-95 cursor-pointer" onclick="KpiIncident.edit('${escape(r.caseId)}')"><i class="fa-solid fa-pen-to-square text-[11px]" aria-hidden="true"></i>แก้ไข</button>
                            <button type="button" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-100 text-red-700 font-bold text-xs transition-all active:scale-95 cursor-pointer" onclick="KpiIncident.cancel('${escape(r.caseId)}')"><i class="fa-solid fa-trash-can text-[11px]" aria-hidden="true"></i>ลบ</button>
                            <button type="button" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-xs transition-all active:scale-95 cursor-pointer" onclick="KpiIncident.history('${escape(r.caseId)}')"><i class="fa-solid fa-clock-rotate-left text-[11px]" aria-hidden="true"></i>ประวัติ</button>
                        </div>
                    </article>
                `;
            }).join('');
        }

        const positive = recordedErrorCases.filter(isAchievement);
        if (positive.length) {
            timelineContainer.innerHTML += `
                <div class="pt-3 space-y-2">
                    <div class="flex items-center justify-between text-xs border-b border-emerald-100 pb-1.5">
                        <h4 class="font-bold text-emerald-800 flex items-center gap-1.5">
                            <i class="fa-solid fa-star text-amber-500" aria-hidden="true"></i>
                            <span>ผลงาน & Good Catch (${positive.length} รายการ)</span>
                        </h4>
                        <span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">+1 Star</span>
                    </div>
                    ${positive.map(r => `
                        <article class="border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 rounded-2xl p-4 text-xs space-y-2 shadow-sm border-l-4 border-l-emerald-500">
                            <div class="flex items-center justify-between">
                                <h4 class="font-bold text-emerald-950 text-sm">${escape(r.type)}</h4>
                                <span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-bold">Good Catch</span>
                            </div>
                            <div class="flex items-center gap-2 text-slate-600">
                                <span class="font-semibold text-slate-800">${escape(r.worker)}</span>
                                <span>•</span>
                                <span class="text-slate-400">${escape(r.time)}</span>
                            </div>
                            ${r.note ? `<p class="text-slate-700 bg-white/70 p-2 rounded-xl border border-emerald-100">${escape(r.note)}</p>` : ''}
                            ${today ? `
                                <div class="pt-1">
                                    <button type="button" class="px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-semibold transition-colors" onclick="KpiIncident.cancel('${escape(r.caseId)}')">ยกเลิกผลงาน</button>
                                </div>
                            ` : ''}
                        </article>
                    `).join('')}
                </div>
            `;
        }
    }

    function metrics(rows) {
        const s = summarize(rows);
        return `
            <!-- Total Cases Hero Banner -->
            <div class="col-span-2 p-3 rounded-xl bg-slate-800/90 border border-slate-700/80 flex items-center justify-between shadow-inner">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-sm">
                        <i class="fa-solid fa-chart-pie" aria-hidden="true"></i>
                    </div>
                    <div>
                        <div class="text-[11px] text-slate-400 font-medium">เหตุการณ์ทั้งหมดในสัปดาห์นี้</div>
                        <div class="text-[10px] text-slate-500">นับตามเคสจริง (จันทร์–อาทิตย์)</div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-xl font-black text-white font-num">${s.total}</span>
                    <span class="text-xs text-slate-400 ml-0.5">เคส</span>
                </div>
            </div>

            <!-- ถึงลูกค้า -->
            <div class="p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/40 flex items-center justify-between">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
                    <span class="text-xs text-rose-200 truncate">ถึงลูกค้า</span>
                </div>
                <span class="font-black text-rose-400 font-num text-sm shrink-0">${s.impact.reached_customer}</span>
            </div>

            <!-- แก้ทันก่อนส่ง -->
            <div class="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 flex items-center justify-between">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                    <span class="text-xs text-emerald-200 truncate">แก้ทันก่อนส่ง</span>
                </div>
                <span class="font-black text-emerald-400 font-num text-sm shrink-0">${s.impact.contained}</span>
            </div>

            <!-- กระทบภายใน -->
            <div class="p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40 flex items-center justify-between">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                    <span class="text-xs text-amber-200 truncate">กระทบภายใน</span>
                </div>
                <span class="font-black text-amber-400 font-num text-sm shrink-0">${s.impact.escaped_internal}</span>
            </div>

            <!-- ยังไม่ทราบ -->
            <div class="p-2.5 rounded-xl bg-sky-950/30 border border-sky-800/40 flex items-center justify-between">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="w-2 h-2 rounded-full bg-sky-500 shrink-0"></span>
                    <span class="text-xs text-sky-200 truncate">ยังไม่ทราบ</span>
                </div>
                <span class="font-black text-sky-400 font-num text-sm shrink-0">${s.impact.unknown}</span>
            </div>

            <!-- ไม่เกี่ยวส่งมอบ -->
            <div class="col-span-2 p-2 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
                <span class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <span>ไม่เกี่ยวกับขั้นตอนส่งมอบ</span>
                </span>
                <span class="font-bold text-slate-300 font-num">${s.impact.not_applicable}</span>
            </div>
            ${Object.entries(s.impact).filter(([id]) => !labels[id]).map(([id, count]) => `
                <div class="col-span-2 p-2 rounded-xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
                    <span>${escape(impactLabel((rows || []).find(r => r.impact === id) || id))}</span>
                    <span class="font-bold text-slate-300 font-num">${count}</span>
                </div>`).join('')}

        `;
    }

    function detail(row, branch) {
        let meta = null, note = row.displayNote ?? row.note ?? '';
        if (!isNew(row)) {
            const parsed = branch === 'TRD' ? parseTrdCaseNote(row.note) : parseAkraCaseNote(row.note);
            if (!isNew(parsed.meta)) return null;
            meta = parsed.meta;
            note = parsed.note;
        }
        const data = { ...row, ...meta };
        return {
            schemaVersion: 3,
            scoringMode: 'none',
            penalty: 0,
            typeId: data.typeId,
            type: data.type,
            impact: data.impact,
            impactLabel: impactLabel(data, branch),
            isReachedCustomer: data.impact === 'reached_customer',
            isFixedBefore: data.impact === 'contained',
            caseId: data.caseId,
            meta: data,
            cleanNote: note,
            core: data.category,
            coreLabel: getIncidentCategoryLabel(data.category, branch),
            isAkraCase: branch === 'AKRA'
        };
    }

    let adminDraft = null;

    function admin() {
        const host = byId('admin-incident-categories-list');
        if (!host) return;
        if (!adminDraft) adminDraft = JSON.parse(JSON.stringify(model()));
        for (const b of ['AKRA', 'TRD']) {
            if (!adminDraft.branches[b].impacts) adminDraft.branches[b].impacts = impactDefinitions(b).map(i => ({...i}));
        }
        const branch = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA', data = adminDraft.branches[branch];
        byId('admin-incident-heading').textContent = 'ตั้งค่าประเภทและผลกระทบ';
        byId('admin-incident-description').textContent = 'เพิ่ม แก้ไข หรือลบประเภทและผลกระทบ โดยเก็บรายการที่บันทึกแล้วไว้';
        byId('btn-save-admin-incidents').textContent = 'บันทึกประเภทและผลกระทบ';
        host.innerHTML = `
            <div class="space-y-4">
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-bold text-slate-700">หมวดหมู่หลัก (${data.categories.length})</span>
                        <button type="button" class="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer" onclick="KpiIncident.adminAddCategory()"><i class="fa-solid fa-plus text-[10px]"></i> เพิ่มหมวดใหม่</button>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${data.categories.map(c => `
                            <label class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200 block space-y-1">
                                <span class="text-[10px] text-slate-400 font-mono">${escape(c.key)}</span>
                                <input aria-label="ชื่อหมวด" value="${escape(c.label)}" class="w-full border border-slate-300 p-2 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500/20 outline-none" onchange="KpiIncident.adminCategory('${c.key}',this.value)">
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div>
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-bold text-slate-700">ผลกระทบ (${data.impacts.length})</span>
                        <button type="button" class="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer" onclick="KpiIncident.adminAddImpact()"><i class="fa-solid fa-plus text-[10px]"></i> เพิ่มผลกระทบ</button>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${data.impacts.map(i => `
                            <div class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200 block space-y-1">
                                <input aria-label="ชื่อผลกระทบ" value="${escape(i.label)}" maxlength="150" class="w-full border border-slate-300 p-2 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500/20 outline-none" onchange="KpiIncident.adminRenameImpact('${i.id}',this.value)">
                                <button type="button" class="text-xs text-red-600 hover:text-red-800" onclick="KpiIncident.adminDeleteImpact('${i.id}')">ลบผลกระทบ</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div>
                    <div class="flex items-center justify-between mb-2">
                        <div>
                            <span class="text-xs font-bold text-slate-700">ประเภทและผลกระทบที่อนุญาต (${data.types.length})</span>
                            <p class="text-[10px] text-slate-400">รหัสรายการคงเดิมเมื่อเปลี่ยนชื่อ เพื่อรักษาประวัติย้อนหลัง</p>
                        </div>
                        <button type="button" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-1 transition-all active:scale-95 cursor-pointer" onclick="KpiIncident.adminAdd()"><i class="fa-solid fa-plus text-[10px]"></i> เพิ่มประเภท</button>
                    </div>
                    <div class="space-y-2.5">
                        ${data.types.map(t => `
                            <article class="border border-slate-200 bg-white rounded-2xl p-3.5 space-y-2.5 shadow-sm">
                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <div class="sm:col-span-2">
                                        <input aria-label="ชื่อประเภท" value="${escape(t.name)}" class="w-full border border-slate-300 rounded-xl p-2.5 text-xs font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 outline-none" onchange="KpiIncident.adminChange('${t.id}','name',this.value)">
                                    </div>
                                    <div>
                                        <select aria-label="หมวด" class="w-full border border-slate-300 rounded-xl p-2.5 text-xs bg-slate-50 focus:bg-white outline-none cursor-pointer" onchange="KpiIncident.adminChange('${t.id}','category',this.value)">
                                            ${data.categories.map(c => `<option value="${escape(c.key)}" ${c.key === t.category ? 'selected' : ''}>${escape(c.label)}</option>`).join('')}
                                        </select>
                                    </div>
                                </div>
                                <div class="flex items-center gap-4 text-xs font-medium text-slate-700">
                                    <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" ${t.active ? 'checked' : ''} onchange="KpiIncident.adminChange('${t.id}','active',this.checked)" class="rounded text-blue-600 focus:ring-blue-500"> <span>เปิดใช้งาน</span></label>
                                    <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" ${t.quick ? 'checked' : ''} onchange="KpiIncident.adminChange('${t.id}','quick',this.checked)" class="rounded text-amber-500 focus:ring-amber-400"> <span>⭐ แสดงในใช้บ่อย</span></label>
                                    <button type="button" class="text-xs text-red-600 hover:text-red-800" onclick="KpiIncident.adminDeleteType('${t.id}')">ลบประเภท</button>
                                </div>
                                <div class="pt-1 border-t border-slate-100">
                                    <span class="text-[10px] text-slate-400 block mb-1">ผลกระทบที่อนุญาตให้เลือก (หากไม่มีผลกระทบต่อลูกค้า ไม่ต้องเลือกข้อใด):</span>
                                    <div class="flex flex-wrap gap-2 text-xs">
                                        ${data.impacts.map(({id, label}) => `
                                            <label class="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100">
                                                <input type="checkbox" ${t.impacts.includes(id) ? 'checked' : ''} onchange="KpiIncident.adminImpact('${t.id}','${id}',this.checked)" class="rounded text-blue-600 focus:ring-blue-500">
                                                <span data-admin-impact-label="${escape(id)}" class="text-[11px]">${escape(label)}</span>
                                            </label>
                                        `).join('')}
                                    </div>
                                </div>
                            </article>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function adminChange(id, field, value) {
        const b = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA';
        const t = adminDraft.branches[b].types.find(t => t.id === id);
        if (t) t[field] = value;
    }

    function adminImpact(id, impact, on) {
        const b = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA';
        const t = adminDraft.branches[b].types.find(t => t.id === id);
        if (t) t.impacts = on ? [...new Set([...t.impacts, impact])] : t.impacts.filter(i => i !== impact);
    }

    function adminAdd() {
        const b = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA', d = adminDraft.branches[b];
        d.types.push({ id: `${b.toLowerCase()}-${crypto.randomUUID()}`, name: 'ประเภทใหม่', category: d.categories[0].key, active: true, quick: false, impacts: [] });
        admin();
    }

    function adminCategory(key, label) {
        const b = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA';
        adminDraft.branches[b].categories.find(c => c.key === key).label = label;
    }

    function adminAddCategory() {
        if (!adminDraft) admin();
        const b = ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA';
        adminDraft.branches[b].categories.push({ key: `cat_${crypto.randomUUID()}`, label: 'หมวดใหม่' });
        admin();
    }

    function adminDeleteType(id) {
        const data = adminDraft.branches[ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA'];
        data.types = data.types.filter(t => t.id !== id);
        admin();
    }

    function adminAddImpact() {
        const data = adminDraft.branches[ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA'];
        data.impacts.push({id: `impact_${crypto.randomUUID()}`, label: 'ผลกระทบใหม่'});
        admin();
    }

    function adminRenameImpact(id, label) {
        const data = adminDraft.branches[ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA'];
        data.impacts.find(i => i.id === id).label = label;
        document.querySelectorAll(`[data-admin-impact-label="${id}"]`).forEach(el => el.textContent = label);
    }

    function adminDeleteImpact(id) {
        const data = adminDraft.branches[ADMIN_SETTINGS_STATE.incidentBranch || 'AKRA'];
        data.impacts = data.impacts.filter(i => i.id !== id);
        data.types.forEach(t => t.impacts = t.impacts.filter(i => i !== id));
        admin();
    }

    async function adminSave() {
        try {
            const r = await AkraSupabaseKPI.saveIncidentCatalog(sessionToken, adminDraft);
            KPI_SYSTEM_CONFIG.incidentModel = r.configValue;
            adminDraft = null;
            admin();
            state.typeId = '';
            state.impact = '';
            state.pending = null;
            render();
            showToast('บันทึกประเภทและผลกระทบแล้ว');
        } catch (e) {
            showToast(message(e), true);
        }
    }

    const api = {
        labels,
        impactLabel,
        weekRange,
        weekCases,
        state,
        enabled,
        isNew,
        isAchievement,
        legacyImpact,
        summarize,
        render,
        choose,
        impact,
        search,
        summary,
        dirty,
        reset,
        save,
        edit,
        cancel,
        history,
        timeline,
        metrics,
        detail,
        admin,
        adminChange,
        adminImpact,
        adminAdd,
        adminSave,
        adminCategory,
        adminAddCategory,
        adminDeleteType, adminAddImpact, adminRenameImpact, adminDeleteImpact
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.KpiIncident = api;
})(typeof window === 'undefined' ? globalThis : window);
