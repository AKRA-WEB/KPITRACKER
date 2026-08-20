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
     * Fetch branch daily records with months filter (<25ms)
     */
    async function fetchBranchData(branch, months = 3) {
        const cleanBranch = branch || 'AKRA';
        let filter = `branch=eq.${encodeURIComponent(cleanBranch)}&order=record_date.desc`;
        if (months) {
            const d = new Date();
            d.setMonth(d.getMonth() - parseInt(months, 10));
            const cutoff = d.toISOString().split('T')[0];
            filter += `&record_date=gte.${cutoff}`;
        }
        const records = await supabaseRest(`kpi_daily_records?${filter}`);
        return (records || []).map(r => ({
            date: r.record_date,
            branch: r.branch,
            workload: r.workload_data || [],
            errors: r.errors_data || [],
            tasks: (r.end_of_shift_data && r.end_of_shift_data.tasks) || [],
            volume: (r.end_of_shift_data && r.end_of_shift_data.volume) || { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            customerNotes: (r.end_of_shift_data && r.end_of_shift_data.customerNotes) || r.notes || '',
            endOfShift: r.end_of_shift_data || {},
            notes: r.notes || ''
        }));
    }

    /**
     * Upsert Daily Record (Workload, Errors, End of Shift JSONB)
     */
    async function saveDailyRecord(record) {
        const branch = record.branch || 'AKRA';
        const date = record.date || record.recordDate || record.record_date;
        const endOfShiftMerged = {
            ...(record.endOfShift || record.endOfShiftData || record.end_of_shift_data || {}),
            tasks: record.tasks || (record.endOfShift && record.endOfShift.tasks) || [],
            volume: record.volume || (record.endOfShift && record.endOfShift.volume) || { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
            customerNotes: record.customerNotes || (record.endOfShift && record.endOfShift.customerNotes) || ''
        };

        const payload = {
            record_date: date,
            branch: branch,
            workload_data: record.workload || record.workloadData || record.workload_data || [],
            end_of_shift_data: endOfShiftMerged,
            errors_data: record.errors || record.errorsData || record.errors_data || [],
            notes: record.customerNotes || record.notes || '',
            submitted_by: record.submittedBy || record.submitted_by || 'Supervisor',
            is_migrated: false
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
            records: (records || []).map(r => ({
                date: r.record_date,
                branch: r.branch,
                workload: r.workload_data || [],
                errors: r.errors_data || [],
                tasks: (r.end_of_shift_data && r.end_of_shift_data.tasks) || [],
                volume: (r.end_of_shift_data && r.end_of_shift_data.volume) || { transfer: 0, pickup: 0, upcountry: 0, inmarket: 0, outmarket: 0 },
                customerNotes: (r.end_of_shift_data && r.end_of_shift_data.customerNotes) || r.notes || '',
                endOfShift: r.end_of_shift_data || {},
                notes: r.notes || ''
            }))
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
     * Get Employee Config in format matching Google Apps Script getConfig
     */
    async function getConfig() {
        const employees = await supabaseRest('kpi_employees?order=sort_order.asc,name.asc');
        const empMap = new Map();
        (employees || []).forEach(e => {
            if (!empMap.has(e.name)) {
                empMap.set(e.name, {
                    uid: e.legacy_uid || e.id,
                    name: e.name,
                    branches: e.branch,
                    dept: e.role || '',
                    status: e.status || 'Active'
                });
            } else {
                const existing = empMap.get(e.name);
                if (!existing.branches.includes(e.branch)) {
                    existing.branches += `,${e.branch}`;
                }
            }
        });
        return Array.from(empMap.values());
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
        return (actions || []).map(r => ({
            actionId: String(r.id),
            branch: r.branch,
            actionDate: r.action_date,
            title: r.title,
            description: r.description || '',
            assignee: r.assignee || '',
            status: r.status || 'Open',
            sourceType: r.source_type || 'Daily Brief',
            lastUpdated: r.updated_at || r.created_at
        }));
    }

    /**
     * Save Executive Action
     */
    async function saveAction(actionData) {
        const payload = {
            branch: actionData.branch || 'AKRA',
            action_date: actionData.actionDate || actionData.date || new Date().toISOString().split('T')[0],
            title: actionData.title,
            description: actionData.description || '',
            assignee: actionData.assignee || '',
            status: actionData.status || 'Open',
            source_type: actionData.sourceType || 'Daily Brief'
        };
        if (actionData.actionId && !actionData.actionId.startsWith('ACT-') && !actionData.actionId.includes('.')) {
            payload.id = actionData.actionId;
        }

        const result = await supabaseRest('kpi_actions', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: payload
        });

        const saved = result && result[0] ? result[0] : payload;
        return {
            status: 'success',
            actionId: String(saved.id || Date.now()),
            actionItem: {
                actionId: String(saved.id || Date.now()),
                branch: saved.branch,
                title: saved.title,
                description: saved.description,
                assignee: saved.assignee,
                status: saved.status,
                lastUpdated: saved.updated_at || new Date().toISOString()
            }
        };
    }

    return {
        fetchBranchData,
        saveDailyRecord,
        getWeeklyRecords,
        getEmployees,
        getConfig,
        getActions,
        saveAction,
        SUPABASE_CONFIG
    };
}));
