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
        KEY: ''
    };

    return {
        saveDailyRecord: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        fetchBranchData: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getWeeklyRecords: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getEmployees: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getConfig: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        getActions: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); },
        saveAction: async () => { throw new Error('Supabase KPI client deactivated. Falling back to GAS.'); }
    };
}));
