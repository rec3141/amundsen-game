import { minigames, stations } from './minigames/registry.js';
const $ = s => document.querySelector(s);
const canvas = $('#ocean'), ctx = canvas.getContext('2d');
let width=900,height=480,target=null,keys=new Set(),last=0,angle=-.4,cleanup=null,page='game';
let state={x:.22,y:.7,done:[],score:0};
try { const saved=JSON.parse(localStorage.getItem('amundsen-expedition')); if(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Array.isArray(saved.done) && Number.isFinite(saved.score)) state={x:Math.max(.05,Math.min(.95,saved.x)),y:Math.max(.05,Math.min(.95,saved.y)),done:saved.done.filter(id=>stations.some(s=>s.id===id)),score:saved.score}; } catch {}
function save(){try{localStorage.setItem('amundsen-expedition',JSON.stringify(state));}catch{}}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function showPage(name){page=name;keys.clear();$('#game-page').hidden=name!=='game';$('#ideas-page').hidden=name!=='ideas';document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if(name==='ideas')loadIdeas();else resize();}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$('#suggest-shortcut').onclick=$('#crew-link').onclick=()=>showPage('ideas');
function updateUI(){
 $('#score').textContent=state.score;$('#completed').textContent=`${state.done.length} / ${stations.length}`;
 $('#missions').replaceChildren(...stations.map(s=>{const b=document.createElement('button');b.className='mission'+(state.done.includes(s.id)?' done':'');b.innerHTML=`<span class="mission-number">${state.done.includes(s.id)?'✓':s.id}</span><span><b>${s.name}</b><small>${s.science}</small></span><span class="arrow">↗</span>`;b.onclick=()=>{target={x:s.x,y:s.y,station:s};canvas.focus();toast(`Sailing to ${s.name}`);};return b;}));
}
function startMission(s){
 if(state.done.includes(s.id)){toast('Station complete. Try another station!');return;}
 target=null;keys.clear();$('#mission-title').textContent=`${s.name} / ${minigames[s.game].title}`;
 $('#mission-dialog').showModal();
 let awarded=false;
 cleanup=minigames[s.game].mount($('#minigame'),{complete(points){if(awarded)return;awarded=true;state.done.push(s.id);state.score+=points;save();updateUI();toast(state.done.length===stations.length?'Expedition complete! 300 science points collected.':`Station complete · +${points} science points`);}});
}
$('#close-mission').onclick=()=>$('#mission-dialog').close();
$('#mission-dialog').addEventListener('close',()=>{cleanup?.();cleanup=null;canvas.focus();});
$('#reset').onclick=()=>{if(confirm('Restart your expedition and clear your science points? Crew ideas will stay on the server.')){state={x:.22,y:.7,done:[],score:0};target=null;save();updateUI();}};
function resize(){const r=canvas.getBoundingClientRect();if(!r.width)return;width=r.width;height=r.height;const dpr=devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
new ResizeObserver(resize).observe(canvas);
canvas.addEventListener('pointerdown',e=>{canvas.focus();const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)/width,y=(e.clientY-r.top)/height;const s=stations.find(s=>Math.hypot((s.x-x)*width,(s.y-y)*height)<32);target={x:s?.x??x,y:s?.y??y,station:s};});
window.addEventListener('keydown',e=>{if(page!=='game'||$('#mission-dialog').open||/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName))return;const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright','e'].includes(k)){e.preventDefault();keys.add(k);target=null;if(k==='e'){const s=stations.find(s=>Math.hypot((s.x-state.x)*width,(s.y-state.y)*height)<38);if(s)startMission(s);else toast('Sail closer to a numbered station first.');}}});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();save();});
document.addEventListener('visibilitychange',()=>{keys.clear();save();});
function path(points,fill,stroke){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x*width,y*height):ctx.moveTo(x*width,y*height));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
function draw(time){
 ctx.clearRect(0,0,width,height);ctx.fillStyle='#174854';ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='#76b8bf12';ctx.lineWidth=1;
 for(let x=30;x<width;x+=65){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
 for(let y=20;y<height;y+=65){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
 ctx.strokeStyle='#74bcc51a';for(let n=0;n<4;n++){ctx.beginPath();ctx.ellipse(width*.58,height*.58,width*(.19+n*.12),height*(.2+n*.13),-.3,0,Math.PI*2);ctx.stroke();}
 path([[0,0],[.39,0],[.35,.06],[.27,.08],[.28,.14],[.23,.19],[.21,.27],[.14,.3],[.1,.4],[0,.43]],'#6c8c84','#b8c7ad88');
 path([[0,0],[.31,0],[.28,.045],[.2,.085],[.21,.15],[.15,.18],[.12,.27],[.04,.31],[0,.32]],'#a5b5a0','#cbd4b6');
 path([[.82,0],[1,0],[1,.4],[.95,.33],[.93,.23],[.88,.19],[.9,.11],[.85,.07]],'#79958b','#b8c7ad88');
 path([[.91,0],[1,0],[1,.25],[.98,.18],[.95,.16],[.94,.08]],'#b0bdaa','#cbd4b6');
 path([[.04,.66],[.1,.63],[.16,.66],[.18,.73],[.12,.77],[.05,.74]],'#8aa195','#c0cdb6');
 ctx.fillStyle='#dce8d27a';ctx.font='italic 12px Georgia';ctx.fillText('Arctic archipelago',width*.06,height*.12);
 ctx.fillStyle='#a7ced055';ctx.font='italic 23px Georgia';ctx.fillText('The research grounds',width*.36,height*.85);
 for(let i=0;i<27;i++){const x=((i*137+43)%997)/997*width,y=((i*193+17)%503)/503*height;if(x<width*.2&&y<height*.4)continue;ctx.save();ctx.translate(x,y);ctx.rotate(i);ctx.fillStyle='#c4e3df33';ctx.fillRect(0,0,7+i%4*2,3);ctx.restore();}
 ctx.setLineDash([4,7]);ctx.strokeStyle='#c5d7c54a';ctx.beginPath();ctx.moveTo(stations[0].x*width,stations[0].y*height);stations.slice(1).forEach(s=>ctx.lineTo(s.x*width,s.y*height));ctx.stroke();ctx.setLineDash([]);
 stations.forEach(s=>{const x=s.x*width,y=s.y*height,done=state.done.includes(s.id);ctx.beginPath();ctx.arc(x,y,25+Math.sin(time/900)*2,0,Math.PI*2);ctx.fillStyle=done?'#9fcdac10':'#efb56a0c';ctx.fill();ctx.strokeStyle=done?'#a3d1ab55':'#efb56a55';ctx.stroke();ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle=done?'#a8c9a6':'#edb16e';ctx.fill();ctx.fillStyle='#193e45';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(done?'✓':s.id,x,y+4);ctx.fillStyle='#dce9de';ctx.font='11px system-ui';ctx.fillText(s.name,x,y+40);ctx.textAlign='left';});
 if(target){ctx.strokeStyle='#cfdfd880';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(state.x*width,state.y*height);ctx.lineTo(target.x*width,target.y*height);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(target.x*width,target.y*height,5,0,7);ctx.stroke();}
 ctx.save();ctx.translate(state.x*width,state.y*height);ctx.rotate(angle);ctx.strokeStyle='#a8d5d05a';for(let n=0;n<3;n++){ctx.beginPath();ctx.moveTo(-22-n*8,-5-n*4);ctx.lineTo(-32-n*8,0);ctx.lineTo(-22-n*8,5+n*4);ctx.stroke();}ctx.shadowColor='#041d33aa';ctx.shadowBlur=14;ctx.beginPath();ctx.moveTo(25,0);ctx.lineTo(8,-10);ctx.lineTo(-22,-9);ctx.lineTo(-25,0);ctx.lineTo(-22,9);ctx.lineTo(8,10);ctx.closePath();ctx.fillStyle='#f1e9d9';ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#ca5342';ctx.fillRect(-20,-7,27,14);ctx.fillStyle='#f6f4e6';ctx.fillRect(-3,-6,12,12);ctx.fillStyle='#2b5660';ctx.fillRect(4,-4,3,8);ctx.fillStyle='#e7b254';ctx.fillRect(-14,-3,6,6);ctx.restore();
}
function loop(time){const dt=Math.min((time-last)/1000,.04);last=time;if(page==='game'&&!$('#mission-dialog').open){let dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));let dy=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));if(target){dx=(target.x-state.x)*width;dy=(target.y-state.y)*height;if(Math.hypot(dx,dy)<5){const s=target.station;target=null;dx=dy=0;save();if(s)startMission(s);}}
 const len=Math.hypot(dx,dy);if(len){angle=Math.atan2(dy,dx);const step=target?Math.min(110*dt,len):110*dt;state.x=Math.max(.04,Math.min(.96,state.x+dx/len*step/width));state.y=Math.max(.04,Math.min(.94,state.y+dy/len*step/height));}
 const near=stations.find(s=>Math.hypot((s.x-state.x)*width,(s.y-state.y)*height)<38);$('#navigation').textContent=near?`STATION ${near.id} / Press E to deploy`:`BRIDGE / ${len?'Underway':'Holding position'}`;draw(time);}requestAnimationFrame(loop);}
