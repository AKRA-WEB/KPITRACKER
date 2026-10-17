// Actual pinned SVG adapter and observer callback, synthetic DOM only; root browser supplies visual evidence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function rig(){
 const events={},observers=[];
 class Element{
  constructor(tag){this.tagName=tag;this.nodeType=1;this.children=[];this.attributes={};this.dataset={};this.classList=new Set();this.writes=0;}
  setAttribute(key,value){this.attributes[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;this.writes++;}
  matches(selector){return selector==='i[class]'&&this.tagName==='i';}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(selector==='i[class]'&&child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){if(selector==='svg')return this.children.find(child=>child.tagName==='svg');return null;}
 }
 const document={readyState:'loading',head:new Element('head'),body:new Element('body'),createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),addEventListener:(name,fn)=>events[name]=fn};document.querySelectorAll=selector=>document.body.querySelectorAll(selector);
 const window={},context=vm.createContext({window,document,MutationObserver:class{constructor(fn){observers.push(fn);}observe(_node,options){assert.deepEqual(Array.from(options.attributeFilter),['class']);}}});
 for(const name of ['bm-icon-data.js','bm-icons.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name),'utf8'),context);
 const icon=(...classes)=>{const node=new Element('i');node.classList=new Set(classes);document.body.appendChild(node);return node;};
 return{window,document,events,observers,icon};
}
test('every canonical FA alias and standalone role renders only pinned decorative Lucide SVG',()=>{
 const f=rig(),map=JSON.parse(fs.readFileSync(path.join(__dirname,'../js/icon-map.json'),'utf8'));
 assert.equal(f.window.BMIconData.version,'0.469.0');for(const[alias,name]of Object.entries(map.fontAwesome)){const el=f.icon('fa-solid',alias);f.window.BMIcons.render(el);const svg=el.querySelector('svg');assert.ok(svg,alias);assert.equal(el.dataset.bmIcon,name);assert.equal(svg.attributes['aria-hidden'],'true');assert.equal(svg.attributes.focusable,'false');assert.equal(svg.attributes.stroke,'currentColor');assert.equal(el.children.length,1);assert.ok(svg.children.length);}
 for(const name of Object.values(map.standalone)){const svg=f.window.BMIcons.create(name);assert.equal(svg.attributes['aria-hidden'],'true');assert.equal(svg.attributes.focusable,'false');assert.ok(svg.children.length);}
 assert.equal(f.window.BMIcons.missing().length,0);
});
test('observer updates added/dynamic Vue icon hosts once, restores erased SVG, and own changes stop without a loop',()=>{
 const f=rig(),el=f.icon('fas','fa-clock','text-rose-600');f.events.DOMContentLoaded();const observer=f.observers[0];assert.equal(el.writes,1);const initial=el.querySelector('svg');
 observer([{type:'childList',target:el,addedNodes:[initial]}]);assert.equal(el.writes,1,'own SVG insertion is idempotent');
 el.classList=new Set(['fas','fa-spinner','fa-spin','text-rose-600']);observer([{type:'attributes',target:el}]);assert.equal(el.writes,2);assert.equal(el.dataset.bmIcon,'loader-circle');assert.equal(el.classList.has('text-rose-600'),true);assert.equal(el.classList.has('fa-spin'),true);
 observer([{type:'childList',target:el,addedNodes:el.children}]);assert.equal(el.writes,2);el.replaceChildren();observer([{type:'childList',target:el,addedNodes:[]}]);assert.equal(el.writes,4,'Vue clearing host is repaired exactly once');observer([{type:'childList',target:el,addedNodes:el.children}]);assert.equal(el.writes,4);
 const dynamic=f.icon('far','fa-calendar-day');observer([{type:'childList',target:f.document.body,addedNodes:[dynamic]}]);assert.equal(dynamic.dataset.bmIcon,'calendar-days');assert.equal(dynamic.writes,1);assert.equal(el.writes,4);assert.match(f.document.head.children[0].textContent,/fa-spin svg\{animation:bm-icon-spin/);
});
test('unmapped aliases and standalone roles use a safe decorative fallback while remaining icons hydrate',()=>{
 const f=rig(),el=f.icon('fas','fa-check');f.window.BMIcons.render(el);el.classList=new Set(['fas','fa-unknown']);const known=f.icon('fas','fa-clock');
 assert.doesNotThrow(()=>f.window.BMIcons.render(f.document));assert.ok(el.querySelector('svg'));assert.equal(el.attributes['data-bm-icon-missing'],'fa-unknown');assert.equal(known.dataset.bmIcon,'clock');
 assert.ok(f.window.BMIcons.create('unknown').children.length);assert.deepEqual(Array.from(f.window.BMIcons.missing()),['fa-unknown','unknown']);
 assert.doesNotThrow(()=>f.window.BMIcons.create('constructor'));
});

test('standalone switcher unknown role uses a fallback without aborting navigation rendering',()=>{
 const f=rig(),source=fs.readFileSync(path.join(__dirname,'../js/akra-shell-bridge.js'),'utf8');
 const start=source.indexOf('    function switcherIcon('),end=source.indexOf('\n    async function confirmStandaloneLeave',start);
 const c=vm.createContext({window:f.window,APP_SWITCHER_ICONS:{home:'house'},console:{warn(){}}});vm.runInContext(source.slice(start,end),c);
 assert.doesNotThrow(()=>c.switcherIcon('unknown'));assert.doesNotThrow(()=>c.switcherIcon('constructor'));assert.ok(c.switcherIcon('home').children.length);
});
