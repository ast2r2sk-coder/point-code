(()=>{
  const api=acquireVsCodeApi();const root=document.getElementById('root');
  const saved=api.getState()||{};
  const LEGACY={mobile:'iphone'};
  let base='',screens=[],devices=[],projects=[],project='',selected=new Set(saved.selected||[]);
  let deviceId=LEGACY[saved.deviceId]||saved.deviceId||'desktop',zoom=saved.zoom||0.35;
  // Last live preview per channel, replayed into frames as they load.
  const live={palette:null,inspector:null};
  const cards=new Map();
  const h=(tag,cls,...kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;for(const k of kids.flat(Infinity)){if(k==null||k===false)continue;n.append(k instanceof Node?k:String(k));}return n;};
  const btn=(cls,label,fn,title)=>{const b=h('button',cls,label);b.type='button';b.onclick=fn;if(title)b.title=title;return b;};
  const KIND={page:'페이지',snapshot:'담은 화면',modal:'모달',toast:'토스트',drawer:'드로어',popover:'팝오버',view:'화면'};
  const framed=s=>s.kind==='page'||s.kind==='snapshot';
  const device=()=>devices.find(d=>d.id===deviceId)||devices[0]||{id:'desktop',label:'Desktop',w:1440,h:900};
  const persist=()=>api.setState({deviceId,zoom,selected:[...selected]});
  const origin=()=>{try{return new URL(base).origin;}catch{return '*';}};
  const urlOf=s=>s.kind==='snapshot'?(s.src||''):base&&s.kind==='page'&&s.route?base.replace(/\/$/,'')+s.route:'';

  // ---- Static chrome, built once.
  const resetLinks=btn('ghost','찾은 링크 지우기',()=>api.postMessage({type:'reset-links'}),'미리보기에서 수집한 링크 화면을 모두 지웁니다 (다시 돌아다니면 다시 모입니다)');
  const toolbar=h('div','toolbar',h('div','title','화면 보드'),h('div','toolbar-actions',resetLinks,btn('ghost','새로고침',()=>api.postMessage({type:'refresh'}),'경로와 열린 레이어를 다시 찾습니다')));
  const hint=h('p','hint');
  const projectRow=h('div','devices projects');
  const deviceRow=h('div','devices');
  const zoomInput=h('input');zoomInput.type='range';zoomInput.min='0.15';zoomInput.max='0.7';zoomInput.step='0.05';zoomInput.value=String(zoom);
  const zoomLabel=h('span',null,Math.round(zoom*100)+'%');
  zoomInput.oninput=()=>{zoom=+zoomInput.value;zoomLabel.textContent=Math.round(zoom*100)+'%';persist();sizeAll();};
  const zoomWrap=h('label','zoom','줌 ',zoomInput,zoomLabel);
  const batch=btn('primary','',()=>api.postMessage({type:'focus-palette'}));
  const actions=h('div','actions',
    btn('ghost','디자인 시스템',()=>api.postMessage({type:'focus-palette'})),
    btn('ghost','전체 선택',()=>{selected=new Set(screens.filter(framed).map(s=>s.id));selectionChanged();}),
    btn('ghost','선택 해제',()=>{selected.clear();selectionChanged();}),
    batch);
  const warn=h('p','warn','개발 서버가 연결되지 않았습니다. 먼저 Point Code: 시작을 실행하세요. 미리보기는 프록시 주소가 있어야 채워집니다.');
  const empty=h('p','empty','발견된 화면이 없습니다. HTML(index.html), Next app/pages, SvelteKit, 파일 기반 라우팅(src/pages)을 스캔합니다.');
  // Single-page / vanilla apps: files show only Home, so explain the two runtime ways to add screens.
  const tip=h('p','tip','화면이 Home 하나뿐인가요? 미리보기에서 메뉴·링크를 따라가면 링크 화면이 자동으로 추가됩니다. 버튼으로만 바뀌는 화면(모달, 탭, 단계)은 그 상태에서 ',h('b',null,'화면 담기'),'를 누르면 여기에 고정됩니다.');
  const canvas=h('div','canvas');
  root.append(toolbar,hint,tip,projectRow,deviceRow,actions,warn,empty,canvas);

  function paintChrome(){
    hint.textContent=selected.size
      ?'선택한 '+selected.size+'개 화면에만 디자인 시스템 미리보기를 보여 줍니다 (미리보기 창과 브라우저에는 항상 적용). 선택을 해제하면 모든 화면에 보입니다.'
      :'피그마처럼 화면을 나란히 봅니다. 디자인 시스템에서 토큰을 바꾸면 모든 화면에 바로 보입니다. 화면을 선택하면 그 화면에만 미리볼 수 있습니다.';
    projectRow.textContent='';projectRow.hidden=projects.length<2;
    if(projects.length>1){projectRow.append(h('span','group','앱'));for(const p of projects)projectRow.append(btn('chip'+(p.dir===project?' on':''),p.label,()=>api.postMessage({type:'project',dir:p.dir})));}
    deviceRow.textContent='';deviceRow.append(h('span','group','해상도'));
    let group='';
    for(const d of devices){
      if(d.group!==group){group=d.group;deviceRow.append(h('span','sep'));}
      const b=btn('chip'+(device().id===d.id?' on':''),d.label,()=>{deviceId=d.id;persist();paintChrome();sizeAll();},d.w+'×'+d.h+(d.approx?' (근사값)':''));
      deviceRow.append(b);
    }
    deviceRow.append(zoomWrap);
    batch.textContent=selected.size?'선택 화면 디자인 편집 · '+selected.size:'선택 화면 디자인 편집';
    batch.disabled=!selected.size;
    warn.hidden=!!base;
    empty.hidden=screens.length>0;
    tip.hidden=screens.filter(framed).length>3;
    resetLinks.hidden=!screens.some(s=>s.origin==='link');
  }

  // ---- Live previews into frames (no SSE inside board frames).
  function send(frame,payload){try{frame.contentWindow?.postMessage({__pointCode:'live',payload},origin());}catch{}}
  function pushLive(entry){
    if(!entry.iframe)return;
    const scoped=selected.size&&!selected.has(entry.s.id);
    send(entry.iframe,scoped?{channel:'palette',tokens:[]}:(live.palette||{channel:'palette',tokens:[]}));
    if(live.inspector)send(entry.iframe,live.inspector);
  }
  function onLive(payload){
    if(!payload||typeof payload!=='object')return;
    if(payload.channel==='palette'){live.palette=payload;for(const e of cards.values())if(e.iframe)send(e.iframe,selected.size&&!selected.has(e.s.id)?{channel:'palette',tokens:[]}:payload);return;}
    live.inspector=payload.reset?null:payload;
    for(const e of cards.values())if(e.iframe)send(e.iframe,payload);
  }

  // ---- Cards. Created once per screen and updated in place; an iframe is only replaced when its URL changes.
  function sizeCard(e){
    if(!e.iframe)return;
    const dev=device();
    e.wrap.style.width=Math.round(dev.w*zoom)+'px';e.wrap.style.height=Math.round(dev.h*zoom)+'px';
    e.iframe.style.width=dev.w+'px';e.iframe.style.height=dev.h+'px';e.iframe.style.transform='scale('+zoom+')';
    e.meta.textContent=dev.label+' · '+dev.w+'×'+dev.h+(dev.approx?' (근사값)':'');
  }
  function sizeAll(){for(const e of cards.values())sizeCard(e);}
  function paramForm(s){
    const form=h('form','params');
    const inputs=s.params.map(p=>{const i=h('input');i.type='text';i.placeholder=p;i.value=(s.values||{})[p]||'';i.setAttribute('aria-label',p);return [p,i];});
    form.append(h('div','frame-empty-title','동적 경로 · 값을 넣으면 미리보기가 열립니다'),...inputs.map(([p,i])=>h('label','param',h('code',null,p),i)),h('button','primary','열기'));
    form.onsubmit=ev=>{ev.preventDefault();api.postMessage({type:'params',id:s.id,values:Object.fromEntries(inputs.map(([p,i])=>[p,i.value]))});};
    return form;
  }
  function buildCard(s){
    const e={s,url:urlOf(s)};
    const card=h('div','frame kind-'+s.kind);e.card=card;
    const check=h('input');check.type='checkbox';check.setAttribute('aria-label',(s.label||s.route||'')+' 선택');check.onchange=()=>toggle(s.id);e.check=check;
    e.name=h('span','name',s.label||s.pattern||s.route);
    card.append(h('div','frame-label',framed(s)?check:null,h('span','badge',s.origin==='link'?'링크':KIND[s.kind]||s.kind),e.name));
    if(e.url){
      e.wrap=h('div','frame-artboard');
      e.iframe=h('iframe','frame-iframe');
      e.iframe.name='point-code-board';
      e.iframe.title=s.label||s.route;
      e.iframe.loading='lazy';
      e.iframe.onload=()=>pushLive(e);
      e.iframe.src=e.url;
      e.wrap.append(e.iframe);
      e.meta=h('div','frame-meta');
      card.append(e.wrap,e.meta);
      const acts=[btn('link','미리보기에서 열기',()=>api.postMessage({type:'open',route:s.route}))];
      if(s.kind==='snapshot')acts.push(btn('link','이름 바꾸기',()=>api.postMessage({type:'rename',id:s.id})),btn('link','삭제',()=>api.postMessage({type:'remove',id:s.id})));
      else acts.push(btn('link','URL 복사',()=>api.postMessage({type:'copy',route:s.route})));
      if(s.origin==='link')acts.push(btn('link','빼기',()=>api.postMessage({type:'remove',id:s.id}),'이 링크 화면을 보드에서 뺍니다'));
      card.append(h('div','frame-actions',...acts));
      if(s.kind==='snapshot')card.append(h('div','frame-note','담은 순간의 화면 · 스타일 수정은 바로 보이고, 내용이 바뀌면 다시 담으세요'));
    } else if(s.kind==='page'&&s.params?.length) {
      card.append(h('div','frame-empty',paramForm(s)));
    } else if(framed(s)) {
      card.append(h('div','frame-empty','개발 서버를 연결하면 미리보기가 채워집니다'));
      if(s.kind==='snapshot')card.append(h('div','frame-actions',btn('link','삭제',()=>api.postMessage({type:'remove',id:s.id}))));
    } else {
      card.append(h('div','frame-empty',h('div',null,'열려 있는 레이어 · ',h('code',null,s.selector||'')),h('div','muted','경로 '+s.route+' · 레이어가 열려 있는 동안만 찾아갈 수 있습니다')));
      const acts=[btn('link','미리보기에서 보기',()=>api.postMessage({type:'open',route:s.route,selector:s.selector}))];
      if(s.doc)acts.unshift(btn('link primary-link','이 상태 담기',()=>api.postMessage({type:'capture',doc:s.doc}),'이 레이어가 열린 화면을 그대로 보드에 고정합니다'));
      card.append(h('div','frame-actions',...acts));
    }
    card.onclick=ev=>{if(!framed(s)||ev.target.closest('button,iframe,input,form,label'))return;toggle(s.id);};
    sizeCard(e);
    return e;
  }
  function paintSelection(e){const on=selected.has(e.s.id);e.card.classList.toggle('selected',on);if(e.check)e.check.checked=on;}
  function syncCards(){
    const want=[];
    for(const s of screens){
      let e=cards.get(s.id);
      if(e&&(e.url!==urlOf(s)||(!e.url&&JSON.stringify(e.s)!==JSON.stringify(s)))){e.card.remove();cards.delete(s.id);e=null;}
      if(!e){e=buildCard(s);cards.set(s.id,e);}
      e.s=s;e.name.textContent=s.label||s.pattern||s.route;paintSelection(e);want.push(e.card);
    }
    for(const [id,e] of cards)if(!screens.some(s=>s.id===id)){e.card.remove();cards.delete(id);}
    // Moving an iframe in the DOM reloads it, so only reorder when the order really changed.
    // Position by position: a new card is inserted where it belongs and cards already in place are never touched.
    want.forEach((c,i)=>{const at=canvas.children[i];if(at!==c)canvas.insertBefore(c,at||null);});
  }
  function toggle(id){if(selected.has(id))selected.delete(id);else selected.add(id);selectionChanged();}
  function selectionChanged(){persist();paintChrome();for(const e of cards.values()){paintSelection(e);pushLive(e);}}

  window.addEventListener('message',ev=>{
    const m=ev.data;
    if(m?.type==='screens'){
      const baseChanged=(m.base||'')!==base;
      base=m.base||'';screens=m.screens||[];devices=m.devices||devices;projects=m.projects||[];project=m.project||'';
      if(baseChanged){for(const e of cards.values())e.card.remove();cards.clear();}
      const ids=new Set(screens.map(s=>s.id));selected=new Set([...selected].filter(id=>ids.has(id)));
      paintChrome();syncCards();
    }
    if(m?.type==='live')onLive(m.payload);
  });
  paintChrome();api.postMessage({type:'ready'});
})();