async function loadIdeas(){try{const response=await fetch('api/suggestions');if(!response.ok)throw Error();const ideas=await response.json();$('#idea-count').textContent=ideas.length;$('#board-status').textContent='Updates every 5 seconds';$('#idea-list').replaceChildren();if(!ideas.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='The next adventure starts with an idea. Be the first to share yours.';$('#idea-list').append(empty);}for(const idea of ideas){const article=document.createElement('article');article.className='idea';const title=document.createElement('h3');title.textContent=idea.title;const p=document.createElement('p');p.textContent=idea.description;const meta=document.createElement('small');meta.textContent=`${idea.name} · Idea #${idea.id}`;article.append(title,p,meta);$('#idea-list').append(article);}}catch{$('#board-status').textContent='Cannot reach the server. Retrying…';}}
$('#idea-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('#form-status').textContent='Sending…';try{const response=await fetch('api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(!response.ok)throw Error((await response.json()).error||'Could not save idea');form.reset();$('#form-status').textContent='Your idea is on the crew board. Thank you!';await loadIdeas();}catch(error){$('#form-status').textContent=error.message==='Failed to fetch'?'Connection lost. Your draft is still here; try again.':error.message;}finally{button.disabled=false;}};
setInterval(()=>{if(!document.hidden)loadIdeas();save();},5000);updateUI();loadIdeas();resize();requestAnimationFrame(loop);
