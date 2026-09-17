import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../static/exploration.js', import.meta.url), 'utf8');
const e = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('migration preserves a valid older score without inventing discoveries', () => {
  const state = e.readVoyage({getItem: key => key === 'amundsen-expedition' ? '{"score":275,"done":["01"]}' : null});
  assert.equal(state.score,275);assert.equal(state.operations,0);assert.deepEqual(state.discoveries,[]);
  assert.equal(e.readVoyage({getItem(){throw Error('blocked');}}).score,0);
  assert.equal(e.restoreVoyage(null,{score:-10}).score,0);
  assert.equal(e.restoreVoyage(null,{score:'100'}).score,0);
});
test('saved fields are validated, clamped and bounded', () => {
  const state=e.restoreVoyage({version:1,x:Infinity,y:-9,score:NaN,operations:3.9,revealed:[0,0,1,-1,2400,'2'],route:Array(2000).fill({x:4,y:-1}),discoveries:[null,{x:1,y:1,title:123,date:'bad',points:Infinity}]});
  assert.equal(state.x,.22);assert.equal(state.y,0);assert.equal(state.score,0);assert.equal(state.operations,3);
  assert.deepEqual(state.revealed,[0,1]);assert.equal(state.route.length,e.MAX_ROUTE);assert.deepEqual(state.route[0],{x:1,y:0});
  assert.equal(state.discoveries[0].title,'Observation');assert.equal(state.discoveries[0].date,'');assert.equal(state.discoveries[0].points,0);
});
test('travel reveals chart without adding discoveries; stationary tracking is stable', () => {
  const state=e.newVoyage(),known=new Set();
  assert.equal(e.chartPosition(state,known),true);
  const first=state.revealed.length;
  assert.equal(e.chartPosition(state,known),false);assert.equal(state.route.length,1);
  state.x=.8;state.y=.2;e.chartPosition(state,known);
  assert.ok(state.revealed.length>first);assert.equal(state.discoveries.length,0);assert.equal(state.score,0);
  assert.equal(known.size,state.revealed.length);
});
test('long voyages keep bounded route and coverage, including chart edges', () => {
  const state=e.newVoyage(),known=new Set();
  for(let i=0;i<10000;i++){state.x=(i%101)/100;state.y=(Math.floor(i/101)%81)/80;e.chartPosition(state,known);assert.ok(state.route.length<=e.MAX_ROUTE);}
  assert.ok(state.revealed.length<=e.COLS*e.ROWS);assert.equal(e.chartPercent(state),100);
  assert.deepEqual(state.route.at(-1),{x:state.x,y:state.y});
});
test('operations award once at launch position and accept arbitrary metadata', () => {
  const state=e.newVoyage();let updates=0;
  const record=e.operationRecorder(state,{id:'ctd',title:'CTD cast'},{x:.4,y:.6},()=>updates++);
  assert.equal(record.complete(NaN),false);assert.equal(record.complete(-1),false);
  state.x=.9;const detail={title:'<img src=x onerror=alert(1)>',layers:[2,4]};
  assert.equal(record.complete(42.8,detail),true);assert.equal(record.complete(999),false);
  assert.equal(state.score,42);assert.equal(state.operations,1);assert.equal(updates,1);
  assert.equal(state.discoveries[0].x,.4);assert.deepEqual(state.discoveries[0].detail,detail);
  assert.equal(state.discoveries[0].title,detail.title);
  const second=e.operationRecorder(state,{id:'ctd',title:'CTD cast'},state);second.complete(10);
  assert.equal(state.score,52);assert.equal(state.operations,2);
});
test('cancelled operations cannot award and excessive metadata does not break saving', () => {
  const state=e.newVoyage(),activity={id:'ctd',title:'CTD cast'};
  const cancelled=e.operationRecorder(state,activity,state);cancelled.cancel();assert.equal(cancelled.complete(100),false);
  const cyclic={};cyclic.self=cyclic;e.operationRecorder(state,activity,state).complete(10,cyclic);
  e.operationRecorder(state,activity,state).complete(10,'x'.repeat(5000));
  assert.equal(state.discoveries[0].detail,null);assert.equal(state.discoveries[1].detail,null);assert.doesNotThrow(()=>JSON.stringify(state));
});
test('repeated operations retain totals and bounded log across reload; restart is empty', () => {
  const state=e.newVoyage(50);
  for(let i=0;i<150;i++)e.operationRecorder(state,{id:'ctd',title:'Cast'},state).complete(10,{title:`Cast ${i}`});
  const restored=e.restoreVoyage(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.operations,150);assert.equal(restored.score,1550);assert.equal(restored.discoveries.length,e.MAX_LOG);assert.equal(restored.discoveries[0].title,'Cast 50');
  const fresh=e.newVoyage();assert.equal(fresh.score,0);assert.equal(fresh.operations,0);assert.deepEqual(fresh.revealed,[]);assert.deepEqual(fresh.route,[]);assert.deepEqual(fresh.discoveries,[]);
});
