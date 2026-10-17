// Synthetic DOM is limited to behavior tests; native dialog layout/modality needs root browser evidence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function rig(){
 const document={activeElement:null};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.style={};this.attributes={};this.isConnected=false;this.disabled=false;this.value='';this.classList={add(){},remove(){},contains:()=>false};}
  appendChild(node){this.children.push(node);node.parent=this;node.isConnected=this.isConnected;return node;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
  dispatch(k,event={}){this.listeners[k]?.({preventDefault(){},...event});}
  focus(){document.activeElement=this;}
  blur(){if(document.activeElement===this)document.activeElement=document.body;}
  showModal(){this.open=true;this.previous=document.activeElement;}
  close(){this.open=false;if(this.previous?.isConnected)this.previous.focus();}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 }
 document.body=new Element('body');document.body.isConnected=true;
 document.createElement=tag=>new Element(tag);const nodes=new Map();document.getElementById=id=>nodes.get(id)||null;
 document.querySelectorAll=()=>[];document.addEventListener=()=>{};
 const node=id=>{if(!nodes.has(id)){const el=new Element('input');el.id=id;document.body.appendChild(el);nodes.set(id,el);}return nodes.get(id);};
 const window={};const native=[];const c=vm.createContext({window,document,Date,Intl,URL,URLSearchParams,console,Promise,setTimeout,clearTimeout,confirm:()=>{native.push('confirm');return false;},alert:()=>native.push('alert')});
 const run=source=>vm.runInContext(source,c);
 c.owner={id:1};c.sessionToken='token';c.currentBranch='AKRA';c.currentUser='u1';node('record-date').value='2026-10-12';
 window.getBmDialogContext=()=>[c.owner,c.sessionToken,c.currentBranch,c.currentUser,node('record-date').value];
 run(fs.readFileSync(path.join(__dirname,'../../js/bm-dialog.js'),'utf8'));
 const dialog=()=>document.body.children.find(el=>el.id==='bm-ui-dialog');
 const button=label=>dialog()?.children.at(-1).children.find(el=>el.textContent===label);
 return{c,window,document,run,node,native,dialog,button};
}
module.exports={rig,tick:()=>new Promise(setImmediate)};
