const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('        function showModal(title,'),end=html.indexOf('\n        function showCustomModal',start);
assert.ok(start>=0&&end>start);const source=html.slice(start,end);
function runtime(){
  const nodes=new Map(),timers=[];function node(id){if(!nodes.has(id)){const classes=new Set(id==='custom-modal'?['hidden']:[]);nodes.set(id,{innerHTML:'',textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),replace:(a,b)=>{classes.delete(a);classes.add(b);},contains:x=>classes.has(x)}});}return nodes.get(id);}
  const c=vm.createContext({_customModalRevision:0,_prevFocusElement:null,document:{activeElement:null,getElementById:node},setTimeout:(fn,ms)=>timers.push({fn,ms}),trapFocusInModal(){},releaseFocusFromModal(){}});vm.runInContext(source,c);return {c,node,timers};
}
test('Old close timer cannot hide a newly displayed save error',()=>{
  const r=runtime();r.c.showModal('Confirm','Fixture','confirm',()=>r.c.showModal('Save failed','Fixture outage','error'));
  r.node('modal-btn-confirm').onclick();for(const timer of r.timers)timer.fn();
  assert.equal(r.node('custom-modal-title').innerText,'Save failed');assert.equal(r.node('custom-modal').classList.contains('hidden'),false);
  r.node('modal-btn-ok').onclick();r.timers.at(-1).fn();assert.equal(r.node('custom-modal').classList.contains('hidden'),true);
});
test('Double confirmation during close animation invokes the mutation only once',()=>{
  const r=runtime();let calls=0;r.c.showModal('Confirm','Fixture','confirm',()=>calls++);const click=r.node('modal-btn-confirm').onclick;click();click();assert.equal(calls,1);
});
test('Warning and unknown informational types always get a working acknowledgement button',()=>{
  const r=runtime();r.c.showModal('Permission required','Fixture','warning');assert.equal(typeof r.node('modal-btn-ok').onclick,'function');r.node('modal-btn-ok').onclick();r.timers.at(-1).fn();assert.equal(r.node('custom-modal').classList.contains('hidden'),true);
});
