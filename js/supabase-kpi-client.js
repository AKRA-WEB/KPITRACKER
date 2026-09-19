/**
 * ============================================================================
 * AKRA KPITRACKER SUPABASE API CLIENT
 * Status: all KPI roster, daily sections, Workload, Incident, and action paths
 * use the authenticated kpi-api boundary. No legacy provider fallback exists.
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabaseKPI = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const SUPABASE_CONFIG = {
        URL: 'https://hgxrrskztbpejirrdpbq.supabase.co',
        KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneHJyc2t6dGJwZWppcnJkcGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMjQ1ODAsImV4cCI6MjEwMjcwMDU4MH0.IQWpcgqCCVVLwRJso1eamXHuCH4tKeWohd2oCUCVavw'
    };

    function changedSession() {
        return Object.assign(new Error('session_changed'), {reason:'session_changed'});
    }

    function requestContext(token) {
        if (typeof window === 'undefined') return {token,owner:null};
        const owner = window.getKpiSessionOwner?.(), current = window.getKpiSessionToken?.();
        if (!owner || !current) throw changedSession();
        if (token && token !== current && token !== owner.token) throw changedSession();
        return {owner,token:current};
    }

    function assertRequestContext(context) {
        if (typeof window !== 'undefined' && (window.getKpiSessionOwner?.() !== context.owner || window.getKpiSessionToken?.() !== context.token)) throw changedSession();
    }

    async function fetchKpiAction(action, token, payload = {}, expectedContext = null) {
        const context = expectedContext || requestContext(token);
        const bridge = typeof window !== 'undefined' && window.AkraModule?.embedded ? window.AkraModule : null;
        const operation = async () => {
            const result = await transportRequest(action, payload, context);
            if (bridge && !action.startsWith('get')) bridge.markSaved?.();
            return result;
        };
        return bridge && !action.startsWith('get') ? bridge.runMutation(operation) : operation();
    }

    async function transportRequest(action, payload, context) {
        assertRequestContext(context);
        if (!context.token) throw new Error('KPI config requires an authenticated Main session.');
        const url = `${SUPABASE_CONFIG.URL}/functions/v1/kpi-api`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_CONFIG.KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...payload, action, token:context.token })
        });
        assertRequestContext(context);
        const data = await response.json().catch(() => ({}));
        assertRequestContext(context);
        if (!response.ok || data.status !== 'success') {
            const error = new Error(data.reason === 'record_conflict' ? 'ข้อมูลถูกแก้ไขจากที่อื่น กรุณาโหลดข้อมูลล่าสุดและตรวจทานก่อนบันทึกใหม่' : (data.reason || ('Supabase fetch failed: ' + response.statusText)));
            error.reason = data.reason;
            error.status = response.status;
            if (response.status === 401 && typeof window !== 'undefined') window.onKpiSessionRejected?.(error);
            throw error;
        }
        return data;
    }

    async function fetchConfigAction(action, token) {
        const data = await fetchKpiAction(action, token);
        if (!Array.isArray(data.employees)) throw new Error('invalid_kpi_config_response');
        return data;
    }

    async function readPages(action, token, payload, field) {
        const context = requestContext(token);
        const records = [];
        let cursor = null;
        const seen = new Set();
        do {
            assertRequestContext(context);
            const data = await fetchKpiAction(action, token, { ...payload, cursor, limit: 500 }, context);
            if (!Array.isArray(data[field])) throw new Error('invalid_kpi_response');
            records.push(...data[field]);
            cursor = data.nextCursor || null;
            if (cursor && seen.has(cursor)) throw new Error('invalid_kpi_cursor');
            if (cursor) seen.add(cursor);
        } while (cursor);
        return records;
    }

    function dailySectionPayload(payload, section, revisions) {
        const base = {
            action: 'saveSection',
            branch: payload.branch,
            date: payload.date,
            section,
            expectedRevision: Number.isSafeInteger(revisions[section]) ? revisions[section] : 0
        };
        if (section === 'operations') {
            return { ...base, volume: payload.volume || {}, customerNotes: payload.customerNotes || '' };
        }
        if (section === 'tasks') return { ...base, tasks: Array.isArray(payload.tasks) ? payload.tasks : [] };
        if (section === 'endOfShift') {
            const source = payload.endOfShift && typeof payload.endOfShift === 'object' ? payload.endOfShift : {};
            return { ...base, endOfShift: {
                summary: String(source.summary || ''), issues: String(source.issues || ''),
                actions: String(source.actions || ''), followUps: String(source.followUps || '')
            } };
        }
        if (section === 'vendorBills') {
            const vendorBills = payload.endOfShift?.vendorBills;
            return { ...base, vendorBills };
        }
        throw new Error('invalid_daily_section');
    }

    async function saveDailyRecord(payload, token) {
        if (!payload || typeof payload !== 'object') throw new Error('invalid_daily_record');
        if (Object.prototype.hasOwnProperty.call(payload, 'errors')) {
            throw new Error('legacy_errors_not_supported');
        }
        const branch = String(payload.branch || '').trim().toUpperCase();
        const date = String(payload.date || '').trim();
        if (!['AKRA', 'TRD'].includes(branch) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_daily_record');
        const context = requestContext(token || payload.token);
        const existing = await fetchKpiAction('getDailyData', context.token, {
            branch, startDate: date, endDate: date, includeActivity: false, limit: 500
        }, context);
        const row = Array.isArray(existing.records) ? existing.records[0] : null;
        const revisions = { ...(row?.sectionRevisions || {}) };
        const saved = [];
        const saveSection = async section => {
            const result = await fetchKpiAction('saveSection', context.token, dailySectionPayload({ ...payload, branch, date }, section, revisions), context);
            if (!result?.record) throw new Error('invalid_daily_record_response');
            saved.push(result.record);
            revisions[section] = Number(result.record.sectionRevisions?.[section]);
            if (!Number.isSafeInteger(revisions[section])) throw new Error('invalid_daily_record_response');
        };

        await saveSection('operations');
        await saveSection('tasks');
        await saveSection('endOfShift');
        if (branch === 'AKRA' && payload.endOfShift?.vendorBills) await saveSection('vendorBills');
        const workloadResults = [];
        if (Array.isArray(payload.workload) && payload.workload.length > 0) {
            if (branch !== 'AKRA') throw new Error('invalid_daily_workload_branch');
            for (const workload of payload.workload) {
                const employeeUid = String(workload?.employeeUid || '').trim();
                if (!employeeUid) throw new Error('invalid_daily_workload');
                const result = await fetchKpiAction('saveWorkload', context.token, {
                    employeeUid, date, workload
                }, context);
                if (result?.status !== 'success' || !Array.isArray(result.workload)) throw new Error('invalid_daily_workload_response');
                workloadResults.push(result);
            }
        }
        return { status: 'success', record: saved[saved.length - 1], records: saved, workload: workloadResults };
    }

    return {
        saveDailyRecord,
        fetchBranchData: async (token, branch, months = 3) => {
            const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const start = new Date(endDate + 'T00:00:00Z');
            start.setUTCMonth(start.getUTCMonth() - ((months || 3) - 1), 1);
            start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
            return readPages('getDailyData', token, { branch, startDate: months === null ? '1970-01-01' : start.toISOString().slice(0, 10), endDate, includeActivity: months === null }, 'records');
        },
        saveSection: (token, request) => fetchKpiAction('saveSection', token, request),
        getWeeklyRecords: async (token, branch, startDate, endDate) => {
            const start = String(startDate || '').trim();
            const end = String(endDate || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('invalid_daily_range');
            return readPages('getDailyData', token, { branch, startDate: start, endDate: end, includeActivity: true }, 'records');
        },
        getEmployees: async token => {
            const data = await fetchConfigAction('getConfig', token);
            return data.employees;
        },
        getConfig: token => fetchConfigAction('getConfig', token),
        getAdminStatus: token => fetchConfigAction('getAdminStatus', token),
        saveSystemConfig: async (token, configKey, configValue) => {
            const data = await fetchKpiAction('saveSystemConfig', token, { configKey, configValue });
            if (data.status !== 'success') throw new Error('invalid_save_system_config_response');
            return data;
        },
        saveWorkload: async (token, employeeUid, date, workload) => {
            const data = await fetchKpiAction('saveWorkload', token, { employeeUid, date, workload });
            if (!Array.isArray(data.workload)) throw new Error('invalid_kpi_workload_response');
            return data;
        },
        getWorkloadData: async (token, branch, months) => {
            const data = await fetchKpiAction('getWorkloadData', token, { branch, months });
            if (!Array.isArray(data.records)) throw new Error('invalid_kpi_workload_response');
            return data;
        },
        saveIncident: async (token, branch, date, incident) => {
            const data = await fetchKpiAction('saveIncident', token, { branch, date, incident });
            if (!Array.isArray(data.incidents) || typeof data.zeroConfirmed !== 'boolean') {
                throw new Error('invalid_kpi_incident_response');
            }
            return data;
        },
        deleteIncident: async (token, branch, date, caseId, expectedRevision, reason) => {
            const data = await fetchKpiAction('deleteIncident', token, { branch, date, caseId, expectedRevision, reason });
            if (!Array.isArray(data.incidents) || typeof data.zeroConfirmed !== 'boolean') {
                throw new Error('invalid_kpi_incident_response');
            }
            return data;
        },
        updateIncident: (token, request) => fetchKpiAction('updateIncident', token, request),
        getIncidentHistory: (token, branch, date, caseId) => fetchKpiAction('getIncidentHistory', token, { branch, date, caseId }),
        saveIncidentCatalog: (token, configValue) => fetchKpiAction('saveIncidentCatalog', token, { configValue }),
        clearWorkload: async (token, employeeUid, date) => {
            const data = await fetchKpiAction('clearWorkload', token, { employeeUid, date });
            if (!Array.isArray(data.workload)) throw new Error('invalid_kpi_workload_response');
            return data;
        },
        getIncidentData: async (token, branch, months) => {
            const data = await fetchKpiAction('getIncidentData', token, { branch, months });
            if (!Array.isArray(data.records)) throw new Error('invalid_kpi_incident_response');
            return data;
        },
        saveShiftRoster: async (token, branch, date, shiftLead, roster) => {
            const data = await fetchKpiAction('saveShiftRoster', token, { branch, date, shiftLead, roster });
            if (data.status !== 'success') throw new Error('invalid_save_shift_roster_response');
            return data;
        },
        getShiftRoster: async (token, branch, date) => {
            const data = await fetchKpiAction('getShiftRoster', token, { branch, date });
            if (data.status !== 'success') throw new Error('invalid_get_shift_roster_response');
            return data;
        },
        saveAuditRecord: async (token, branch, date, auditType, totalScore, sectionScores, notes, findings) => {
            const data = await fetchKpiAction('saveAuditRecord', token, { branch, date, auditType, totalScore, sectionScores, notes, findings });
            if (data.status !== 'success') throw new Error('invalid_save_audit_record_response');
            return data;
        },
        getAuditData: async (token, branch, months) => {
            const data = await fetchKpiAction('getAuditData', token, { branch, months });
            if (!Array.isArray(data.audits)) throw new Error('invalid_get_audit_data_response');
            return data;
        },
        updateAuditFinding: async (token, findingId, status, afterPhotoUrl, resolutionNote) => {
            const data = await fetchKpiAction('updateAuditFinding', token, { findingId, status, afterPhotoUrl, resolutionNote });
            if (data.status !== 'success') throw new Error('invalid_update_audit_finding_response');
            return data;
        },
        getSkillCatalog: async (token) => {
            const data = await fetchKpiAction('getSkillCatalog', token, {});
            if (!Array.isArray(data.skills)) throw new Error('invalid_get_skill_catalog_response');
            return data;
        },
        saveSkillCatalogItem: async (token, skill) => {
            const data = await fetchKpiAction('saveSkillCatalogItem', token, { skill });
            if (data.status !== 'success' || !Array.isArray(data.skills)) throw new Error('invalid_save_skill_catalog_response');
            return data;
        },
        deleteSkillCatalogItem: async (token, skillCode) => {
            const data = await fetchKpiAction('deleteSkillCatalogItem', token, { skillCode });
            if (data.status !== 'success' || !Array.isArray(data.skills)) throw new Error('invalid_delete_skill_catalog_response');
            return data;
        },
        getEmployeeSkills: async (token, employeeUid = null) => {
            const data = await fetchKpiAction('getEmployeeSkills', token, { employeeUid });
            if (!Array.isArray(data.skills)) throw new Error('invalid_get_employee_skills_response');
            return data;
        },
        saveEmployeeSkill: async (token, employeeUid, employeeName, skillCode, level, notes = '') => {
            const data = await fetchKpiAction('saveEmployeeSkill', token, { employeeUid, employeeName, skillCode, level, notes });
            if (data.status !== 'success') throw new Error('invalid_save_employee_skill_response');
            return data;
        },
        deleteEmployeeSkill: async (token, employeeUid, skillCode) => {
            const data = await fetchKpiAction('deleteEmployeeSkill', token, { employeeUid, skillCode });
            if (data.status !== 'success') throw new Error('invalid_delete_employee_skill_response');
            return data;
        },
        getEmployeeProfileSummary: async (token, employeeUid = null, month = null) => {
            const data = await fetchKpiAction('getEmployeeProfileSummary', token, { employeeUid, month });
            if (data.status !== 'success' || !data.profile) throw new Error('invalid_get_employee_profile_response');
            return data;
        },
        getMyProfileSummary: async (token, month = null, employeeUid = null) => {
            const data = await fetchKpiAction('getMyProfileSummary', token, { month, employeeUid });
            if (data.status !== 'success' || !data.profile) throw new Error('invalid_get_my_profile_response');
            return data;
        },
        uploadProfileAvatar: async (token, avatarData, employeeUid = null) => {
            const data = await fetchKpiAction('uploadProfileAvatar', token, { avatarData, employeeUid });
            if (data.status !== 'success' || !data.avatarUrl) throw new Error('invalid_upload_avatar_response');
            return data;
        },
        bindLineAccount: async (token, lineUserId, lineDisplayName = '', employeeUid = null) => {
            const data = await fetchKpiAction('bindLineAccount', token, { lineUserId, lineDisplayName, employeeUid });
            if (data.status !== 'success') throw new Error('invalid_bind_line_response');
            return data;
        },
        unbindLineAccount: async (token, employeeUid = null) => {
            const data = await fetchKpiAction('unbindLineAccount', token, { employeeUid });
            if (data.status !== 'success') throw new Error('invalid_unbind_line_response');
            return data;
        },
        getActions: (token, branch) => readPages('getActions', token, { branch }, 'actions'),
        saveAction: (token, actionItem) => fetchKpiAction('saveAction', token, { actionItem, expectedRevision: actionItem.revision ?? (actionItem.lastUpdated ? null : 0) }),
        getLiveRequisitions: async (token, targetDate) => {
            if (!token) throw new Error('KPI Live Bill requires an authenticated Main session.');
            const d = targetDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
            const data = await fetchKpiAction('getLiveRequisitions', token, { date: d });
            if (!data || !Array.isArray(data.requisitions) || data.date !== d || data.feedStatus !== 'ok') {
                throw new Error('invalid_live_requisition_response');
            }
            return data;
        }
    };
}));
