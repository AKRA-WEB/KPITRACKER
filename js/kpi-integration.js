(function(window) {
    'use strict';
    let ticket=0, status='idle';
    function summarize(requisitions,events,uid) {
        const requests=(requisitions||[]).filter(row=>row.workloadEligible===true);
        const actual=(events||[]).filter(row=>row&&typeof row==='object');
        const key=String(uid||'').trim().toLowerCase();
        return {
            total:requests.length+actual.length, requests:requests.length, actual:actual.length,
            myActual:key?actual.filter(row=>String(row.actorEmployeeUid||'').trim().toLowerCase()===key).length:0,
            myAssigned:key?requests.filter(row=>row.assigneeIdentityStatus==='linked'&&String(row.assigneeEmployeeUid||'').trim().toLowerCase()===key).length:0
        };
    }
    function date() { return document.getElementById('record-date')?.value || window.getTodayBangkokDateStr?.() || ''; }
    function renderActivity() {
        const c=window.getKpiTaskContext?.()||{}, selected=date();
        const loaded=typeof liveRequisitionsLoadedDate!=='undefined'&&liveRequisitionsLoadedDate===selected;
        const sum=summarize(typeof liveRequisitionsList==='undefined'?[]:liveRequisitionsList,typeof liveOperationalEventsList==='undefined'?[]:liveOperationalEventsList,c.userUid);
        const available=loaded&&status!=='error';
        const stateText=status==='error'?'โหลดกิจกรรมไม่สำเร็จ กรุณารีเฟรช': 'กำลังโหลดกิจกรรม...';
        const dash=document.getElementById('dash-activity-summary'), profile=document.getElementById('profile-activity-summary');
        if(dash)dash.textContent=available?`วันที่ ${selected} · ${sum.total} กิจกรรมระบบรวม · LINE ${sum.requests} · Event จริง ${sum.actual}`:stateText;
        if(profile)profile.textContent=available?`วันที่ ${selected} · ปฏิบัติงานจริง ${sum.myActual} กิจกรรม · LINE รับมอบหมาย ${sum.myAssigned} งาน`:stateText;
    }
    async function refreshActivity() {
        const c=window.getKpiTaskContext?.()||{}, selected=date(), current=++ticket;
        if(!c.token||!/^\d{4}-\d{2}-\d{2}$/.test(selected))return;
        status='loading';
        for(const id of ['dash-activity-summary','profile-activity-summary']) {const el=document.getElementById(id);if(el)el.textContent='กำลังโหลดกิจกรรม...';}
        const result=await window.fetchLiveRequisitions?.(selected,true);
        const next=window.getKpiTaskContext?.()||{};
        if(current!==ticket||next.token!==c.token||next.branch!==c.branch||date()!==selected)return;
        status=result?'ready':'error';renderActivity();
    }
    window.KpiIntegration={summarize,renderActivity,refreshActivity,acceptActivity(){status="ready";renderActivity();}};
})(window);
