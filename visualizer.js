// ─────────────────────────────────────────────────────────────────────────────
// LILA BLACK — Player Journey Visualizer
// visualizer.js — Application logic (rendering, interaction, analytics)
//
// NOTE: This file is for code review purposes.
// In deployment, this logic is inlined into index.html alongside the
// pre-processed game data (796 matches, ~3MB JSON + base64 minimap images).
//
// Data pipeline:
//   Raw .parquet files → Python preprocessing → JSON embedded in index.html
//   Coordinate system: game X→East-West, game Z→North-South (JSON y),
//                      game Y→Elevation (JSON z), Y-axis inverted for canvas
//
// Structure:
//   1.  isValidCoord()        — sentinel + outlier filtering
//   2.  State (S)             — single source of truth for UI state
//   3.  computeMatchStats()   — per-match analytics (kills, zones, streaks)
//   4.  init() + filters      — setup, match list, filter logic
//   5.  w2c() / c2w()         — world↔canvas coordinate transforms
//   6.  renderAll()           — two-canvas render pipeline (bg + main)
//   7.  drawEvents()          — scatter markers per event type
//   8.  drawPaths()           — per-player movement trails with direction arrows
//   9.  drawHeat()            — gaussian kernel density heatmap
//   10. drawReplayHeads()     — live player positions + kill-streak halos
//   11. drawZoneOverlay()     — 3x3 zone kill-density grid
//   12. updateStatsPanel()    — analytics panel HTML generation
//   13. Playback              — frame-step replay with speed control
//   14. onMouseMove()         — hover tooltip + world coordinate display
// ─────────────────────────────────────────────────────────────────────────────

const MATCHES=D.matches, BOUNDS=D.map_bounds, MAPS=D.minimaps;

// ── SENTINEL / OUTLIER FILTERING ─────────────────────────────────────────
// QA FIX: added null check for x (21 events have x=null in source data)
// x≈8.82 is Nakama default spawn coordinate (null position indicator)
// |x| or |y| > 500 are corrupt/out-of-map values
function isValidCoord(e){
  if(e.x==null||e.y==null)return false;
  if(Math.abs(e.x-8.82)<0.1&&Math.abs(e.y)<5)return false;
  if(Math.abs(e.x)>500||Math.abs(e.y)>500)return false;
  return true;
}

// Preload minimap images
const IMG={};
for(const [k,v] of Object.entries(MAPS)){const i=new Image();i.src=v.data;IMG[k]=i;}

// ── STATE ────────────────────────────────────────────────────────────────
const S={
  match:null, mapFilter:'all', dateFilter:'all', playerFilter:'all',
  viz:'scatter', heatType:'traffic',
  layers:{position:true,kills:true,loot:true,paths:false,heatmap:false,bots:true},
  zoom:1, pan:{x:0,y:0}, drag:null,
  play:{on:false,speed:1,timer:null},
  showStats:false
};

