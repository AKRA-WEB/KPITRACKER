/**
 * ============================================================================
 * AKRA KPITRACKER SUPABASE API CLIENT
 * JSONB Daily Performance & Monday-Sunday Weekly Aggregation (<25ms)
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
        KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneHJyc2t6dGJwZWppcnJkcGJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzEyNDU4MCwiZXhwIjoyMTAyNzAwNTgwfQ.9RiiP0kItbbcMeI2mYActrD9a1naHCNbmYJBRXHR1DI',
            };

    async function supabaseRest(endpoint, options = {}) {
        const url = `${SUPABASE_CONFIG.URL}/rest/v1/${endpoint}`;
        const key = SUPABASE_CONFIG.KEY;
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': options.prefer || 'return=representation',
            ...(options.headers || {})
        };
        const res = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Supabase REST HTTP ${res.status}: ${errText}`);
        }
        return res.json();
    }

    /**
     * Upsert Daily Record (Workload, Errors, End of Shift JSONB)
     */
    async function saveDailyRecord(record) {
        const payload = {
            record_date: record.recordDate || record.record_date,
            branch: record.branch || 'AKRA',
            workload_data: record.workloadData || record.workload_data || {},
            end_of_shift_data: record.endOfShiftData || record.end_of_shift_data || {},
            errors_data: record.errorsData || record.errors_data || [],
            notes: record.notes || '',
            submitted_by: record.submittedBy || record.submitted_by || 'Supervisor'
        };

        const saved = await supabaseRest('kpi_daily_records?on_conflict=record_date,branch', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: payload
        });

        return {
            status: 'success',
            record: saved[0]
        };
    }

    /**
     * Get Weekly Monday-Sunday Aggregation Records (<25ms)
     */
    async function getWeeklyRecords(branch, mondayDate, sundayDate) {
        const cleanBranch = branch || 'AKRA';
        const filter = `branch=eq.${encodeURIComponent(cleanBranch)}&record_date=gte.${encodeURIComponent(mondayDate)}&record_date=lte.${encodeURIComponent(sundayDate)}&order=record_date.asc`;
        const records = await supabaseRest(`kpi_daily_records?${filter}`);
        return {
            status: 'success',
            branch: cleanBranch,
            mondayDate,
            sundayDate,
            records: records || []
        };
    }

    /**
     * Get Active Employees Roster
     */
    async function getEmployees(branch) {
        let filter = 'status=eq.Active&order=sort_order.asc,name.asc';
        if (branch) {
            filter += `&branch=eq.${encodeURIComponent(branch)}`;
        }
        const employees = await supabaseRest(`kpi_employees?${filter}`);
        return {
            status: 'success',
            employees: employees || []
        };
    }

    /**
     * Get Executive Action Center Items
     */
    async function getActions(branch) {
        let filter = 'order=action_date.desc';
        if (branch) {
            filter += `&branch=eq.${encodeURIComponent(branch)}`;
        }
        const actions = await supabaseRest(`kpi_actions?${filter}`);
        return {
            status: 'success',
            actions: actions || []
        };
    }

    /**
     * Save Executive Action
     */
    async function saveAction(actionData) {
        const payload = {
            branch: actionData.branch || 'AKRA',
            action_date: actionData.actionDate || new Date().toISOString().split('T')[0],
            title: actionData.title,
            description: actionData.description || '',
            assignee: actionData.assignee || '',
            status: actionData.status || 'Open',
            source_type: actionData.sourceType || 'Daily Brief'
        };

        const result = await supabaseRest('kpi_actions', {
            method: 'POST',
            body: payload
        });

        return {
            status: 'success',
            action: result[0]
        };
    }

    return {
        saveDailyRecord,
        getWeeklyRecords,
        getEmployees,
        getActions,
        saveAction,
        SUPABASE_CONFIG
    };
}));
