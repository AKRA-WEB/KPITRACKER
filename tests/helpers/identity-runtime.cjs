// Actual extracted page functions; synthetic storage/DOM only, no network or operational data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8').replace(/\r\n/g,'\n');
const original={id:'reused-name',name:'Original',roles:['ADMIN'],identityId:'10000000-0000-4000-8000-000000000011',sessionVersion:1,authorizationRevision:'rev-one',apps:['app-kpi'],perms:{'app-kpi':['adminDashboard']}};
const replacement={...original,name:'Replacement',identityId:'10000000-0000-4000-8000-000000000012'};
const token='head.'+Buffer.from(JSON.stringify(original)).toString('base64url')+'.not-a-signature';
const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start+a.length);assert(start>=0&&end>start);return html.slice(start,end);};
const tick=()=>new Promise(setImmediate);
function rig({verify=async()=>original}={}){
 const local=new Map(),tab=new Map(),events={},nodes=new Map(),redirects=[];
 const storage=store=>({getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear(),get length(){return store.size;},key:i=>Array.from(store.keys())[i]});
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{hidden:false,textContent:'',innerText:'',innerHTML:'',value:'',classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},style:{setProperty(){}},setAttribute(){},removeAttribute(){}});}return nodes.get(id);};
 const window={location:{search:'?sso='+token,pathname:'/KPITRACKER/',hash:'',href:'https://fixture.invalid/KPITRACKER/',replace:u=>redirects.push(u)},history:{replaceState(){}},addEventListener:(key,fn)=>events[key]=fn,
  AkraModule:{embedded:false,getToken:()=>'',verifySession:verify,authRequired:u=>redirects.push(u),home:u=>redirects.push(u)}};
 const c=vm.createContext({window,document:{title:'KPI',getElementById:node,querySelectorAll:()=>[],body:node('body')},URL,URLSearchParams,Date,console:{log(){},error(){},warn(){}},
  location:window.location,localStorage:storage(local),sessionStorage:storage(tab),setTimeout(){},clearTimeout(){},clearInterval(){},showToast(){},confirm:()=>true,
  PORTAL_URL:'https://fixture.invalid/Main/',decodeJwtPayload:()=>({...original}),GLOBAL_CONFIG_LIST:[],KPI_SYSTEM_CONFIG:{},processConfigList(){},applySystemConfig(){},populateAdminEmpFilter(){},TRD_DEPARTMENTS:{}});
 const run=s=>vm.runInContext(s,c);
 run(section('        // ================= SAFE STORAGE WRAPPERS','        const KPI_CACHE_TTL'));
 run(section('        // ================= AUTH & STATE','        // ================= HELPER FUNCTIONS'));
 run('let _draftTimer=null,_restoringDraft=false,localActionsDraft=[],ALL_ACTIONS=[],liveRequisitionRequest=0,liveRequisitionRefreshTimer=null,liveRequisitionsList=[];const sectionEditRevisions=new Map(),ScopedRefresher={inFlight:{}};');
 run(section('        async function resolveSsoAuth(','        async function checkAuth('));
 run('this.fixtureStorage=safeStorage;this.fixtureSessionStorage=safeSessionStorage;');
 const user=(u=original,t=token)=>{c.testOwner={user:{...u},token:t};c.testToken=t;run("kpiVerifiedSession=testOwner;sessionToken=testToken;currentUser=testOwner.user.id;");};
 return{c,run,window,local,tab,events,node,redirects,user};
}
module.exports={html,original,replacement,token,section,tick,rig};
