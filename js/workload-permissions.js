(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.AkraKpiWorkloadPermissions=api;
}(typeof window==='undefined'?{}:window,function(){
    'use strict';
    function canRecordSelf(roles,token,authorization){
        if(!token||!authorization||!(Array.isArray(roles)?roles:[]).some(role=>['ADMIN','SUPERVISOR','AKRA','WAREHOUSE'].includes(String(role).trim().toUpperCase())))return false;
        const catalog=authorization.permissionCatalog;
        // Match the API's catalog-aware transition. This is a UI hint, not authority.
        if(catalog===undefined)return true;
        if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))return false;
        const defined=catalog['app-kpi'];
        if(defined===undefined)return true;
        if(!Array.isArray(defined))return false;
        if(!defined.includes('recordWorkload'))return true;
        return Array.isArray(authorization.perms?.['app-kpi'])&&authorization.perms['app-kpi'].includes('recordWorkload');
    }
    function apply(document,allowed){
        const message=allowed?'':'สิทธิ์บันทึกเวลาของตนเองถูกปิดใน Main กรุณาติดต่อผู้ดูแลระบบ';
        for(const id of ['btn-save-workload','btn-clear-workload','btn-save-quick-workload']){
            const button=document.getElementById(id);if(!button)continue;
            button.disabled=!allowed;button.setAttribute('aria-disabled',String(!allowed));button.title=message;
        }
        const status=document.getElementById('workload-access-status');
        if(status){status.textContent=message;status.classList.toggle('hidden',allowed);}
    }
    return Object.freeze({canRecordSelf,apply});
}));
