const test=require('node:test'),assert=require('node:assert/strict');
const {rig,token}=require('./helpers/identity-runtime.cjs');
test('rejected KPI auth clears page state and hides UI but never deletes Main/new app login or drafts',()=>{
 const f=rig();f.user();f.c.setTimeout=fn=>{fn();return 1;};
 f.local.set('akra_sso_token','shared-main');f.local.set('akra_kpi_session','new-app-login');
 f.c.fixtureStorage.setItem('kpiDraft_reused-name_AKRA_2026-09-18_main','draft');
 f.run("sectionEditRevisions.set('old',1);localActionsDraft=[{title:'old'}];ALL_ACTIONS=[{title:'old'}];");
 assert.equal(f.c.handleKpiAuthFailure({reason:'invalid_or_expired_token',status:401}),true);
 assert.equal(f.run('sessionToken'),null);assert.equal(f.run('kpiVerifiedSession'),null);
 assert.equal(f.run('sectionEditRevisions.size'),0);assert.equal(f.run('localActionsDraft.length+ALL_ACTIONS.length'),0);
 assert.equal(f.local.get('akra_sso_token'),'shared-main');assert.equal(f.local.get('akra_kpi_session'),'new-app-login');
 assert.equal(f.node('body').classList.contains('kpi-session-ready'),false);assert.equal(f.node('app-content').classList.contains('hidden'),true);
 assert.equal(f.redirects.length,1);f.user();assert.equal(f.c.fixtureStorage.getItem('kpiDraft_reused-name_AKRA_2026-09-18_main'),'draft');
});
test('non-auth failure keeps session; repeated bare 401 does not create redirect loops',()=>{
 const f=rig();f.user();f.c.setTimeout=fn=>{fn();return 1;};
 assert.equal(f.c.handleKpiAuthFailure({reason:'database_error',status:500}),false);assert.equal(f.run('sessionToken'),token);
 assert.equal(f.c.handleKpiAuthFailure({status:401}),true);assert.equal(f.c.handleKpiAuthFailure({status:401}),true);assert.equal(f.redirects.length,1);
});
