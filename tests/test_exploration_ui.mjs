import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const load=async name=>{const source=await readFile(new URL(`../static/${name}`,import.meta.url),'utf8');return import(`data:text/javascript;base64,${Buffer.from(source.replace(/^const DATA = new URL.*$/m,'')).toString('base64')}`);};
const exploration=await load('exploration.js'),worldModule=await load('world.js');
const gameSource=(await readFile(new URL('../static/game.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
// A small all-water world on the real projection and grid bounds, with an island west of the start and 7/10 old ice under it.
function stubWorld(){
 const cols=130,rows=90,size=cols*rows,elevation=new Int16Array(size).fill(-300),ice=new Uint8Array(size),iceClass=new Uint8Array(size);
 const meta={grid:{cols,rows,resolution:20000,xmin:-1300000,ymin:-2400000,xmax:1300000,ymax:-600000},projection:{latTs:78,lon0:-90,a:6378137,f:1/298.257223563},ice:{classes:[{stage:'Not reported',form:'Not reported'},{stage:'Old ice',form:'Vast floe (2–10 km)'}],charts:[{date:'2026-09-07'}]},places:[{name:'Dundas',lon:-68.8,lat:76.55}],start:{lon:-70.5573,lat:76.5109},shipTrack:{lonLat:[]}};
 const world=worldModule.createWorld(meta,{elevation,iceConcentration:ice,iceClass,glacier:new Uint8Array(size)});
 const c=Math.floor(world.start.x*cols),r=Math.floor(world.start.y*rows);
 for(let y=r-3;y<=r+3;y++)for(let x=c-3;x<=c+3;x++){ice[y*cols+x]=70;iceClass[y*cols+x]=1;}
 for(let y=r-2;y<=r+2;y++)for(let x=c-12;x<=c-10;x++)elevation[y*cols+x]=400;
 return worldModule.createWorld(meta,{elevation,iceConcentration:ice,iceClass,glacier:new Uint8Array(size)});
}
function harness(){
 const listeners=new Map(),elements=new Map(),sessions=[],saved=new Map();let disposed=0,frame;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};this.isConnected=true;this.open=false;this.dataset={};this.textContent='';this.width=0;this.height=0;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  setAttribute(name,value){this[name]=value;}
  closest(){return ['INPUT','TEXTAREA','SELECT','BUTTON','A','DIALOG'].includes(this.tagName)||this.editable?this:null;}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.();}
  getBoundingClientRect(){return {width:800,height:450,left:0,top:0};}
  getContext(){return new Proxy({}, {get:(obj,key)=>obj[key]??(()=>{}),set:(obj,key,val)=>(obj[key]=val,true)});}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new Element(id==='#ocean'?'canvas':'div'));return elements.get(id);};
 const document={querySelector:element,querySelectorAll:()=>[],createElement:tag=>new Element(tag),addEventListener:(n,fn)=>listeners.set('document:'+n,fn),hidden:false,body:new Element('body')};
 const game={mount(root,options){sessions.push(options);return ()=>disposed++;}};
 const world=stubWorld();
 const context={...exploration,publicMirror:false,ICE_STATION_MIN:worldModule.ICE_STATION_MIN,loadWorld:async()=>world,renderChart:async()=>new Element('canvas'),CHART_SCALE:2,document,window:{addEventListener:(n,fn)=>listeners.set(n,fn)},minigames:{ctd:game,ice:game},activities:[{id:'ctd',title:'CTD cast',description:'Read water',key:'c'},{id:'ice',title:'Ice',description:'Read ice',key:'i',requires:'ice'}],localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{frame=fn;},setInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:true,json:async()=>[]}),confirm:()=>true,performance:{now:()=>0},console};
 vm.runInNewContext(gameSource,context);
 const key=(k,target=new Element(),extra={})=>{let prevented=false;listeners.get('keydown')({key:k,target,preventDefault(){prevented=true;},...extra});return prevented;};
 const ready=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
 return {element,sessions,key,Element,saved,world,ready,get disposed(){return disposed;},tick:t=>frame(t),state:()=>JSON.parse(saved.get(exploration.STORAGE_KEY))};
}
test('registry buttons and keys launch afloat; the ice station needs ice; typing and dialog keys are left alone',async()=>{
 const h=harness();await h.ready();assert.equal(h.element('#activities').children.length,2);
 assert.equal(h.key('c',new h.Element('input')),false);
 assert.equal(h.key('i',new h.Element('button')),false);
 const editable=new h.Element();editable.editable=true;assert.equal(h.key('c',editable),false);
 assert.equal(h.key('c',undefined,{ctrlKey:true}),false);assert.equal(h.sessions.length,0);
 assert.equal(h.key('C'),true);assert.equal(h.sessions.length,1);
 const {expedition}=h.sessions[0];assert.ok(Math.abs(expedition.lon+70.5573)<.01&&Math.abs(expedition.lat-76.5109)<.01);assert.equal(expedition.depth,300);assert.equal(expedition.ice.concentration,7);assert.equal(expedition.ice.stage,'Old ice');
 assert.equal(h.key('i'),false);assert.equal(h.sessions.length,1);
 h.element('#close-mission').onclick();assert.equal(h.disposed,1);
 assert.equal(h.key('i'),true);assert.equal(h.sessions.length,2);
 h.element('#close-mission').onclick();assert.equal(h.key('e'),true);assert.equal(h.sessions.length,3);
 h.element('#close-mission').onclick();
 // Out of the ice the ice station explains itself instead of opening; the CTD still launches.
 h.element('#ocean').handlers.pointerdown({clientX:400,clientY:100});for(let i=0;i<200;i++)h.tick(i*16);
 assert.equal(h.key('i'),true);assert.equal(h.sessions.length,3);assert.match(h.element('#toast').textContent,/No ice here/);assert.ok(h.element('#activities').children[1].classes.has('unavailable'));
 assert.equal(h.key('c'),true);assert.equal(h.sessions.length,4);assert.equal(h.sessions[3].expedition.ice.concentration,0);
});
test('late and duplicate completions cannot score; reopening starts a fresh operation',async()=>{
 const h=harness();await h.ready();h.element('#activities').children[0].onclick();const first=h.sessions[0];
 h.element('#close-mission').onclick();first.complete(100);assert.equal(h.element('#score').textContent,0);
 h.element('#activities').children[0].onclick();first.complete(100);assert.equal(h.element('#score').textContent,0);
 const title='<img src=x onerror=alert(1)>';h.sessions[1].complete(100,{title});h.sessions[1].complete(100);
 assert.equal(h.element('#score').textContent,100);assert.equal(h.element('#completed').textContent,1);
 assert.equal(h.element('#discovery-log').children[0].children[0].textContent,title);
 assert.equal(h.state().discoveries.length,1);assert.equal(h.state().version,exploration.VERSION);
 h.element('#mission-dialog').handlers.cancel();h.element('#mission-dialog').close();assert.equal(h.disposed,2);
 h.element('#reset').onclick();assert.equal(h.element('#score').textContent,0);assert.equal(h.element('#completed').textContent,0);
 h.sessions[1].complete(100);assert.equal(h.element('#score').textContent,0);
});
test('sailing never auto-launches operations, steering into land grounds the ship and the render loop runs',async()=>{
 const h=harness();await h.ready();
 h.element('#activities').children[0].onclick();h.sessions[0].complete(80);h.element('#close-mission').onclick();assert.equal(h.element('#score').textContent,80);
 const start=h.state();h.element('#ocean').handlers.pointerdown({clientX:100,clientY:225});
 for(let i=0;i<300;i++)h.tick(i*16);
 assert.equal(h.sessions.length,1);assert.ok(h.element('#chart-percent').textContent!=='0%');
 h.key('c');assert.ok(h.sessions[1].expedition.x<start.x);assert.equal(h.element('#score').textContent,80);h.element('#close-mission').onclick();
 // The island west of the start: click-to-sail routes past it, the arrow keys do not.
 assert.equal(h.state().groundings,0);
 h.key('arrowright');for(let i=0;i<600;i++)h.tick(5000+i*16);
 assert.equal(h.state().groundings,1);assert.equal(h.element('#score').textContent,0);assert.match(h.element('#toast').textContent,/aground/i);
 const log=h.state().discoveries;assert.equal(log.at(-1).activity,'grounding');assert.equal(log.at(-1).lost,80);assert.equal(log[0].points,80);
 assert.ok(!h.world.isLand(h.state().x*h.world.cols,h.state().y*h.world.rows));
});
