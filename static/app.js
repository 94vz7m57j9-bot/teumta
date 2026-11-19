const D=['월','화','수','목','금','토','일'],S=32,START=8;
const $=(s,r=document)=>r.querySelector(s);
const app=$('#app');
const tlabel=s=>{const m=START*60+s*30;return String(m/60|0).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),2400)}
async function api(path,opt={}){
  const code=state.code,token=code&&localStorage.getItem('tt_'+code);
  const h={...(opt.headers||{})};if(token)h['x-member-token']=token;
  if(opt.json){h['content-type']='application/json';opt.body=JSON.stringify(opt.json)}
  const r=await fetch('/api'+path,{method:opt.method||'GET',headers:h,body:opt.body});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.detail||'문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  return j;
}
const state={code:null,data:null,grid:null,tab:'mine',view:'raw',tool:1,mode:'all',minutes:120,rec:null,dirty:false};
const fmtDate=d=>{const [,m,dd]=d.split('-');return +m+'월 '+ +dd+'일(월)'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function route(){
  const m=location.hash.match(/^#\/r\/([A-Za-z0-9]{6})/);
  state.code=m?m[1].toUpperCase():null;
  state.code?room():home();
}
addEventListener('hashchange',route);

function home(){
  const last=Object.keys(localStorage).filter(k=>k.startsWith('tt_')).map(k=>k.slice(3));
  app.innerHTML=`<div class="wrap">
  <header class="top"><button class="logo" data-go="/"><i></i>틈타</button></header>
  <div class="hero-demo" aria-hidden="true">${[...'--g--|-g--g|--g-g|g-g--|-g-g-'].filter(c=>c!='|').map(c=>c=='g'?'<span class="g">.</span>':'<span>-</span>').join('')}</div>
  <h1>사생활은 가리고,<br>약속은 1초 만에.</h1>
  <p class="lead">시간표 사진이나 캘린더 파일만 올리면, 모두 가능한 시간 TOP 3를 찾아 드려요. 수업·근무·병원 일정은 상대에게 전부 '-'로만 보여요.</p>
  <div class="two">
    <form class="card stack" id="f-new"><div><h2>새 모임 만들기</h2><span class="muted">대학생, 직장인, 교대근무자 누구나 쓸 수 있어요.</span></div>
      <div><label for="t">모임 이름</label><input type="text" id="t" maxlength="40" placeholder="예: 스터디 회식" required></div>
      <div><label for="n">내 이름</label><input type="text" id="n" maxlength="12" placeholder="예: 민지" required></div>
      <button class="btn">모임 만들기</button><p class="err" id="e1"></p></form>
    <form class="card stack" id="f-join"><div><h2>코드로 참여하기</h2><span class="muted">초대 링크를 받았다면 링크만 열어도 돼요.</span></div>
      <div><label for="c">모임 코드 6자리</label><input type="text" id="c" maxlength="6" placeholder="K7M2QX" style="text-transform:uppercase" required></div>
      <button class="btn ghost">참여하기</button><p class="err" id="e2"></p>
      ${last.length?`<div class="muted">최근 모임: ${last.map(c=>`<a href="#/r/${c}">${c}</a>`).join(', ')}</div>`:''}</form>
  </div>
  <details class="card" style="margin-top:16px"><summary>다른 앱과 연동하기 (API)</summary>
    <p class="muted">카카오 i 오픈빌더의 스킬 URL에 아래 주소를 넣으면 챗봇에서 “약속 K7M2QX”처럼 물어볼 수 있어요.</p>
<pre>POST ${location.origin}/api/kakao/skill
GET  ${location.origin}/api/rooms/{코드}/recommend?minutes=120&amp;mode=all
POST ${location.origin}/api/analyze/image?days=5&amp;start=9&amp;end=18   (이미지 본문)
POST ${location.origin}/api/analyze/ics?week=2026-11-16               (.ics 본문)</pre></details></div>`;
  $('#f-new').onsubmit=async e=>{e.preventDefault();try{const r=await api('/rooms',{method:'POST',json:{title:$('#t').value,name:$('#n').value}});localStorage.setItem('tt_'+r.code,r.token);location.hash='#/r/'+r.code}catch(x){$('#e1').textContent=x.message}};
  $('#f-join').onsubmit=e=>{e.preventDefault();location.hash='#/r/'+$('#c').value.trim().toUpperCase()};
  app.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>location.hash='#/');
}

async function room(){
  try{state.data=await api('/rooms/'+state.code)}catch(x){app.innerHTML=`<div class="wrap"><header class="top"><button class="logo" onclick="location.hash='#/'"><i></i>틈타</button></header><div class="card"><h2>${esc(x.message)}</h2><button class="btn" onclick="location.hash='#/'">처음으로</button></div></div>`;return}
  if(!state.data.me){return joinScreen()}
  state.grid=[...state.data.me.grid].map(Number);state.tab='mine';state.dirty=false;state.rec=null;
  render();
}
function joinScreen(){
  app.innerHTML=`<div class="wrap"><header class="top"><button class="logo" onclick="location.hash='#/'"><i></i>틈타</button></header>
  <form class="card stack" id="fj" style="max-width:420px"><div><h2>${esc(state.data.room.title)}</h2><span class="muted">현재 ${state.data.members.length}명이 참여 중이에요.</span></div>
  <div><label for="jn">내 이름</label><input type="text" id="jn" maxlength="12" required></div><button class="btn">참여하기</button><p class="err" id="je"></p></form></div>`;
  $('#fj').onsubmit=async e=>{e.preventDefault();try{const r=await api('/rooms/'+state.code+'/join',{method:'POST',json:{name:$('#jn').value}});localStorage.setItem('tt_'+state.code,r.token);room()}catch(x){$('#je').textContent=x.message}};
}

function render(){
  const d=state.data,tabs=[['mine','내 일정'],['group','모두의 틈'],['rec','약속 추천']];
  app.innerHTML=`<div class="wrap"><header class="top"><button class="logo" onclick="location.hash='#/'"><i></i>틈타</button><span class="muted">${d.members.length}명 참여 중</span></header>
  <div class="row" style="justify-content:space-between"><div><h2 style="font-size:26px">${esc(d.room.title)}</h2><span class="muted">코드 ${state.code} · ${esc(d.me.name)} 님으로 참여 중</span></div>
  <div class="row"><button class="btn ghost" id="share">초대하기</button></div></div>
  <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${state.tab==k}" data-t="${k}">${l}</button>`).join('')}</div>
  <div id="pane"></div></div>`;
  app.querySelectorAll('[data-t]').forEach(b=>b.onclick=async()=>{if(state.dirty&&state.tab=='mine')await save(true);state.tab=b.dataset.t;if(state.tab!='mine')state.data=await api('/rooms/'+state.code);render()});
  $('#share').onclick=share;
  ({mine:paneMine,group:paneGroup,rec:paneRec})[state.tab]();
}

function tableHTML(cellFn,pick){
  let h='<table class="tt"><thead><tr><th style="width:46px"></th>'+D.map((x,i)=>`<th class="${i>4?'wk':''}">${x}</th>`).join('')+'</tr></thead><tbody>';
  for(let s=0;s<S;s++){h+=`<tr><td class="t">${s%2==0?tlabel(s):''}</td>`;
    for(let d=0;d<7;d++){const [cls,txt]=cellFn(d,s);h+=`<td class="c ${cls}${pick&&pick(d,s)?' pick':''}" data-d="${d}" data-s="${s}">${txt}</td>`}h+='</tr>'}
  return h+'</tbody></table>';
}
const idx=(d,s)=>d*S+s;

function paneMine(){
  const raw=state.view=='raw';
  $('#pane').innerHTML=`<div class="stack">
  <div class="card stack"><div><h2>일정 불러오기</h2><span class="muted">사진은 파이썬이 시간 블록만 읽고, 과목명·제목·장소는 저장하지 않아요.</span></div>
   <div class="two">
    <div class="drop"><b>시간표·근무표 사진</b><div class="muted">png, jpg 캡처</div>
      <div class="row" style="justify-content:center;margin-top:8px"><input type="file" id="img" accept="image/*" aria-label="시간표 사진 선택"></div></div>
    <div class="drop"><b>폰 캘린더 파일</b><div class="muted">.ics 내보내기 (제목·장소는 읽지 않아요)</div>
      <div class="row" style="justify-content:center;margin-top:8px"><input type="file" id="ics" accept=".ics,text/calendar" aria-label="캘린더 파일 선택"></div></div>
   </div>
   <details><summary>분석 설정</summary><div class="two" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
     <div><label for="o-ty">시간표 유형</label><select id="o-ty"><option value="09:00">에브리타임식 (첫 줄 9시)</option><option value="08:10">학교 교시표 (0교시 08:00, 1교시 09:10…)</option><option value="">직접 입력</option></select></div>
     <div><label for="o-st">첫 줄 시작 시각</label><input type="time" id="o-st" value="09:00"></div>
     <div><label for="o-tmp">사진 종류</label><select id="o-tmp"><option value="0">매주 반복(수업 시간표)</option><option value="1">이번 주만(근무표·변동)</option></select></div>
     <div><label for="o-w">캘린더 기준 주</label><input type="date" id="o-w" value="${new Date(Date.now()+324e5).toISOString().slice(0,10)}"></div></div>
     <p class="muted">에브리타임·학교 포털 시간표 캡처는 격자선을 찾아 요일 수와 칸을 자동으로 맞춰요. 캘린더(.ics) 일정은 항상 '이번 주만'으로 들어가요. 결과가 어긋나면 아래 표에서 고치세요.</p></details>
   <p class="err" id="ae"></p></div>
  <div class="card"><div class="row" style="justify-content:space-between">
    <div class="seg" role="group" aria-label="보기 전환"><button aria-pressed="${raw}" data-v="raw">내 화면</button><button aria-pressed="${!raw}" data-v="mask">상대에게 보이는 화면</button></div>
    ${raw?`<div class="seg" role="group" aria-label="입력 도구"><button aria-pressed="${state.tool==1}" data-tool="1">고정 일정</button><button aria-pressed="${state.tool==3}" data-tool="3">이번 주만</button><button aria-pressed="${state.tool==2}" data-tool="2">휴식</button><button aria-pressed="${state.tool==0}" data-tool="0">지우기</button></div>`:''}</div>
   <div class="legend">${raw?'<span><i style="background:var(--gapbg)"></i>가능</span><span><i style="background:var(--busy)"></i>고정 일정(매주 반복)</span><span><i class="tmp"></i>이번 주만(변동·추가)</span><span><i style="background:var(--rest)"></i>휴식·개인 용무(이번 주만)</span>':'<span><i style="background:var(--gapbg)"></i>가능</span><span><i style="background:var(--busy)"></i>-  (이유는 모두 가려져요)</span>'}</div>
   <div class="gridbox" id="gb"></div>
   <div class="row" style="margin-top:12px"><button class="btn gap" id="save">저장</button><button class="btn ghost" id="clear">모두 비우기</button><span class="muted" id="st">${raw?'칸을 누르거나 드래그해서 칠해요. 이번 주만·휴식 칸은 '+fmtDate(state.data.reset_on)+' 0시에 자동으로 지워져요.':'다른 참여자는 이 화면만 볼 수 있어요.'}</span></div></div></div>`;
  drawGrid();
  $('#pane').querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{state.view=b.dataset.v;paneMine()});
  $('#pane').querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{state.tool=+b.dataset.tool;paneMine()});
  $('#o-ty').onchange=e=>{if(e.target.value)$('#o-st').value=e.target.value};
  $('#save').onclick=()=>save();
  $('#clear').onclick=()=>{state.grid=state.grid.map(()=>0);state.dirty=true;drawGrid()};
  $('#img').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('#ae').textContent='';
    const [hh,mm]=($('#o-st').value||'09:00').split(':').map(Number);const q=`start_min=${hh*60+mm}&temp=${$('#o-tmp').value}`;
    try{const r=await api('/analyze/image?'+q,{method:'POST',body:f});merge(r.grid);toast('사진에서 바쁜 시간을 찾았어요. 맞는지 확인해 보세요.')}catch(x){$('#ae').textContent=x.message}e.target.value=''};
  $('#ics').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('#ae').textContent='';
    try{const r=await api('/analyze/ics?week='+$('#o-w').value,{method:'POST',body:await f.text()});merge(r.grid);toast(r.week_start+' 주 일정을 반영했어요.')}catch(x){$('#ae').textContent=x.message}e.target.value=''};
}
function merge(g){[...g].forEach((c,i)=>{if(c!='0'&&state.grid[i]==0)state.grid[i]=Number(c)});state.dirty=true;state.view='raw';paneMine()}
function drawGrid(){
  const raw=state.view=='raw';
  $('#gb').innerHTML=tableHTML((d,s)=>{const v=state.grid[idx(d,s)];
    if(!v)return['',''];
    if(raw)return[v==2?'r':v==3?'b tmp':'b',v==2?'휴':'-'];return['b','-']});
  if(!raw)return;
  const gb=$('#gb');let drawing=false,paint=1;
  const cell=e=>{const el=document.elementFromPoint(e.clientX,e.clientY);return el&&el.classList&&el.classList.contains('c')?el:null};
  const apply=el=>{const i=idx(+el.dataset.d,+el.dataset.s);if(state.grid[i]!=paint){state.grid[i]=paint;state.dirty=true;const v=paint;el.className='c '+(v==2?'r':v==3?'b tmp':v==1?'b':'');el.textContent=v==2?'휴':v==1?'-':''}};
  gb.onpointerdown=e=>{const el=cell(e);if(!el)return;e.preventDefault();drawing=true;const cur=state.grid[idx(+el.dataset.d,+el.dataset.s)];paint=cur==state.tool?0:state.tool;apply(el)};
  gb.onpointermove=e=>{if(!drawing)return;const el=cell(e);if(el)apply(el)};
  addEventListener('pointerup',()=>drawing=false,{once:false});
}
async function save(silent){
  try{await api('/rooms/'+state.code+'/me',{method:'PUT',json:{grid:state.grid.join('')}});state.dirty=false;if(!silent)toast('저장했어요')}catch(x){toast(x.message)}
}
function paneGroup(){
  const m=state.data.members,n=m.length;
  $('#pane').innerHTML=`<div class="card"><div class="legend"><span><i style="background:var(--gap)"></i>${n}명 모두 가능</span><span><i style="background:var(--busy)"></i>- 누군가 불가 (사유는 가려져요)</span></div>
  <div class="gridbox" id="gb"></div><p class="muted">참여자: ${m.map(x=>`<span class="chip">${esc(x.name)}${x.grid.includes('1')?'':' (미입력)'}</span>`).join(' ')}</p></div>`;
  $('#gb').innerHTML=tableHTML((d,s)=>m.every(x=>x.grid[idx(d,s)]=='0')?['all','']:['b','-']);
}
async function loadRec(){
  state.rec=await api(`/rooms/${state.code}/recommend?minutes=${state.minutes}&mode=${state.mode}`);
}
async function paneRec(){
  const modes=[['all','전체'],['lunch','점심'],['dinner','저녁'],['weekend','주말']];
  $('#pane').innerHTML=`<div class="card"><div class="row" style="justify-content:space-between">
    <div class="seg" role="group" aria-label="시간대">${modes.map(([k,l])=>`<button aria-pressed="${state.mode==k}" data-m="${k}">${l}</button>`).join('')}</div>
    <div><label for="mn" style="display:inline;margin-right:6px">만나는 시간</label><select id="mn" style="width:auto">${[60,90,120,180,240].map(v=>`<option value="${v}" ${v==state.minutes?'selected':''}>${v/60}시간</option>`).join('')}</select></div></div>
   <div id="rr" class="rec"><p class="muted">찾는 중이에요…</p></div></div>`;
  $('#pane').querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.m;paneRec()});
  $('#mn').onchange=e=>{state.minutes=+e.target.value;paneRec()};
  try{await loadRec()}catch(x){$('#rr').innerHTML=`<p class="err">${esc(x.message)}</p>`;return}
  const r=state.rec;
  if(!r.items.length){$('#rr').innerHTML='<p>모두 가능한 시간을 찾지 못했어요. 만나는 시간을 줄이거나 시간대를 바꿔 보세요. 참여자가 아직 일정을 입력하지 않았을 수도 있어요.</p>';return}
  $('#rr').innerHTML=(r.mode=='almost'?'<div class="note">전원이 가능한 시간이 없어서, 한 명만 빠지는 시간을 보여 드려요.</div>':'')+r.items.map((it,i)=>`<div class="item ${i==0?'first':''}"><div class="rank">${i+1}</div><div style="flex:1"><div class="when">${it.day_name}요일 ${it.start} ~ ${it.end}</div>
    <div class="muted">${it.missing.length?'불가: '+it.missing.map(esc).join(', '):`${r.people}명 모두 가능`}</div></div>
    <button class="btn ghost" data-pick="${i}">카톡으로 공유</button></div>`).join('');
  $('#rr').querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>shareTime(r.items[+b.dataset.pick]));
}
let kakaoInit=null;
async function kakao(){
  if(kakaoInit!==null)return kakaoInit;
  try{const c=await api('/config');if(c.kakao_js_key&&window.Kakao){if(!Kakao.isInitialized())Kakao.init(c.kakao_js_key);kakaoInit=true;return true}}catch(e){}
  return kakaoInit=false;
}
async function sendText(title,desc,url,btn){
  if(await kakao()){Kakao.Share.sendDefault({objectType:'feed',content:{title,description:desc,link:{mobileWebUrl:url,webUrl:url}},buttons:[{title:btn,link:{mobileWebUrl:url,webUrl:url}}]});return}
  const text=`${title}\n${desc}\n${url}`;
  if(navigator.share){try{await navigator.share({title,text,url});return}catch(e){if(e.name=='AbortError')return}}
  try{await navigator.clipboard.writeText(text);toast('복사했어요. 카카오톡에 붙여넣어 보내 주세요.')}catch(e){prompt('복사해서 보내 주세요',text)}
}
const link=()=>location.origin+'/#/r/'+state.code;
function share(){sendText(`[틈타] ${state.data.room.title}`,'일정은 가려지고, 모두 가능한 시간만 찾아 드려요. 시간표를 올려 주세요!',link(),'참여하기')}
function shareTime(it){sendText(`[틈타] ${state.data.room.title} 약속 시간`,`${it.day_name}요일 ${it.start} ~ ${it.end} 어때요?`,link(),'확인하기')}
route();
