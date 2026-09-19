const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);let i=html.indexOf('{',start)+1,n=1;while(n){if(html[i]==='{')n++;if(html[i]==='}')n--;i++;}return html.slice(start,i);}
test('KPI Main contract controls privileged UI with ADMIN/SUPERVISOR parity, without legacy privilege escalation',()=>{
 const c=vm.createContext({sessionToken:'fixture',IS_ADMIN:true,_kpiPerms:[]});
 vm.runInContext(fn('hasKpiAdminRole')+fn('canAccessAdminSettings')+fn('can'),c);
 for(const role of ['ADMIN','SUPERVISOR']){
  assert.equal(c.canAccessAdminSettings([role],'fixture',{tokenVersion:2,perms:{'app-kpi':[]}}),false);
  assert.equal(c.canAccessAdminSettings([role],'fixture',{tokenVersion:2,perms:{}}),false);
  assert.equal(c.canAccessAdminSettings([role],'fixture',{perms:{'app-kpi':['adminDashboard']}}),true);
  assert.equal(c.canAccessAdminSettings([role],'',{perms:{'app-kpi':['adminDashboard']}}),false);
  assert.equal(c.canAccessAdminSettings([role],'legacy'),true);
 }
 assert.equal(c.canAccessAdminSettings(['WAREHOUSE'],'fixture',{perms:{'app-kpi':['adminDashboard']}}),false);
 assert.equal(c.can('adminDashboard'),false);
 c._kpiPerms=['adminDashboard'];assert.equal(c.can('adminDashboard'),true);
 c.sessionToken='';assert.equal(c.can('adminDashboard'),false);
});
