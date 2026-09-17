import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../static/exploration.js',import.meta.url),'utf8');
const exploration=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const gameSource=(await readFile(new URL('../static/game.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function harness(){
 const listeners=new Map(),elements=new Map(),sessions=[],saved=new Map();let disposed=0,frame;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.classList={add(){},remove(){},toggle(){}};this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  closest(){return ['INPUT','TEXTAREA','SELECT','BUTTON','A','DIALOG'].includes(this.tagName)||this.editable?this:null;}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.();}
  getBoundingClientRect(){return {width:800,height:450,left:0,top:0};}
  getContext(){return new Proxy({}, {get:(obj,key)=>obj[key]??(()=>{}),set:(obj,key,val)=>(obj[key]=val,true)});}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new Element(id==='#ocean'?'canvas':'div'));return elements.get(id);};
 const document={querySelector:element,querySelectorAll:()=>[],createElement:tag=>new Element(tag),addEventListener:(n,fn)=>listeners.set('document:'+n,fn),hidden:false};
 const game={mount(root,options){sessions.push(options);return ()=>disposed++;}};
 const context={...exploration,document,window:{addEventListener:(n,fn)=>listeners.set(n,fn)},minigames:{ctd:game,ice:game},activities:[{id:'ctd',title:'CTD cast',description:'Read water',key:'c'},{id:'ice',title:'Ice',description:'Read ice',key:'i'}],localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{frame=fn;},setInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:true,json:async()=>[]}),confirm:()=>true,console};
 vm.runInNewContext(gameSource,context);
 const key=(k,target=new Element(),extra={})=>{let prevented=false;listeners.get('keydown')({key:k,target,preventDefault(){prevented=true;},...extra});return prevented;};
 return {element,sessions,key,Element,saved,get disposed(){return disposed;},tick:t=>frame(t)};
}
test('registry buttons and keys launch anywhere; typing and dialog keys are left alone',()=>{
 const h=harness();assert.equal(h.element('#activities').children.length,2);
 assert.equal(h.key('c',new h.Element('input')),false);
 assert.equal(h.key('i',new h.Element('button')),false);
 const editable=new h.Element();editable.editable=true;assert.equal(h.key('c',editable),false);
 assert.equal(h.key('c',undefined,{ctrlKey:true}),false);assert.equal(h.sessions.length,0);
 assert.equal(h.key('C'),true);assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].expedition.x,.22);
 assert.equal(h.key('i'),false);assert.equal(h.sessions.length,1);
 h.element('#close-mission').onclick();assert.equal(h.disposed,1);
 assert.equal(h.key('i'),true);assert.equal(h.sessions.length,2);
 h.element('#close-mission').onclick();assert.equal(h.key('e'),true);assert.equal(h.sessions.length,3);
});
test('late and duplicate completions cannot score; reopening starts a fresh operation',()=>{
 const h=harness();h.element('#activities').children[0].onclick();const first=h.sessions[0];
 h.element('#close-mission').onclick();first.complete(100);assert.equal(h.element('#score').textContent,0);
 h.element('#activities').children[0].onclick();first.complete(100);assert.equal(h.element('#score').textContent,0);
 const title='<img src=x onerror=alert(1)>';h.sessions[1].complete(100,{title});h.sessions[1].complete(100);
 assert.equal(h.element('#score').textContent,100);assert.equal(h.element('#completed').textContent,1);
 assert.equal(h.element('#discovery-log').children[0].children[0].textContent,title);
 assert.equal(JSON.parse(h.saved.get(exploration.STORAGE_KEY)).discoveries.length,1);
 h.element('#mission-dialog').handlers.cancel();h.element('#mission-dialog').close();assert.equal(h.disposed,2);
 h.element('#reset').onclick();assert.equal(h.element('#score').textContent,0);assert.equal(h.element('#completed').textContent,0);
 h.sessions[1].complete(100);assert.equal(h.element('#score').textContent,0);
});
test('sailing never auto-launches operations and render loop runs with chart caches',()=>{
 const h=harness();h.element('#ocean').handlers.pointerdown({clientX:400,clientY:200});
 for(let i=0;i<300;i++)h.tick(i*16);
 assert.equal(h.sessions.length,0);assert.ok(h.element('#chart-percent').textContent!=='0%');
 h.key('c');assert.ok(h.sessions[0].expedition.x>.22);
});
