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
            throw new Error(data.reason || ('Supabase fetch failed: ' + response.statusText));
        }
        return data;
    }

    async function fetchConfigAction(action, token) {
        const data = await fetchKpiAction(action, token);
        if (!Array.isArray(data.employees)) throw new Error('invalid_kpi_config_response');
        return data;
    }

    return {
        saveDailyRecord: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        fetchBranchData: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
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
        deleteIncident: async (token, branch, date, caseId) => {
            const data = await fetchKpiAction('deleteIncident', token, { branch, date, caseId });
            if (!Array.isArray(data.incidents) || typeof data.zeroConfirmed !== 'boolean') {
                throw new Error('invalid_kpi_incident_response');
            }
            return data;
        },
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
        getActions: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        saveAction: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); }
    };
}));

// Store Skill Matrix is an additive extension of the existing Skill Catalog/Certification UI.
// Load it after the current app has finished evaluating so it can safely reuse existing globals
// without touching the large index.html entrypoint.
(function loadStoreSkillMatrixExtension(root) {
    if (!root || !root.document) return;
    const load = () => {
        if (root.AkraStoreSkillMatrix || root.document.getElementById('store-skill-matrix-extension-script')) return;
        const script = root.document.createElement('script');
        script.id = 'store-skill-matrix-extension-script';
        script.src = 'js/store-skill-matrix-extension.js?v=20260827.01';
        script.defer = true;
        script.onerror = () => console.warn('[Store Skill Matrix] extension failed to load');
        root.document.body.appendChild(script);
    };
    if (root.document.readyState === 'complete') load();
    else root.addEventListener('load', load, { once: true });
}(typeof window !== 'undefined' ? window : null));
