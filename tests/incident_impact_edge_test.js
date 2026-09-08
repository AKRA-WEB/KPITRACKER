const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/incident-model.json'),'utf8')); model.active=true;
const source=fs.readFileSync(path.join(__dirname,'../../database/supabase/functions/kpi-api/index.ts'),'utf8').replace(/^import[^\n]+\n/,'').replace(': string[] = []',' = []').replace(': Record<string, string> = {}',' = {}');
function runtime(roles=['TRD'],valid=true){
 let handler;const reads=[],writes=[];
 const fixtures={incidentModel:model,now:new Date('2026-09-08T04:00:00Z'),verifyMainJwt:async()=>valid?{id:'a',roles,apps:['app-kpi'],exp:9999999999}:null,
 dbRows:async(table,q)=>{reads.push(table);if(table==='users')return[{username:'a',name:'A',roles,status:'Active'}];if(table==='kpi_system_configs')return[{config_key:'incident_model',config_value:model}];return[];},
 dbRpc:async(name,body)=>{writes.push({name,body});return{status:'success',errors:body.p_entries.map(e=>({...e,revision:1}))};}};
 const context={console,Request,Response,Headers,URL,TextEncoder,TextDecoder,setTimeout,clearTimeout,__KPI_API_TEST_FIXTURES__:fixtures,Deno:{env:{get:()=>undefined},serve:f=>handler=f}};
 vm.runInNewContext(source,context);return{handler,reads,writes};
}
const type=model.branches.TRD.types.find(t=>t.name==='จัดสินค้าผิด');
const payload=()=>({action:'saveIncident',token:'token',branch:'TRD',date:'2026-09-08',incident:{kind:'case',schemaVersion:3,scoringMode:'none',caseId:'ERR-2026-09-08-a',
 typeId:type.id,impact:'reached_customer',catalogRevision:1,worker:'A',participants:['A'],roster:['A'],responsibility:'individual',note:'test',time:'10:00 น.'}});
const call=async(r,p)=>{const res=await r.handler(new Request('https://example.test',{method:'POST',headers:{Origin:'https://akra-web.github.io','Content-Type':'application/json'},body:JSON.stringify(p)}));return{status:res.status,body:await res.json()};};
(async()=>{
 let r=runtime(),res=await call(r,payload());assert.equal(res.status,200);assert.equal(r.writes[0].name,'kpi_mutate_incident_v3');
 assert.equal(r.writes[0].body.p_entries[0].impact,'reached_customer');assert.equal(r.writes[0].body.p_entries[0].penalty,0);assert.equal(res.body.incidents[0].schemaVersion,3);
 for(const patch of [{impact:''},{impact:'not_applicable'},{typeId:'missing'},{penalty:5},{catalogRevision:0},{participants:['A','A']},{type:'spoofed',scoringMode:'hp'}]){
  r=runtime();const p=payload();Object.assign(p.incident,patch);res=await call(r,p);assert.ok([400,409].includes(res.status));assert.equal(r.writes.length,0);
 }
 for(const args of [[['TRD'],false],[['AKRA'],true]]){r=runtime(...args);res=await call(r,payload());assert.ok([401,403].includes(res.status));assert.equal(r.reads.length,0);assert.equal(r.writes.length,0);}
 r=runtime();let p=payload();delete p.incident.schemaVersion;res=await call(r,p);assert.equal(res.status,409);assert.equal(r.writes.length,0);
 console.log('PASS: impact model Edge authoritative fields, branch/auth denial, invalid impact, stale catalog and legacy-client gate.');
})().catch(e=>{console.error(e);process.exitCode=1});
