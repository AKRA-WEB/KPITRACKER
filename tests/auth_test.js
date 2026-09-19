const test=require('node:test'),assert=require('node:assert/strict');
const {rig,original,token,section,html}=require('./helpers/identity-runtime.cjs');
function page(options){
 const f=rig(options);
 for(const name of ['applyRolePermissions','refreshActions','startAdminStatusRefresh','syncAllBranchesForAdmin','renderAdminPanel'])f.c[name]=()=>{};
 f.run("let _lastRecordDate='';");
 for(const name of ['hasKpiAdminRole','canAccessAdminSettings'])f.run(html.match(new RegExp('function '+name+'\\([^]*?\\n        \\}'))[0]);
 f.run(section('        async function checkAuth(','        function syncAppRecordDate('));
 return f;
}
test('verified URL session opens KPI; current Main viewer role overrides stale administration role',async()=>{
 const f=page();f.local.set('akra_sso_token','shared-main');
 const result=await f.c.resolveSsoAuth();await f.c.checkAuth(result);
 assert.equal(f.run('currentUser'),original.id);assert.equal(f.run('IS_ADMIN'),true);
 assert.equal(f.node('body').classList.contains('kpi-session-ready'),true);assert.equal(f.node('kpi-session-status').hidden,true);
 assert.equal(f.local.get('akra_sso_token'),'shared-main');assert.equal(JSON.parse(f.local.get('akra_kpi_session')).token,token);
 f.run("KPI_MAIN_VIEWER={name:'Current worker',roles:['WAREHOUSE']};");await f.c.checkAuth(result);
 assert.equal(f.run('IS_ADMIN'),false);assert.equal(f.run('displayUserName'),'Current worker');
});
test('expired URL and cached/manual-only identity stay private without changing Main shared storage',async()=>{
 for(const cachedOnly of [false,true]){
  const f=page({verify:async()=>{throw Error('invalid_or_expired_token');}});
  f.local.set('akra_sso_user_data',JSON.stringify({username:'forged',roles:['ADMIN']}));
  if(cachedOnly)f.window.location.search='';else f.local.set('akra_sso_token','old-main');
  const result=await f.c.resolveSsoAuth();await f.c.checkAuth(result);
  assert.equal(result.attempted,!cachedOnly);assert.equal(result.expired,!cachedOnly);
  assert.equal(f.run('currentUser'),null);assert.equal(f.run('sessionToken'),null);
  assert.equal(f.node('body').classList.contains('kpi-session-ready'),false);assert.equal(f.node('kpi-session-status').hidden,false);
  assert.match(f.node('kpi-session-message').textContent,/Main/);assert.ok(f.local.get('akra_sso_user_data'));
  if(!cachedOnly)assert.equal(f.local.get('akra_sso_token'),'old-main');
 }
});
test('Supervisor retains Main name/role and explicit permission reduction still denies settings',async()=>{
 for(const allowed of [false,true]){
  const user={...original,name:'หัวหน้างาน',roles:['SUPERVISOR'],tokenVersion:2,perms:{'app-kpi':allowed?['adminDashboard']:[]}};
  const f=page({verify:async()=>user});await f.c.checkAuth();
  assert.equal(f.run('IS_ADMIN'),allowed);assert.equal(f.run('displayUserName'),user.name);assert.deepEqual(Array.from(f.run('currentRoles')),['SUPERVISOR']);
 }
});
