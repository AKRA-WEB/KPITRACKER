/**
 * ============================================================================
 * AKRA KPITRACKER SUPABASE API CLIENT
 * Status: authenticated KPI roster, Workload, and Incident paths use kpi-api.
 * Remaining daily-record sections and actions stay on their contained paths.
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

    async function fetchKpiAction(action, token, payload = {}) {
        if (!token) throw new Error('KPI config requires an authenticated Main session.');
        const url = `${SUPABASE_CONFIG.URL}/functions/v1/kpi-api`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_CONFIG.KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, token, ...payload })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== 'success') {
            const error = new Error(data.reason === 'record_conflict' ? 'ข้อมูลถูกแก้ไขจากที่อื่น กรุณาโหลดข้อมูลล่าสุดและตรวจทานก่อนบันทึกใหม่' : (data.reason || ('Supabase fetch failed: ' + response.statusText)));
            error.reason = data.reason;
            error.status = response.status;
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
        const records = [];
        let cursor = null;
        const seen = new Set();
        do {
            const data = await fetchKpiAction(action, token, { ...payload, cursor, limit: 500 });
            if (!Array.isArray(data[field])) throw new Error('invalid_kpi_response');
            records.push(...data[field]);
            cursor = data.nextCursor || null;
            if (cursor && seen.has(cursor)) throw new Error('invalid_kpi_cursor');
            if (cursor) seen.add(cursor);
        } while (cursor);
        return records;
    }

    return {
        saveDailyRecord: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        fetchBranchData: async (token, branch, months = 3) => {
            const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const start = new Date(endDate + 'T00:00:00Z');
            start.setUTCMonth(start.getUTCMonth() - ((months || 3) - 1), 1);
            start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
            return readPages('getDailyData', token, { branch, startDate: months === null ? '1970-01-01' : start.toISOString().slice(0, 10), endDate, includeActivity: months === null }, 'records');
        },
        saveSection: (token, request) => fetchKpiAction('saveSection', token, request),
        getWeeklyRecords: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getEmployees: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
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
        getLiveRequisitions: async (targetDate) => {
            const d = targetDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
            const url = `${SUPABASE_CONFIG.URL}/rest/v1/rpc/kpi_get_live_requisitions_v1`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_CONFIG.KEY,
                    'Authorization': `Bearer ${SUPABASE_CONFIG.KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_date: d })
            });
            if (!response.ok) {
                throw new Error('Supabase getLiveRequisitions failed: ' + response.statusText);
            }
            const data = await response.json();
            return data;
        }
    };
}));
