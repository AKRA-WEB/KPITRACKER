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
        getIncidentData: async (token, branch, months) => {
            const data = await fetchKpiAction('getIncidentData', token, { branch, months });
            if (!Array.isArray(data.records)) throw new Error('invalid_kpi_incident_response');
            return data;
        },
        getActions: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        saveAction: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); }
    };
}));