// ── PLAYER COLORS ─────────────────────────────────────────────────────────
const PLAYER_COLORS=['#4fc3f7','#f06292','#69f0ae','#ffd54f','#ce93d8','#ff8a65','#80cbc4','#ef9a9a'];
const playerColorMap={};
let colorIdx=0;
function playerColor(uid){
  if(!playerColorMap[uid])playerColorMap[uid]=PLAYER_COLORS[colorIdx++%PLAYER_COLORS.length];
  return playerColorMap[uid];
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────
function computeMatchStats(matchId){
  const m=MATCHES[matchId];
  const evts=m.events.filter(isValidCoord);
  const humans=new Set(evts.filter(e=>!e.is_bot).map(e=>e.user_id));
  const bots=new Set(evts.filter(e=>e.is_bot).map(e=>e.user_id));
  // In this dataset: Kill = human kills human, BotKill = human kills bot
  const kills=evts.filter(e=>e.event==='Kill').length;
  const botKills=evts.filter(e=>e.event==='BotKill').length;
  const loots=evts.filter(e=>e.event==='Loot').length;
  const killsByPlayer={};
  evts.filter(e=>e.event==='Kill'||e.event==='BotKill').forEach(e=>{
    killsByPlayer[e.user_id]=(killsByPlayer[e.user_id]||0)+1;
  });
  const streakers=Object.entries(killsByPlayer).filter(([,c])=>c>=3).sort((a,b)=>b[1]-a[1]);
  const b=BOUNDS[m.map_id];
  const zoneKills=Array(9).fill(0);
  const zoneLoot=Array(9).fill(0);
  if(b){
    const zw=(b.maxx-b.minx)/3,zh=(b.maxy-b.miny)/3;
    evts.forEach(e=>{
      const col=Math.min(2,Math.max(0,Math.floor((e.x-b.minx)/zw)));
      const row=Math.min(2,Math.max(0,Math.floor((e.y-b.miny)/zh)));
      const zi=row*3+col;
      if(e.event==='Kill'||e.event==='BotKill')zoneKills[zi]++;
      if(e.event==='Loot')zoneLoot[zi]++;
    });
  }
  const ts=evts.map(e=>e.ts).filter(Boolean);
  const dur=ts.length>1?Math.round((Math.max(...ts)-Math.min(...ts))/60):0;
  return{humans:humans.size,bots:bots.size,players:humans.size+bots.size,
    kills,botKills,totalKills:kills+botKills,loots,
    totalEvents:evts.length,killsByPlayer,streakers,
    zoneKills,zoneLoot,duration:dur,map:m.map_id,date:m.date};
}

// ── INIT ──────────────────────────────────────────────────────────────────
function init(){
  buildMatchList();
  const w=document.getElementById('map-wrap');
  w.addEventListener('mousemove',onMouseMove);
  w.addEventListener('wheel',onWheel,{passive:false});
  w.addEventListener('mousedown',e=>{S.drag={sx:e.clientX-S.pan.x,sy:e.clientY-S.pan.y};});
  window.addEventListener('mouseup',()=>S.drag=null);
  w.addEventListener('mousemove',e=>{
    if(S.drag){S.pan.x=e.clientX-S.drag.sx;S.pan.y=e.clientY-S.drag.sy;renderAll();}
  });
  w.addEventListener('dblclick',resetView);
  resize();
  window.addEventListener('resize',()=>{resize();renderAll();});
}

function applyFilters(){
  S.mapFilter=document.getElementById('f-map').value;
  S.dateFilter=document.getElementById('f-date').value;
  if(S.match){
    const m=MATCHES[S.match];
    if((S.mapFilter!=='all'&&m.map_id!==S.mapFilter)||(S.dateFilter!=='all'&&m.date!==S.dateFilter)){
      S.match=null;stop();renderAll();
      document.getElementById('map-title').textContent='Select a Match';
      document.getElementById('map-meta').textContent='';
      document.getElementById('empty-msg').style.display='';
      document.getElementById('legend').style.display='none';
      document.getElementById('stats-panel').style.display='none';
      document.getElementById('tl-info').textContent='Select a match and press ▶ to replay events';
    }
  }
  buildMatchList();
}

function buildMatchList(){
  const el=document.getElementById('match-list');
  el.innerHTML='';let n=0;
  // Sort by event count descending so richest matches appear first
  const sorted=Object.entries(MATCHES).sort((a,b)=>b[1].events.length-a[1].events.length);
  sorted.forEach(([id,m])=>{
    if(S.mapFilter!=='all'&&m.map_id!==S.mapFilter)return;
    if(S.dateFilter!=='all'&&m.date!==S.dateFilter)return;
    const evts=m.events.filter(isValidCoord);
    const humans=new Set(evts.filter(e=>!e.is_bot).map(e=>e.user_id)).size;
    const kills=evts.filter(e=>e.event==='Kill'||e.event==='BotKill').length;
    const div=document.createElement('div');
    div.className='mi'+(S.match===id?' sel':'');
    div.onclick=()=>selectMatch(id);
    const mapColor={'AmbroseValley':'#ffd54f','GrandRift':'#69f0ae','Lockdown':'#ce93d8'}[m.map_id]||'#4fc3f7';
    const mapShort={'AmbroseValley':'Ambrose','GrandRift':'Grand Rift','Lockdown':'Lockdown'}[m.map_id]||m.map_id;
    div.innerHTML=`<div class="mi-id">${id.slice(0,8)}…  <span style="color:var(--dim)">${evts.length} events</span></div>
      <div class="mi-info">
        <span style="color:${mapColor};font-weight:600;font-size:11px">${mapShort}</span>
        <span class="mi-date">${m.date.replace('February_','Feb ')}</span>
        <span class="mi-stats">👤${humans} ${kills?`<span class="mi-badge">⚔${kills}</span>`:''}
        </span>
      </div>`;
    el.appendChild(div);n++;
  });
  if(n===0){
    el.innerHTML='<div class="match-placeholder">No matches match<br>the current filters</div>';
  }
  document.getElementById('match-cnt').textContent=`${n}`;
}

function selectMatch(id){
  S.match=id;stop();S.zoom=1;S.pan={x:0,y:0};
  Object.keys(playerColorMap).forEach(k=>delete playerColorMap[k]);colorIdx=0;
  buildMatchList();
  const m=MATCHES[id];
  const mapName={'AmbroseValley':'Ambrose Valley','GrandRift':'Grand Rift','Lockdown':'Lockdown'}[m.map_id]||m.map_id;
  document.getElementById('map-title').textContent=mapName;
  document.getElementById('map-meta').textContent=`— ${m.date.replace('February_','Feb ')}`;
  document.getElementById('empty-msg').style.display='none';
  document.getElementById('legend').style.display='block';
  const validEvts=m.events.filter(isValidCoord);
  const sl=document.getElementById('tl-slider');
  sl.max=validEvts.length-1;sl.value=0;
  updateTime(0,validEvts.length);
  updateCounts();
  updateStatsPanel(id);
  renderAll();
}

function updateCounts(){
  if(!S.match)return;
  const evts=getEvents();
  document.getElementById('cnt-pos').textContent=evts.filter(e=>e.event==='Position'||e.event==='BotPosition').length;
  document.getElementById('cnt-kill').textContent=evts.filter(e=>e.event==='Kill'||e.event==='BotKill').length;
  document.getElementById('cnt-loot').textContent=evts.filter(e=>e.event==='Loot').length;
  // Update layer active states
  ['position','kills','loot','paths','heatmap','bots'].forEach(l=>{
    const lt=document.getElementById('lt-'+l);
    if(lt)lt.classList.toggle('active',S.layers[l]);
  });
}

function setPlayerFilter(f){
  S.playerFilter=f;
  ['all','human','bot'].forEach(t=>document.getElementById('fp-'+t).classList.toggle('on',t===f));
  updateCounts();renderAll();
}

function toggleLayer(l){
  S.layers[l]=!S.layers[l];
  document.getElementById('sw-'+l).classList.toggle('on',S.layers[l]);
  const lt=document.getElementById('lt-'+l);
  if(lt)lt.classList.toggle('active',S.layers[l]);
  document.getElementById('heat-ctrl').style.display=S.layers.heatmap?'flex':'none';
  renderAll();
}

function setViz(v){
  S.viz=v;
  ['scatter','heatmap','paths','replay'].forEach(x=>document.getElementById('vb-'+x).classList.toggle('on',x===v));
  if(v==='paths'){S.layers.paths=true;document.getElementById('sw-paths').classList.add('on');document.getElementById('lt-paths').classList.add('active');}
  if(v==='heatmap'){S.layers.heatmap=true;document.getElementById('sw-heatmap').classList.add('on');document.getElementById('lt-heatmap').classList.add('active');document.getElementById('heat-ctrl').style.display='flex';}
  if(v==='replay'&&S.match){
    const sl=document.getElementById('tl-slider');sl.value=0;
    const validEvts=MATCHES[S.match].events.filter(isValidCoord);
    updateTime(0,validEvts.length);
  }
  renderAll();
}

function setHeatType(t){
  S.heatType=t;
  // Only show traffic, kills, loot (no deaths/storm — not in this dataset)
  ['traffic','kills','loot'].forEach(x=>document.getElementById('ht-'+x).classList.toggle('on',x===t));
  renderAll();
}

function setSpd(btn,s){
  S.play.speed=s;
  document.querySelectorAll('.spd-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function adjustZoom(factor){
  S.zoom=Math.max(0.25,Math.min(12,S.zoom*factor));
  renderAll();
}

function resetView(){S.zoom=1;S.pan={x:0,y:0};renderAll();}

function toggleStats(){
  S.showStats=!S.showStats;
  document.getElementById('btn-stats').classList.toggle('active',S.showStats);
  const panel=document.getElementById('stats-panel');
  panel.style.display=S.showStats&&S.match?'block':'none';
  renderAll(); // redraw to show/hide zone grid
}

function getEvents(frame){
  if(!S.match)return[];
  let e=MATCHES[S.match].events.filter(isValidCoord);
  if(S.playerFilter==='human')e=e.filter(x=>!x.is_bot);
  if(S.playerFilter==='bot')e=e.filter(x=>x.is_bot);
  if(!S.layers.bots)e=e.filter(x=>!x.is_bot);
  if(frame!==undefined)e=e.slice(0,frame+1);
  return e;
}

// ── CANVAS ────────────────────────────────────────────────────────────────
function resize(){
  const c=document.getElementById('map-wrap');
  const w=c.clientWidth,h=c.clientHeight;
  ['bg-cvs','main-cvs'].forEach(id=>{const cv=document.getElementById(id);cv.width=w;cv.height=h;});
}

function sz(){const c=document.getElementById('bg-cvs');return{w:c.width,h:c.height};}

function w2c(x,y,mapId,W,H){
  const b=BOUNDS[mapId];if(!b)return{cx:W/2,cy:H/2,sc:1};
  const pad=48,ww=b.maxx-b.minx||1,wh=b.maxy-b.miny||1;
  const sc=Math.min((W-pad*2)/ww,(H-pad*2)/wh)*S.zoom;
  const cx=W/2+S.pan.x+(x-(b.minx+ww/2))*sc;
  const cy=H/2+S.pan.y-(y-(b.miny+wh/2))*sc;
  return{cx,cy,sc};
}

// Inverse: canvas coords to world coords (for hover display)
function c2w(cx,cy,mapId,W,H){
  const b=BOUNDS[mapId];if(!b)return{x:0,y:0};
  const pad=48,ww=b.maxx-b.minx||1,wh=b.maxy-b.miny||1;
  const sc=Math.min((W-pad*2)/ww,(H-pad*2)/wh)*S.zoom;
  const x=(cx-W/2-S.pan.x)/sc+(b.minx+ww/2);
  const y=-(cy-H/2-S.pan.y)/sc+(b.miny+wh/2);
  return{x,y};
}

function renderAll(){drawBg();drawMain();}

function drawBg(){
  const cv=document.getElementById('bg-cvs'),ctx=cv.getContext('2d');
  const{w,h}=sz();
  ctx.fillStyle='#07090e';ctx.fillRect(0,0,w,h);
  if(!S.match)return;
  const m=MATCHES[S.match];
  const mi=IMG[m.map_id];
  const b=BOUNDS[m.map_id];
  if(mi&&mi.complete&&b){
    const{cx:x1,cy:y2}=w2c(b.minx,b.miny,m.map_id,w,h);
    const{cx:x2,cy:y1}=w2c(b.maxx,b.maxy,m.map_id,w,h);
    const mx=Math.min(x1,x2),my=Math.min(y1,y2),mw=Math.abs(x2-x1),mh=Math.abs(y2-y1);
    // Shadow under map
    ctx.save();
    ctx.shadowColor='rgba(79,195,247,.2)';ctx.shadowBlur=20;
    ctx.fillStyle='#000';ctx.fillRect(mx,my,mw,mh);
    ctx.restore();
    // Map image
    ctx.save();ctx.globalAlpha=0.65;
    ctx.drawImage(mi,mx,my,mw,mh);
    ctx.restore();
    // Map border
    ctx.strokeStyle='rgba(79,195,247,.25)';ctx.lineWidth=1;
    ctx.strokeRect(mx,my,mw,mh);
    // Zone grid (when stats open)
    if(S.showStats){
      ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;ctx.setLineDash([3,5]);
      for(let i=1;i<3;i++){
        ctx.beginPath();ctx.moveTo(mx+mw*i/3,my);ctx.lineTo(mx+mw*i/3,my+mh);ctx.stroke();
        ctx.beginPath();ctx.moveTo(mx,my+mh*i/3);ctx.lineTo(mx+mw,my+mh*i/3);ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  } else {
    // Fallback grid
    ctx.strokeStyle='rgba(30,42,58,.8)';ctx.lineWidth=1;
    const gs=50*S.zoom;
    const ox=(S.pan.x%gs+gs)%gs,oy=(S.pan.y%gs+gs)%gs;
    for(let x=ox-gs;x<w+gs;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=oy-gs;y<h+gs;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  }
}

function drawMain(){
  const cv=document.getElementById('main-cvs'),ctx=cv.getContext('2d');
  const{w,h}=sz();ctx.clearRect(0,0,w,h);
  if(!S.match)return;
  const m=MATCHES[S.match];
  const isReplay=S.viz==='replay';
  const validEvts=m.events.filter(isValidCoord);
  const frame=isReplay?parseInt(document.getElementById('tl-slider').value):validEvts.length-1;
  const evts=getEvents(frame);

  if(S.layers.heatmap||S.viz==='heatmap')drawHeat(ctx,evts,m.map_id,w,h);
  if(S.layers.paths||S.viz==='paths')drawPaths(ctx,evts,m.map_id,w,h,isReplay);
  if(S.viz!=='heatmap')drawEvents(ctx,evts,m.map_id,w,h);
  if(isReplay)drawReplayHeads(ctx,evts,m.map_id,w,h,frame);
  if(S.showStats)drawZoneOverlay(ctx,m.map_id,w,h);

  // Update timeline info bar
  const e=evts[Math.min(frame,evts.length-1)];
  if(e&&isReplay){
    const ts=e.ts?new Date(e.ts*1000).toISOString().substr(11,8):'--:--:--';
    const evtLabel={'Position':'Move','BotPosition':'Bot Move','Kill':'⚔ Kill','BotKill':'⚔ Bot Kill','Loot':'💎 Loot'}[e.event]||e.event;
    document.getElementById('tl-info').textContent=
      `${evtLabel}  |  ${e.is_bot?'🤖 Bot':'👤 Human'}  |  X: ${e.x.toFixed(1)}  Y: ${e.y.toFixed(1)}  Z: ${e.z.toFixed(1)}  |  ${ts}  |  Event ${frame+1}/${validEvts.length}`;
  } else if(!isReplay){
    document.getElementById('tl-info').textContent=`Showing all ${evts.length} events  —  scroll to zoom, drag to pan, double-click to reset`;
  }
}

function eColor(ev){
  if(ev==='Position')return'#4fc3f7';
  if(ev==='BotPosition')return'#ba68c8';
  if(ev==='Kill')return'#f06292';
  if(ev==='BotKill')return'#ff8a65';
  if(ev==='Loot')return'#69f0ae';
  return'#ffffff';
}

function drawEvents(ctx,evts,mapId,w,h){
  evts.forEach(e=>{
    const isKill=e.event==='Kill'||e.event==='BotKill';
    const isLoot=e.event==='Loot';
    const isPos=e.event==='Position'||e.event==='BotPosition';
    if(isKill&&!S.layers.kills)return;
    if(isLoot&&!S.layers.loot)return;
    if(isPos&&!S.layers.position)return;
    const{cx,cy}=w2c(e.x,e.y,mapId,w,h);
    const col=eColor(e.event);
    ctx.save();ctx.shadowColor=col;
    if(isKill){
      const isBotKill=e.event==='BotKill';
      ctx.strokeStyle=col;ctx.lineWidth=isBotKill?1.5:2;ctx.globalAlpha=isBotKill?.6:.9;ctx.shadowBlur=isBotKill?4:10;
      const s=isBotKill?4:6;
      ctx.beginPath();ctx.moveTo(cx-s,cy-s);ctx.lineTo(cx+s,cy+s);ctx.moveTo(cx+s,cy-s);ctx.lineTo(cx-s,cy+s);ctx.stroke();
    } else if(isLoot){
      ctx.fillStyle=col;ctx.globalAlpha=.85;ctx.shadowBlur=6;
      const s=5;ctx.beginPath();ctx.moveTo(cx,cy-s);ctx.lineTo(cx+s,cy);ctx.lineTo(cx,cy+s);ctx.lineTo(cx-s,cy);ctx.closePath();ctx.fill();
    } else {
      const isBot=e.event==='BotPosition';
      ctx.fillStyle=col;ctx.globalAlpha=isBot?.3:.65;ctx.shadowBlur=isBot?1:4;
      ctx.beginPath();ctx.arc(cx,cy,isBot?2:3.5,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  });
}

function drawPaths(ctx,evts,mapId,w,h,isReplay){
  const posEvts=evts.filter(e=>e.event==='Position'||e.event==='BotPosition');
  const byUser={};
  posEvts.forEach(e=>{if(!byUser[e.user_id])byUser[e.user_id]=[];byUser[e.user_id].push(e);});
  Object.entries(byUser).forEach(([uid,es])=>{
    if(es.length<2)return;
    const isBot=es[0]?.is_bot;
    const baseR=isBot?'186,104,200':'79,195,247';
    ctx.lineWidth=isBot?1:1.5;
    ctx.setLineDash(isBot?[3,5]:[]);
    ctx.shadowColor=isBot?'#ba68c8':'#4fc3f7';ctx.shadowBlur=isBot?1:3;
    for(let i=1;i<es.length;i++){
      const alpha=isReplay?(0.1+(i/es.length)*0.6):(isBot?0.25:0.45);
      ctx.strokeStyle=`rgba(${baseR},${alpha})`;
      const{cx:ax,cy:ay}=w2c(es[i-1].x,es[i-1].y,mapId,w,h);
      const{cx:bx,cy:by}=w2c(es[i].x,es[i].y,mapId,w,h);
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
      // Direction arrow every 6 segments for humans
      if(!isBot&&i%6===0){
        const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
        if(len>12){
          const nx=dx/len,ny=dy/len,mx=(ax+bx)/2,my=(ay+by)/2,as=5;
          ctx.fillStyle=`rgba(${baseR},${Math.min(1,alpha+0.15)})`;
          ctx.beginPath();
          ctx.moveTo(mx+nx*as,my+ny*as);
          ctx.lineTo(mx-ny*as*.5-nx*as*.6,my+nx*as*.5-ny*as*.6);
          ctx.lineTo(mx+ny*as*.5-nx*as*.6,my-nx*as*.5-ny*as*.6);
          ctx.closePath();ctx.fill();
        }
      }
    }
    ctx.setLineDash([]);ctx.shadowBlur=0;
  });
}

function drawHeat(ctx,evts,mapId,w,h){
  const intensity=parseInt(document.getElementById('heat-int').value)/5;
  const type=S.heatType;
  const hevts=evts.filter(e=>{
    if(type==='kills')return e.event==='Kill'||e.event==='BotKill';
    if(type==='loot')return e.event==='Loot';
    return true; // traffic = all
  });
  const palettes={kills:'240,98,146',loot:'105,240,174',traffic:'79,195,247'};
  const col=palettes[type]||palettes.traffic;
  hevts.forEach(e=>{
    const{cx,cy}=w2c(e.x,e.y,mapId,w,h);
    const r=Math.max(18,28*S.zoom)*intensity;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,`rgba(${col},${0.1*intensity})`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  });
}

function drawReplayHeads(ctx,evts,mapId,w,h,frame){
  if(!evts.length)return;
  const lastPos={};
  evts.forEach(e=>{
    if(e.event==='Position'||e.event==='BotPosition'){
      lastPos[e.user_id]={x:e.x,y:e.y,isBot:e.is_bot,uid:e.user_id};
    }
  });
  const stats=computeMatchStats(S.match);
  const streakSet=new Set(stats.streakers.map(([uid])=>uid));
  Object.values(lastPos).forEach(p=>{
    const{cx,cy}=w2c(p.x,p.y,mapId,w,h);
    const col=p.isBot?'#ba68c8':playerColor(p.uid);
    ctx.save();
    if(!p.isBot&&streakSet.has(p.uid)){
      ctx.strokeStyle='#ffd54f';ctx.lineWidth=1.5;ctx.globalAlpha=.6;
      ctx.shadowColor='#ffd54f';ctx.shadowBlur=14;
      ctx.beginPath();ctx.arc(cx,cy,13,0,Math.PI*2);ctx.stroke();
    }
    ctx.shadowColor=col;ctx.shadowBlur=10;
    ctx.strokeStyle=col;ctx.fillStyle=col+'33';ctx.lineWidth=2;ctx.globalAlpha=.95;
    ctx.beginPath();ctx.arc(cx,cy,p.isBot?5:8,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.restore();
  });
  // Pulse ring on current event position
  const cur=evts[Math.min(frame,evts.length-1)];
  if(cur){
    const{cx,cy}=w2c(cur.x,cur.y,mapId,w,h);
    const col=eColor(cur.event);
    ctx.save();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.shadowColor=col;ctx.shadowBlur=16;ctx.globalAlpha=.8;
    ctx.beginPath();ctx.arc(cx,cy,12,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
}

function drawZoneOverlay(ctx,mapId,w,h){
  if(!S.match)return;
  const stats=computeMatchStats(S.match);
  const b=BOUNDS[mapId];if(!b)return;
  const maxK=Math.max(1,...stats.zoneKills);
  for(let row=0;row<3;row++){
    for(let col=0;col<3;col++){
      const zi=row*3+col;
      const wx=b.minx+(b.maxx-b.minx)*(col+.5)/3;
      const wy=b.miny+(b.maxy-b.miny)*(row+.5)/3;
      const{cx,cy}=w2c(wx,wy,mapId,w,h);
      const k=stats.zoneKills[zi];
      if(k>0){
        ctx.fillStyle=`rgba(240,98,146,${.1+(k/maxK)*.3})`;
        ctx.fillRect(cx-26,cy-16,52,32);
        ctx.fillStyle='rgba(240,98,146,.85)';
        ctx.font='bold 11px JetBrains Mono, monospace';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(`⚔ ${k}`,cx,cy);
      }
    }
  }
}

// ── STATS PANEL ───────────────────────────────────────────────────────────
function updateStatsPanel(matchId){
  const panel=document.getElementById('stats-panel');
  if(!matchId){panel.style.display='none';return;}
  const st=computeMatchStats(matchId);
  panel.innerHTML=`
    <div class="sp-title">Match Analytics</div>
    <div class="sp-grid">
      <div class="sp-stat"><span class="sp-v">${st.players}</span><span class="sp-l">Players</span></div>
      <div class="sp-stat"><span class="sp-v">${st.totalKills}</span><span class="sp-l">Kills</span></div>
      <div class="sp-stat"><span class="sp-v">${st.loots}</span><span class="sp-l">Loot</span></div>
      <div class="sp-stat"><span class="sp-v">${st.humans}</span><span class="sp-l">Human</span></div>
      <div class="sp-stat"><span class="sp-v">${st.bots}</span><span class="sp-l">Bots</span></div>
      <div class="sp-stat"><span class="sp-v">${st.duration}m</span><span class="sp-l">Duration</span></div>
    </div>
    ${st.streakers.length?`<div class="sp-sub">Kill Leaders</div>
    ${st.streakers.slice(0,3).map(([uid,k])=>`
      <div class="sp-row">
        <span class="sp-uid">${uid.length>10?uid.slice(0,12)+'…':uid}</span>
        <span class="sp-kills">${k}⚔</span>
      </div>`).join('')}`:''}
    <div class="sp-sub">Kill Zones (3×3 Grid)</div>
    <div>${renderZoneGrid(st)}</div>
    <button class="sp-close" onclick="toggleStats()">✕ Close Panel</button>`;
  if(S.showStats)panel.style.display='block';
}

function renderZoneGrid(st){
  const maxK=Math.max(1,...st.zoneKills);
  let html='<table class="zt">';
  // Render top row first (high Y = north = top of map)
  for(let r=2;r>=0;r--){
    html+='<tr>';
    for(let c=0;c<3;c++){
      const zi=r*3+c;
      const k=st.zoneKills[zi];
      const a=k>0?Math.round(20+(k/maxK)*60):0;
      html+=`<td style="background:rgba(240,98,146,${a/100})">${k>0?`<b>${k}</b>`:''}</td>`;
    }
    html+='</tr>';
  }
  return html+'</table>';
}

// ── PLAYBACK ──────────────────────────────────────────────────────────────
function togglePlay(){S.play.on?stop():startPlay();}

function stop(){
  S.play.on=false;
  document.getElementById('play-btn').innerHTML='▶';
  clearTimeout(S.play.timer);
}

function startPlay(){
  if(!S.match)return;
  // Auto-switch to replay mode
  if(S.viz!=='replay')setViz('replay');
  S.play.on=true;
  document.getElementById('play-btn').innerHTML='⏸';
  const total=MATCHES[S.match].events.filter(isValidCoord).length;
  function tick(){
    if(!S.play.on)return;
    const sl=document.getElementById('tl-slider');
    let f=parseInt(sl.value)+Math.max(1,Math.round(S.play.speed));
    if(f>=total){f=total-1;stop();}
    sl.value=f;updateTime(f,total);renderAll();
    if(S.play.on)S.play.timer=setTimeout(tick,Math.round(180/S.play.speed));
  }
  tick();
}

function onSlide(){
  stop();
  if(S.match){
    if(S.viz!=='replay')setViz('replay');
    const total=MATCHES[S.match].events.filter(isValidCoord).length;
    updateTime(parseInt(document.getElementById('tl-slider').value),total);
  }
  renderAll();
}

function updateTime(f,total){
  document.getElementById('tl-time').textContent=`${f+1} / ${total}`;
}

// ── MOUSE ────────────────────────────────────────────────────────────────
function onMouseMove(evt){
  const tt=document.getElementById('tooltip');
  const cb=document.getElementById('coords-bar');
  if(S.drag||!S.match){tt.style.display='none';return;}
  const rect=evt.currentTarget.getBoundingClientRect();
  const mx=evt.clientX-rect.left,my=evt.clientY-rect.top;
  const m=MATCHES[S.match];const{w,h}=sz();

  // Show world coords in bottom bar
  const wc=c2w(mx,my,m.map_id,w,h);
  cb.style.display='block';
  cb.textContent=`X: ${wc.x.toFixed(1)}  Y: ${wc.y.toFixed(1)}`;

  // Tooltip: respect current frame in replay mode
  const isReplay=S.viz==='replay';
  const frame=isReplay?parseInt(document.getElementById('tl-slider').value):undefined;
  const evts=getEvents(frame);
  let closest=null,minD=22;
  evts.forEach(e=>{
    const{cx,cy}=w2c(e.x,e.y,m.map_id,w,h);
    const d=Math.hypot(cx-mx,cy-my);
    if(d<minD){minD=d;closest=e;}
  });
  if(closest){
    const ts=closest.ts?new Date(closest.ts*1000).toISOString().substr(11,8):'–';
    const stats=computeMatchStats(S.match);
    const killCount=(stats.killsByPlayer[closest.user_id]||0);
    const evtLabel={'Position':'Movement','BotPosition':'Bot Movement','Kill':'⚔ Human Kill','BotKill':'⚔ Bot Kill','Loot':'💎 Loot Pickup'}[closest.event]||closest.event;
    const streakBadge=killCount>=3?` 🔥 ${killCount} kills`:'';
    document.getElementById('tt-t').innerHTML=`<span style="color:${eColor(closest.event)}">${evtLabel}</span>${streakBadge}`;
    document.getElementById('tt-b').innerHTML=`
      <div class="tip-r"><span class="tip-k">Player</span><span class="tip-v">${closest.is_bot?'🤖 Bot':'👤 Human'}</span></div>
      <div class="tip-r"><span class="tip-k">ID</span><span class="tip-v">${closest.user_id.toString().slice(0,14)}…</span></div>
      <div class="tip-r"><span class="tip-k">X / Y</span><span class="tip-v">${closest.x.toFixed(2)}, ${closest.y.toFixed(2)}</span></div>
      <div class="tip-r"><span class="tip-k">Elevation</span><span class="tip-v">${closest.z.toFixed(1)}</span></div>
      <div class="tip-r"><span class="tip-k">Time</span><span class="tip-v">${ts}</span></div>`;
    tt.style.display='block';
    // Keep tooltip on screen
    const tx=evt.clientX+16,ty=evt.clientY-10;
    tt.style.left=(tx+200>window.innerWidth?evt.clientX-210:tx)+'px';
    tt.style.top=(ty+150>window.innerHeight?evt.clientY-150:ty)+'px';
  } else {
    tt.style.display='none';
  }
}

function onWheel(e){
  e.preventDefault();
  S.zoom=Math.max(0.25,Math.min(12,S.zoom*(e.deltaY>0?.87:1.15)));
  renderAll();
}

window.addEventListener('load',init);