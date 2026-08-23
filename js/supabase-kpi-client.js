/**
 * ============================================================================
 * AKRA KPITRACKER SUPABASE API CLIENT
 * Status: DEACTIVATED / CONTAINED for Security Hardening (Plan 20260820-004)
 * KPI daily records, actions, and config operations execute via authoritative GAS backend.
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

    return {
        saveDailyRecord: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        fetchBranchData: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getWeeklyRecords: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getEmployees: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getConfig: async () => {
            const url = `${SUPABASE_CONFIG.URL}/rest/v1/kpi_employees?select=name,branch,status,role,legacy_uid&is_migrated=eq.true&order=branch,sort_order`;
            const response = await fetch(url, {
                headers: {
                    'apikey': SUPABASE_CONFIG.KEY,
                    'Authorization': 'Bearer ' + SUPABASE_CONFIG.KEY
                }
            });
            if (!response.ok) throw new Error('Supabase fetch failed: ' + response.statusText);
            const data = await response.json();
            const merged = {};
            data.forEach(row => {
                if (!merged[row.name]) {
                    merged[row.name] = {
                        uid: row.legacy_uid || row.name,
                        name: row.name,
                        branches: row.branch,
                        dept: '',
                        gender: '',
                        status: row.status
                    };
                } else {
                    const existingBranches = merged[row.name].branches.split(',');
                    if (!existingBranches.includes(row.branch)) {
                        merged[row.name].branches += ',' + row.branch;
                    }
                }
            });
            return Object.values(merged);
        },
        getActions: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        saveAction: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); }
    };
}));
