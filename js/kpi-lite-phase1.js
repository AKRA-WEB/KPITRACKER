(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AkraKpiLite = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const INSTALL_FLAG = '__akraKpiLitePhase1Installed';

    function setWorkloadPrimary(win, row, key) {
        if (!row) return;
        const capacityEl = row.querySelector('.wl-capacity');
        if (!capacityEl) return;

        const capacity = 10;
        capacityEl.value = String(capacity);
        const selectors = {
            outbound: '.wl-outbound',
            inbound: '.wl-inbound',
            transfer: '.wl-transfer',
            shared: '.wl-shared'
        };

        Object.entries(selectors).forEach(([name, selector]) => {
            const input = row.querySelector(selector);
            if (input) input.value = name === key ? String(capacity) : '0';
        });

        if (typeof win.validateRowTotal === 'function') win.validateRowTotal(row);
        if (typeof win.saveRecordDraftDebounced === 'function') win.saveRecordDraftDebounced();
    }

    function addWorkloadQuickActions(win, row) {
        if (!row || row.querySelector('[data-kpi-lite-quick-actions]')) return;
        const canEdit = !row.querySelector('button[disabled], select[disabled]');
        if (!canEdit) return;

        const bar = win.document.createElement('div');
        bar.dataset.kpiLiteQuickActions = '1';
        bar.className = 'flex flex-wrap gap-1.5 border-t border-slate-200 pt-2';

        const title = win.document.createElement('span');
        title.className = 'w-full text-[10px] font-bold text-slate-500';
        title.textContent = 'กรอกเร็ว · งานหลักเต็มวัน';
        bar.appendChild(title);

        const actions = [
            ['outbound', 'ขาออก 10'],
            ['inbound', 'ขาเข้า 10'],
            ['transfer', 'ย้าย 10'],
            ['shared', 'อื่น ๆ 10']
        ];

        actions.forEach(([key, label]) => {
            const btn = win.document.createElement('button');
            btn.type = 'button';
            btn.className = 'min-h-[36px] rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 active:bg-amber-100';
            btn.textContent = label;
            btn.addEventListener('click', () => setWorkloadPrimary(win, row, key));
            bar.appendChild(btn);
        });

        row.appendChild(bar);
    }

    function enhanceWorkloadEditor(win) {
        const container = win.document.getElementById('akra-workload-container');
        if (!container) return;
        container.querySelectorAll('.workload-row').forEach(row => addWorkloadQuickActions(win, row));
    }

    function installExplicitErrorConfirmation(win) {
        if (typeof win.buildDailyDashboardViewModel !== 'function' ||
            typeof win.buildDailyDashboardErrorState !== 'function') return false;
        if (win.buildDailyDashboardViewModel.__kpiLiteWrapped) return true;

        const original = win.buildDailyDashboardViewModel;
        const wrapped = function (options) {
            const model = original.call(this, options);
            const explicitErrors = win.buildDailyDashboardErrorState(options && options.dayData && options.dayData.errors, options.branch);
            explicitErrors.assumedZero = false;
            model.errors = explicitErrors;

            if (explicitErrors.state === 'missing' && model.completeness) {
                const missing = Array.isArray(model.completeness.missing) ? model.completeness.missing.slice() : [];
                if (!missing.includes('ความผิดพลาด')) missing.push('ความผิดพลาด');
                model.completeness = { isComplete: false, missing };
            }
            return model;
        };
        wrapped.__kpiLiteWrapped = true;
        wrapped.__original = original;
        win.buildDailyDashboardViewModel = wrapped;
        return true;
    }

    function install(win) {
        if (!win || !win.document) throw new Error('A browser window is required');
        if (win[INSTALL_FLAG]) return { installed: true, repeated: true };
        win[INSTALL_FLAG] = true;

        const apply = () => {
            installExplicitErrorConfirmation(win);
            enhanceWorkloadEditor(win);
        };

        apply();
        const observer = new win.MutationObserver(apply);
        observer.observe(win.document.documentElement, { childList: true, subtree: true });

        return {
            installed: true,
            repeated: false,
            observer,
            features: ['explicit-error-confirmation', 'workload-quick-fill']
        };
    }

    return { install, setWorkloadPrimary };
}));
