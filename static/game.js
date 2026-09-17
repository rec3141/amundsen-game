import { minigames, activities } from './minigames/registry.js';
import { STORAGE_KEY, COLS, ROWS, newVoyage, readVoyage, chartPosition, chartPercent, operationRecorder } from './exploration.js';
const $ = s => document.querySelector(s);
const canvas = $('#ocean'), ctx = canvas.getContext('2d');
const terrain = document.createElement('canvas'), fog = document.createElement('canvas');
let width=900,height=480,target=null,keys=new Set(),last=0,angle=-.4,cleanup=null,page='game';
let state;
try { state=readVoyage(localStorage); } catch { state=newVoyage(); }
let known=new Set(state.revealed), recorder=null, returnFocus=null, chartElapsed=0;
chartPosition(state,known);
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{ $('#save-status').textContent='Chart stays in this tab · storage unavailable'; }}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function showPage(name){page=name;keys.clear();target=null;$('#game-page').hidden=name!=='game';$('#ideas-page').hidden=name!=='ideas';document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if(name==='ideas')loadIdeas();else resize();}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$('#suggest-shortcut').onclick=$('#crew-link').onclick=()=>showPage('ideas');
function updateProgress(){ const percent=chartPercent(state);$('#chart-percent').textContent=`${percent}%`;$('#chart-progress').value=percent; }
function updateUI(){
 $('#score').textContent=state.score;$('#completed').textContent=state.operations;updateProgress();
 $('#discovery-log').replaceChildren();
 if(!state.discoveries.length){const p=document.createElement('li');p.className='muted';p.textContent='A blank log, an open sea. Complete an operation anywhere to leave your first mark.';$('#discovery-log').append(p);}
 for(const entry of [...state.discoveries].reverse()){
   const item=document.createElement('li'), name=document.createElement('b'), meta=document.createElement('small');
   name.textContent=entry.title;
   meta.textContent=`${entry.date ? new Date(entry.date).toLocaleDateString()+' · ' : ''}Chart ${Math.round(entry.x*100)} / ${Math.round(entry.y*100)} · +${entry.points}`;
   item.append(name,meta);$('#discovery-log').append(item);
 }
}
for(const activity of activities){
 const button=document.createElement('button'), key=document.createElement('kbd'), copy=document.createElement('span'), name=document.createElement('b'), description=document.createElement('small');
 button.className='activity';key.textContent=activity.key.toUpperCase();name.textContent=activity.title;description.textContent=activity.description;
 copy.append(name,description);button.append(key,copy);button.onclick=()=>startActivity(activity);$('#activities').append(button);
}
function endActivity(){
 recorder?.cancel();recorder=null;
 const dispose=cleanup;cleanup=null;
 try{if(typeof dispose==='function')dispose();}catch(error){console.error('Activity cleanup failed',error);}
 $('#minigame').replaceChildren();
}
function startActivity(activity){
 if($('#mission-dialog').open||page!=='game')return;
 const game=minigames[activity.id];if(!game?.mount){toast('This operation is unavailable.');return;}
 endActivity();target=null;keys.clear();returnFocus=document.activeElement;
 $('#mission-title').textContent=activity.title;
 const location={x:state.x,y:state.y};
 recorder=operationRecorder(state,activity,location,entry=>{save();updateUI();toast(`${entry.title} · +${entry.points} science points · added to chart`);});
 const session=recorder;
 $('#mission-dialog').showModal();
 try{cleanup=game.mount($('#minigame'),{complete:(points,detail)=>{if($('#mission-dialog').open)session.complete(points,detail);},expedition:{...location,score:state.score,operations:state.operations,chartPercent:chartPercent(state)}});}
 catch(error){endActivity();$('#mission-dialog').close();toast('Could not open this operation. Please try again.');console.error(error);}
}
$('#close-mission').onclick=()=>{endActivity();$('#mission-dialog').close();};
$('#mission-dialog').addEventListener('cancel',()=>endActivity());
$('#mission-dialog').addEventListener('close',()=>{if($('#mission-dialog').open)return;endActivity();if(returnFocus?.isConnected)returnFocus.focus();else canvas.focus();});
$('#reset').onclick=()=>{if(confirm('Start a fresh voyage and clear your chart, log and science points? Crew ideas stay on the server.')){endActivity();state=newVoyage();try{localStorage.removeItem('amundsen-expedition');}catch{}known=new Set();chartPosition(state,known);target=null;keys.clear();save();updateUI();buildFog();}};
function resize(){const r=canvas.getBoundingClientRect();if(!r.width)return;width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);terrain.width=canvas.width;terrain.height=canvas.height;const base=terrain.getContext('2d');base.setTransform(dpr,0,0,dpr,0,0);drawTerrain(base);buildFog();}
new ResizeObserver(resize).observe(canvas);
canvas.addEventListener('pointerdown',e=>{canvas.focus();const r=canvas.getBoundingClientRect();target={x:Math.max(0,Math.min(1,(e.clientX-r.left)/width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/height))};});
function isControl(element){return element?.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog');}
window.addEventListener('keydown',e=>{
 if(page!=='game'||$('#mission-dialog').open||isControl(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase(),activity=activities.find(a=>a.key.toLowerCase()===k)||(k==='e'?activities.find(a=>a.id==='ctd'):null);
 if(activity){e.preventDefault();if(!e.repeat)startActivity(activity);return;}
 if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright'].includes(k)){e.preventDefault();keys.add(k);target=null;}
});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();save();});
document.addEventListener('focusin',e=>{if(isControl(e.target))keys.clear();});
document.addEventListener('visibilitychange',()=>{keys.clear();last=0;save();});
window.addEventListener('pagehide',save);
function path(ctx,points,fill,stroke){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x*width,y*height):ctx.moveTo(x*width,y*height));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
function drawTerrain(ctx){
 ctx.clearRect(0,0,width,height);ctx.fillStyle='#174854';ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='#76b8bf12';ctx.lineWidth=1;
 for(let x=30;x<width;x+=65){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
 for(let y=20;y<height;y+=65){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
 ctx.strokeStyle='#74bcc51a';for(let n=0;n<4;n++){ctx.beginPath();ctx.ellipse(width*.58,height*.58,width*(.19+n*.12),height*(.2+n*.13),-.3,0,Math.PI*2);ctx.stroke();}
 path(ctx,[[0,0],[.39,0],[.35,.06],[.27,.08],[.28,.14],[.23,.19],[.21,.27],[.14,.3],[.1,.4],[0,.43]],'#6c8c84','#b8c7ad88');
 path(ctx,[[0,0],[.31,0],[.28,.045],[.2,.085],[.21,.15],[.15,.18],[.12,.27],[.04,.31],[0,.32]],'#a5b5a0','#cbd4b6');
 path(ctx,[[.82,0],[1,0],[1,.4],[.95,.33],[.93,.23],[.88,.19],[.9,.11],[.85,.07]],'#79958b','#b8c7ad88');
 path(ctx,[[.91,0],[1,0],[1,.25],[.98,.18],[.95,.16],[.94,.08]],'#b0bdaa','#cbd4b6');
 path(ctx,[[.04,.66],[.1,.63],[.16,.66],[.18,.73],[.12,.77],[.05,.74]],'#8aa195','#c0cdb6');
 ctx.fillStyle='#dce8d27a';ctx.font='italic 12px Georgia';ctx.fillText('Windward isles',width*.06,height*.12);
 ctx.fillStyle='#a7ced055';ctx.font='italic 23px Georgia';ctx.fillText('The open reach',width*.36,height*.85);
 for(let i=0;i<27;i++){const x=((i*137+43)%997)/997*width,y=((i*193+17)%503)/503*height;if(x<width*.2&&y<height*.4)continue;ctx.save();ctx.translate(x,y);ctx.rotate(i);ctx.fillStyle='#c4e3df33';ctx.fillRect(0,0,7+i%4*2,3);ctx.restore();}
}
function buildFog(){
 fog.width=COLS*8;fog.height=ROWS*8;
 const f=fog.getContext('2d');f.fillStyle='#ddcca7';f.fillRect(0,0,fog.width,fog.height);
 for(const cell of known)f.clearRect(cell%COLS*8,Math.floor(cell/COLS)*8,8,8);
}
function draw(){
 ctx.drawImage(terrain,0,0,width,height);
 ctx.drawImage(fog,0,0,width,height);
 ctx.strokeStyle='#796b4530';ctx.lineWidth=1;
 for(let x=0;x<=width;x+=width/10){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
 for(let y=0;y<=height;y+=height/8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
 ctx.fillStyle='#6a5d42';ctx.font='italic 13px Georgia';ctx.fillText('Chart of the imagined northern reaches',18,25);
 ctx.save();ctx.translate(width-32,48);ctx.strokeStyle='#6a5d42';ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(0,14);ctx.moveTo(-10,0);ctx.lineTo(10,0);ctx.stroke();ctx.font='11px Georgia';ctx.fillText('N',-4,-20);ctx.restore();
 ctx.strokeStyle='#e8c589';ctx.lineWidth=1.5;ctx.setLineDash([3,3]);ctx.beginPath();state.route.forEach((p,i)=>i?ctx.lineTo(p.x*width,p.y*height):ctx.moveTo(p.x*width,p.y*height));ctx.stroke();ctx.setLineDash([]);
 for(const d of state.discoveries){const x=d.x*width,y=d.y*height;ctx.fillStyle='#f0ba70';ctx.strokeStyle='#523d25';ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+5,y);ctx.lineTo(x,y+6);ctx.lineTo(x-5,y);ctx.closePath();ctx.fill();ctx.stroke();}
 if(target){ctx.strokeStyle='#cfdfd880';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(state.x*width,state.y*height);ctx.lineTo(target.x*width,target.y*height);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(target.x*width,target.y*height,5,0,7);ctx.stroke();}
 ctx.save();ctx.translate(state.x*width,state.y*height);ctx.rotate(angle);ctx.strokeStyle='#a8d5d05a';for(let n=0;n<3;n++){ctx.beginPath();ctx.moveTo(-22-n*8,-5-n*4);ctx.lineTo(-32-n*8,0);ctx.lineTo(-22-n*8,5+n*4);ctx.stroke();}ctx.shadowColor='#041d33aa';ctx.shadowBlur=14;ctx.beginPath();ctx.moveTo(25,0);ctx.lineTo(8,-10);ctx.lineTo(-22,-9);ctx.lineTo(-25,0);ctx.lineTo(-22,9);ctx.lineTo(8,10);ctx.closePath();ctx.fillStyle='#f1e9d9';ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#ca5342';ctx.fillRect(-20,-7,27,14);ctx.fillStyle='#f6f4e6';ctx.fillRect(-3,-6,12,12);ctx.fillStyle='#2b5660';ctx.fillRect(4,-4,3,8);ctx.fillStyle='#e7b254';ctx.fillRect(-14,-3,6,6);ctx.restore();
}
function loop(time){
 const dt=last?Math.min((time-last)/1000,.04):0;last=time;
 if(page==='game'&&!document.hidden&&!$('#mission-dialog').open){
 let dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
 let dy=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));
 if(target){dx=(target.x-state.x)*width;dy=(target.y-state.y)*height;if(Math.hypot(dx,dy)<2){target=null;dx=dy=0;save();}}
 const len=Math.hypot(dx,dy);
 if(len){angle=Math.atan2(dy,dx);const step=target?Math.min(110*dt,len):110*dt;state.x=Math.max(0,Math.min(1,state.x+dx/len*step/width));state.y=Math.max(0,Math.min(1,state.y+dy/len*step/height));}
 chartElapsed+=dt;
 if(chartElapsed>=.15){chartElapsed=0;if(chartPosition(state,known)){buildFog();updateProgress();}const navigation=`BRIDGE / ${len?'Underway':'Holding position'} · Operations available anywhere`;if($('#navigation').textContent!==navigation)$('#navigation').textContent=navigation;}
 draw();
 }requestAnimationFrame(loop);
}
async function loadIdeas(){try{const response=await fetch('api/suggestions');if(!response.ok)throw Error();const ideas=await response.json();$('#idea-count').textContent=ideas.length;$('#board-status').textContent='Updates every 5 seconds';$('#idea-list').replaceChildren();if(!ideas.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='The next adventure starts with an idea. Be the first to share yours.';$('#idea-list').append(empty);}for(const idea of ideas){const article=document.createElement('article');article.className='idea';const title=document.createElement('h3');title.textContent=idea.title;const p=document.createElement('p');p.textContent=idea.description;const meta=document.createElement('small');meta.textContent=`${idea.name} · Idea #${idea.id}`;article.append(title,p,meta);$('#idea-list').append(article);}}catch{$('#board-status').textContent='Cannot reach the server. Retrying…';}}
$('#idea-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('#form-status').textContent='Sending…';try{const response=await fetch('api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(!response.ok)throw Error((await response.json()).error||'Could not save idea');form.reset();$('#form-status').textContent='Your idea is on the crew board. Thank you!';await loadIdeas();}catch(error){$('#form-status').textContent=error.message==='Failed to fetch'?'Connection lost. Your draft is still here; try again.':error.message;}finally{button.disabled=false;}};
setInterval(()=>{if(!document.hidden)loadIdeas();save();},5000);updateUI();loadIdeas();resize();requestAnimationFrame(loop);
