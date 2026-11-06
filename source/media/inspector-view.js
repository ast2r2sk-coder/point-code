(()=>{
  const api=acquireVsCodeApi();const root=document.getElementById('root');
  const state=api.getState()||{showLib:false};let data=null,pick=null,identity=null,saving=false;
  // Unsaved edits of the previously picked element: offered for saving instead of being dropped silently.
  let stale=null;
  const drafts=new Map(),committed=new Map(),pending=new Map(),wide=new Map();let lastTag='';
  // saved: edits of this pick already written to source (kept in the preview until HMR catches up).
  // batches: what each save replaced, so undoing it restores the fields. history: the host's undo stack (shared with the Design System).
  const saved=new Map(),batches=new Map();let history={canUndo:false,label:''};
  const h=(tag,cls,...kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;for(const k of kids.flat(Infinity)){if(k==null||k===false)continue;n.append(k instanceof Node?k:String(k));}return n;};
  const action=(cls,label,fn,title)=>{const a=h('a',cls,label);a.href='#';if(title)a.title=title;a.onclick=e=>{e.preventDefault();fn();};return a;};
  const open=id=>api.postMessage({type:'open',id});
  const link=loc=>loc?action('loc'+(loc.utility?' util':''),loc.label,()=>open(loc.id),'편집기에서 열기'):h('span','loc none','위치 없음');
  const swatch=v=>{const m=String(v).match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]*\)/i);if(!m)return null;const s=h('span','sw');s.style.background=m[0];return s;};
  const COLOR_PROP=/^(color|background-color|background|border-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color)$/;
  const colorish=(p,v)=>/url\(|gradient\(/i.test(v)?/var\(\s*--/.test(v):COLOR_PROP.test(p)||/^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\(|transparent$|currentcolor$|var\(\s*--)/i.test(String(v).trim());
  const kindFor=p=>COLOR_PROP.test(p)?'color':p==='font-weight'?'weight':p==='font-family'?'font':p==='font-size'||p==='width'||p==='height'||p==='min-width'||p==='max-width'||p==='min-height'||p==='max-height'?'size':/margin|padding|gap|radius/.test(p)?'space':null;
  function toHex(v){try{const c=h('span');c.style.color=v;root.append(c);const rgb=getComputedStyle(c).color;c.remove();const m=rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);return m?'#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join(''):'#888888';}catch{return '#888888';}}
  function section(title,count,kids,openByDefault=true){const d=h('details','sec');d.open=openByDefault;d.append(h('summary',null,title,count!=null?h('span','count',String(count)):null),...[kids].flat(Infinity).filter(Boolean));return d;}
  function chip(p){
    if(p.b===true)return h('span','chip on',p.k,' ON');
    if(p.b===false)return h('span','chip off',p.k,' OFF');
    const c=h('span','chip'+(p.t?' text':''),p.k,'=',p.v);if(p.t)c.title='화면 텍스트가 이 prop에서 옵니다';return c;
  }
  const broad=sel=>{const s=(sel||'').split(',')[0].trim();return /^(html|body|:root|\*|html body)$/i.test(s)||/^\*/.test(sel||'');};
  function payload(r,d,value,extra){
    const tokenName=(String(d.v).match(/var\(\s*(--[\w-]+)/)||[])[1];
    const retarget=/^var\(\s*--[\w-]+\s*\)$/.test(String(value).trim());
    const useToken=extra?.mode==='token'||(extra?.mode==null&&!!tokenName&&!retarget&&wide.get(r.loc?.id+':'+d.p)!==false&&!r.loc?.utility);
    const mode=extra?.mode||(useToken?'token':r.loc?.utility?'utility':r.inline?'inline':'css');
    const tok=(data.tokens||[]).find(t=>t.n===(extra?.token||tokenName));
    return {
      selId:data.sel,tokenSel:tok?.sel||null,
      mode,id:r.loc&&r.loc.id,prop:d.p,value,old:committed.get(r.loc?.id+':'+d.p)??d.v,token:extra?.token||tokenName,file:extra?.file||tok?.file,
      css:useToken?[]:[{selector:r.selector,prop:d.p,value,scope:r.loc?.utility?'element':'rule',from:r.from||null}],
      tokens:useToken&&tokenName?[{n:tokenName,v:value}]:[],
      highlight:useToken?{selector:null,from:null,broad:true}:{selector:r.selector,from:r.from||null,broad:broad(r.selector)}
    };
  }
  function setFoot(kind,message,canSave){
    const n=document.getElementById('status'),b=document.getElementById('save');
    if(n&&kind!=null){n.className='status '+kind;n.textContent=message||'';}
    if(b){b.disabled=saving||(!canSave && pending.size===0);b.textContent=saving?'저장 중…':pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장';}
    const c=document.getElementById('cancel');if(c)c.disabled=saving||!pending.size;
    const u=document.getElementById('undo');if(u){u.disabled=saving||!history.canUndo;u.title=history.canUndo?'마지막 저장 되돌리기 · '+history.label:'되돌릴 저장이 없습니다';}
  }
  const markDirty=()=>{for(const n of root.querySelectorAll('[data-key]'))n.classList.toggle('dirty',pending.has(n.dataset.key));};
  // The preview shows exactly saved + pending edits; cancelling one is just leaving it out.
  function syncPreview(){if(data)api.postMessage({type:'preview-all',selId:data.sel,items:[...saved.values(),...pending.values()]});}
  function revert(key,quiet){
    pending.delete(key);
    if(committed.has(key))drafts.set(key,committed.get(key));else drafts.delete(key);
    if(!quiet){syncPreview();render();setFoot('',pending.size?'이 값만 되돌렸습니다 · 저장 안 한 변경 '+pending.size+'개':'변경을 취소했습니다',false);}
  }
  function cancelAll(){
    if(!pending.size)return;
    const n=pending.size;for(const k of [...pending.keys()])revert(k,true);
    syncPreview();render();setFoot('','저장하지 않은 변경 '+n+'개를 취소했습니다',false);
  }
  const revertBtn=key=>{const b=h('button','revert','↺');b.type='button';b.title='이 값 되돌리기 (저장 전)';b.setAttribute('aria-label','이 값 되돌리기');b.onclick=()=>revert(key);return b;};
  function preview(key,p,mapped){
    drafts.set(key,p.value);
    // Always queue — persist() may still locate a unique workspace CSS rule even when loc.save was false.
    pending.set(key,p);
    api.postMessage({type:'preview',...p});
    markDirty();
    if(mapped) setFoot('preview','화면 미리보기 · 파일은 아직입니다. ‘소스에 저장’을 누르세요.',true);
    else setFoot('warn','화면 미리보기 · 원본 파일을 아직 모릅니다. ‘소스에 저장’을 누르면 워크스페이스에서 찾아 봅니다.',true);
  }
  // One save request; the host writes the items in order and reports each one. Failed items stay pending.
  function saveAll(){
    if(!pending.size||saving)return;
    saving=true;
    api.postMessage({type:'save',items:[...pending].map(([key,p])=>({key,...p}))});
    setFoot('preview','파일에 쓰는 중…',false);
  }
  function saveStale(){if(!stale)return;api.postMessage({type:'save',items:stale.items.map(([key,p])=>({key:'stale:'+key,...p}))});stale=null;render();}

  function optionsFor(prop){
    const kind=kindFor(prop), tokens=(data.tokens||[]).filter(t=>t.kind===kind);
    const scale=(kind==='weight'?data.scales?.weight:kind==='font'?data.scales?.font:null)||[];
    return {kind,tokens,scale};
  }
  function pickPanel(r,d,key){
    const {kind,tokens,scale}=optionsFor(d.p);
    const WEIGHT_SUFFIX={100:'thin',200:'extralight',300:'light',400:'normal',500:'medium',600:'semibold',700:'bold',800:'extrabold',900:'black'};
    const q=h('input');q.type='search';q.placeholder=kind==='color'?'색 토큰 검색':kind==='weight'?'굵기 검색':kind==='font'?'폰트 검색':'검색';
    const list=h('div');
    const apply=(value,extra)=>{preview(key,payload(r,d,value,extra),!!(r.loc?.save||extra?.token||extra?.file));render();};
    const draw=()=>{
      list.textContent='';
      const s=q.value.trim().toLowerCase();
      if(scale.length){
        list.append(h('div','tok-title','정해진 값'));
        const row=h('div','chips');
        for(const o of scale){
          if(s&&!o.label.toLowerCase().includes(s)&&!String(o.value).includes(s))continue;
          const cur=String(drafts.get(key)||d.v);
          const on=cur===o.value||cur.includes(o.util||'')||cur.includes(WEIGHT_SUFFIX[o.value]||'__');
          const b=h('button','chip-btn'+(on?' on':''),o.label);b.title=o.value+(o.util?' · '+o.util:'');
          b.onclick=()=>{
            const suf=WEIGHT_SUFFIX[o.value]||o.util?.replace(/^font-/,'')||'';
            const t=tokens.find(x=>x.v===o.value||x.n.endsWith('-'+o.value)||(suf&&x.n.endsWith('-'+suf)));
            if(t) apply('var('+t.n+')',{mode:r.loc?.utility?'utility':'css',token:t.n,file:t.file});
            else apply(o.value,r.loc?.utility?{mode:'utility'}:{});
          };
          row.append(b);
        }
        list.append(row);
      }
      if(tokens.length){
        list.append(h('div','tok-title','디자인 토큰'));
        for(const t of tokens.filter(t=>!s||t.n.toLowerCase().includes(s)||t.v.toLowerCase().includes(s)).slice(0,80)){
          const on=(drafts.get(key)||d.v).includes(t.n);
          const item=h('button','item'+(on?' on':''),kind==='color'?(swatch(t.c||t.v)||h('span','sw')):null,h('code',null,t.n),h('span','muted',t.v));item.type='button';
          item.onclick=()=>apply('var('+t.n+')',{mode:r.loc?.utility?'utility':'css',token:t.n,file:t.file});
          list.append(item);
        }
      }
      if(!scale.length&&!tokens.length) list.append(h('p','muted','이 페이지에서 선택지/토큰을 찾지 못했습니다. 값을 직접 입력하세요.'));
    };
    q.oninput=draw;draw();
    const title=kind==='color'?'색 — 토큰에서 고르세요':kind==='weight'?'굵기 — 정해진 단계만 고르세요':kind==='font'?'폰트 — 등록된 패밀리에서 고르세요':'디자인 토큰';
    return h('div','tok',h('b',null,title),q,list);
  }

  function editor(r,d,kind,index){
    if(d.over||r.base) return h('div','decl'+(d.over?' over':''),h('span','p',d.p),': ',swatch(d.v),h('span','v',d.v),d.imp?h('span','imp',' !important'):null);
    const key=kind+':'+index+':'+d.p, val=drafts.has(key)?drafts.get(key):d.v, tokenName=(val.match(/var\(\s*(--[\w-]+)/)||[])[1];
    const color=colorish(d.p,val), isWide=tokenName&&wide.get(r.loc?.id+':'+d.p)!==false&&!r.loc?.utility;
    const axis=kindFor(d.p);
    const field=h('input');field.type='text';field.value=val;field.spellcheck=false;
    // Weight/font: typing is allowed as fallback, but the primary path is the picker.
    if(axis==='weight'||axis==='font') field.placeholder=axis==='weight'?'예: 500 또는 medium':'예: sans-serif';
    const mapped=!!(isWide||r.loc?.save);
    const push=v=>preview(key,payload(r,d,v,{mode:isWide?'token':undefined}),mapped);
    field.oninput=()=>push(field.value);
    const rowKids=[h('span','p',d.p),': '];
    if(color){
      const cp=h('input');cp.type='color';cp.value=toHex(val);cp.title='색 선택';
      cp.oninput=()=>{field.value=cp.value;push(cp.value);};
      rowKids.push(cp);
    }
    rowKids.push(field);
    if(axis){
      const label=axis==='color'?'토큰':axis==='weight'?'굵기':axis==='font'?'폰트':'토큰';
      rowKids.push(action('mode',label,()=>{pick=pick&&pick.key===key?null:{key,r,d};render();},'디자인 시스템 값에서 선택'));
    }
    if(d.imp) rowKids.push(h('span','imp',' !important'));
    const notes=[];
    if(tokenName){
      const w=isWide;
      const all=h('button',w?'on':null,'토큰 전체');all.type='button';
      const one=h('button',!w?'on':null,'이 규칙만');one.type='button';
      all.onclick=()=>{wide.set(r.loc?.id+':'+d.p,true);render();};
      one.onclick=()=>{wide.set(r.loc?.id+':'+d.p,false);render();};
      notes.push(h('div','note token',h('div','note-head',h('span',null,'디자인 토큰 ',h('code',null,tokenName)),h('div','pc-seg',all,one)),
        h('div',null,w?'토큰 정의를 고치면 이 토큰을 쓰는 모든 곳이 바뀝니다.':'이 규칙만 토큰에서 분리합니다.')));
    }
    rowKids.push(revertBtn(key));
    const wrap=h('div','editwrap'+(pending.has(key)?' dirty':''),h('div','edit',...rowKids),notes,pick&&pick.key===key?pickPanel(r,d,key):null);
    wrap.dataset.key=key;
    return wrap;
  }
  // Notes once per rule (not per declaration), only for rules that can be edited.
  function ruleNotes(r){
    if(r.base||!r.decls.some(d=>!d.over))return [];
    const notes=[];
    if(r.from) notes.push(h('div','note parent','부모 '+r.from+'의 규칙 · 바꾸면 이 부모를 상속하는 요소'+(r.kids?' 약 '+r.kids+'개':'')+'도 함께 바뀝니다.'));
    else if(r.hits>1) notes.push(h('div','note','화면의 '+r.hits+'개 요소에 적용되는 규칙 · 함께 바뀝니다.'));
    if(r.loc?.utility) notes.push(h('div','note','className 유틸리티 · 저장하면 '+(r.from?'부모 요소의 ':'')+'클래스 이름이 바뀝니다.'));
    if(r.loc&&!r.loc.save&&!r.loc.utility) notes.push(h('div','note warn','원본 위치를 아직 모름 · 저장하면 워크스페이스에서 같은 규칙을 한 번 더 찾습니다.'));
    return notes;
  }
  function rule(r,kind,index){
    return h('div','rule'+(r.base?' base':'')+(r.from?' inherited':''),
      h('div','rhead',r.from?h('span','from','← '+r.from):null,h('code','sel',r.selector),r.hits>1?h('span','badge',r.hits+'개'):null,r.loc&&r.loc.save===false?h('span','badge warn','미리보기만'):null,r.state?h('span','badge state',r.state):null,r.ctx.map(c=>h('span','badge',c)),link(r.loc)),
      ruleNotes(r),
      h('div','decls',r.decls.map(d=>editor(r,d,kind,index))));
  }
  // ---- 배치 (layout): plain controls instead of CSS property names. The host turns an intent into declarations
  // (core.layoutDecls); all layout edits of this pick are one pending item 'layout' = {decls:{prop:value}, ui:{…}}.
  const LAYOUT_MSG={
    'grid-flow':'그리드 상자는 방향 대신 칸으로 배치됩니다. 정렬은 9칸 패드를 쓰세요.',
    'block-y':'부모가 일반 상자라 세로 위치를 정할 수 없습니다. ‘부모 선택’ 후 부모를 정렬 상자로 만드세요.',
    'inline':'글자처럼 줄 안에 흐르는 요소라 직접 옮길 수 없습니다. ‘부모 선택’ 후 텍스트 정렬이나 정렬을 바꾸세요.',
    value:'값이 올바르지 않습니다.',intent:'지원하지 않는 배치입니다.'
  };
  const POS={'flex-start':'start',start:'start',left:'start',normal:'start','self-start':'start',center:'center','flex-end':'end',end:'end',right:'end','self-end':'end',stretch:'stretch'};
  const isFlex=d=>/flex/.test(d||''),isGrid=d=>/grid/.test(d||'');
  const layoutDraft=()=>drafts.get('layout')||committed.get('layout')||{decls:{},ui:{}};
  // Where layout edits are written: the element's own stylesheet rule, else its className (Tailwind), else nowhere (preview only).
  function layoutTarget(){
    const rule=data.rules.find(r=>!r.base&&!r.from&&!r.inline&&!r.state&&r.loc?.save&&!r.loc.utility);
    if(rule)return {kind:'css',rule,id:rule.loc.id,label:rule.selector,loc:rule.loc,hits:rule.hits};
    if(data.element?.save&&data.el.classes.length)return {kind:'utility',id:data.element.id,label:'className',loc:data.element};
    return {kind:'none',id:null,label:'원본 위치 모름'};
  }
  // The layout as it is now: what the page reported, plus what was already changed here.
  function layoutNow(){
    const L=data.layout||{self:{},parent:null},d=layoutDraft().decls,self={...L.self};
    if(d.display)self.display=d.display;if(d['flex-direction'])self.dir=d['flex-direction'];
    return {self,parent:L.parent};
  }
  function layoutPayload(next){
    const t=layoutTarget(),list=Object.entries(next.decls);
    return {selId:data.sel,mode:'layout',id:t.id,target:t.kind,classes:data.el.classes,decls:list,selector:t.rule?.selector||null,nest:t.rule?.nest||null,
      prop:'layout',value:list.map(([p,v])=>p+': '+v).join('; '),
      css:list.map(([prop,value])=>({selector:t.kind==='css'?t.rule.selector:null,prop,value,scope:t.kind==='css'?'rule':'element',from:null})),tokens:[],
      highlight:t.kind==='css'?{selector:t.rule.selector,from:null,broad:broad(t.rule.selector)}:{selector:null,from:null,broad:false}};
  }
  function layoutIntent(intent,ui){api.postMessage({type:'layout-intent',selId:data.sel,intent,ctx:layoutNow(),ui});}
  function layoutApplied(m){
    if(!data||m.selId!==data.sel)return;
    if(m.error){setFoot('warn',LAYOUT_MSG[m.error]||m.error,pending.size>0);return;}
    const cur=layoutDraft(),next={decls:{...cur.decls,...Object.fromEntries(m.decls)},ui:{...cur.ui,...(m.ui||{})}};
    const t=layoutTarget();
    preview('layout',{...layoutPayload(next)},t.kind!=='none');
    drafts.set('layout',next);
    render();
    if(m.made)setFoot('preview','정렬하려고 이 요소를 정렬 상자(display: flex)로 바꿨습니다 · 저장 전 미리보기',true);
  }
  function seg(items,current,onPick,{disabled=false,label}={}){
    const box=h('div','pc-seg');if(label)box.setAttribute('aria-label',label);box.setAttribute('role','group');
    for(const [value,text,title] of items){
      const b=h('button',current===value?'on':null,text);b.type='button';b.disabled=disabled;if(title)b.title=title;
      b.setAttribute('aria-pressed',String(current===value));b.onclick=()=>onPick(value);box.append(b);
    }
    return box;
  }
  function layoutSection(){
    const L=layoutNow(),self=L.self,parent=L.parent,ui=layoutDraft().ui,t=layoutTarget();
    const flex=isFlex(self.display),grid=isGrid(self.display),boxy=flex||grid;
    const column=flex&&/column/.test(self.dir||'');
    // Current alignment, as pad coordinates.
    const main=POS[self.justify],cross=POS[self.align];
    const cur=ui.align||(grid?{x:POS[self.justifyItems],y:cross}:flex?(column?{x:cross,y:main}:{x:main,y:cross}):{});
    const pad=h('div','pad');pad.setAttribute('role','group');pad.setAttribute('aria-label','안의 내용 정렬');
    const NAMES={start:['왼쪽','위'],center:['가운데','가운데'],end:['오른쪽','아래']};
    for(const y of ['start','center','end'])for(const x of ['start','center','end']){
      const on=boxy&&cur.x===x&&cur.y===y,b=h('button',on?'on':null,h('span','dot'));b.type='button';
      const name=(y==='center'&&x==='center')?'정가운데':NAMES[y][1]+' '+NAMES[x][0];b.title=name;b.setAttribute('aria-label',name);b.setAttribute('aria-pressed',String(on));
      b.onclick=()=>layoutIntent({type:'align',x,y},{align:{x,y}});pad.append(b);
    }
    const flow=flex?(column?'column':'row'):grid?'grid':null;
    const dist=ui.dist||(boxy?{'space-between':'between','space-evenly':'evenly','space-around':'evenly'}[self.justify]||'pack':null);
    const gap=h('input');gap.type='text';gap.value=layoutDraft().decls.gap||(boxy&&self.gap&&self.gap!=='normal'?self.gap:'');gap.placeholder='0';gap.className='gap-field';gap.setAttribute('aria-label','간격');
    gap.onchange=()=>{if(gap.value.trim())layoutIntent({type:'gap',value:gap.value.trim()},{});};
    const row=(label,...kids)=>h('div','lrow',h('span','llabel',label),h('div','lctl',...kids));
    const content=h('div','lgroup',
      h('div','lhead','안의 내용',h('span','muted',boxy?(grid?' · 그리드':' · 정렬 상자'):' · 일반 상자 (정렬하면 정렬 상자로 바뀝니다)')),
      row('방향',seg([['row','→ 가로'],['column','↓ 세로']],flow,v=>layoutIntent({type:'flow',value:v},{}),{disabled:grid,label:'방향'})),
      row('정렬',pad,h('div','lstack',seg([['pack','붙이기','시작 쪽에 모으기'],['between','사이 띄우기','양 끝에 붙이고 사이를 같게'],['evenly','고르게','간격을 모두 같게']],dist,v=>layoutIntent({type:'distribute',value:v},{dist:v}),{label:'분배'}))),
      row('간격',gap,h('span','muted',' 예: 8px, 1rem, var(--space-2)')));
    // Placement of the element in its parent.
    const pf=isFlex(parent?.display),pg=isGrid(parent?.display),noY=!pf&&!pg,inline=/^inline/.test(self.display||'')&&!pf&&!pg;
    const sx=ui.sx||self.placeX||null,sy=ui.sy||self.placeY||null;
    const place=h('div','lgroup',
      h('div','lhead','부모 안에서',parent?h('code',null,' '+parent.tag):null,h('span','muted',pf?' · 정렬 상자':pg?' · 그리드':' · 일반 상자')),
      row('가로',seg([['start','왼쪽'],['center','가운데'],['end','오른쪽'],['stretch','꽉 채움']],sx,v=>layoutIntent({type:'self',axis:'x',value:v},{sx:v}),{disabled:!parent||inline,label:'가로 위치'})),
      row('세로',seg([['start','위'],['center','가운데'],['end','아래'],['stretch','꽉 채움']],sy,v=>layoutIntent({type:'self',axis:'y',value:v},{sy:v}),{disabled:!parent||noY,label:'세로 위치'})),
      noY||inline?h('p','muted lnote',inline?LAYOUT_MSG.inline:'세로 위치는 부모가 정렬 상자일 때만 정할 수 있습니다. 위의 ‘부모 선택’으로 부모를 고르고 방향·정렬을 정하세요.'):null);
    const text=(data.el.ownText||data.el.text)?h('div','lgroup',h('div','lhead','글자'),
      row('정렬',seg([['left','왼쪽'],['center','가운데'],['right','오른쪽'],['justify','양쪽']],ui.text||{start:'left',end:'right','-webkit-left':'left','-webkit-center':'center'}[self.textAlign]||self.textAlign,v=>layoutIntent({type:'text',value:v},{text:v}),{label:'글자 정렬'}))):null;
    const where=h('div','ltarget',t.kind==='none'?h('span','warn','원본 위치를 몰라 미리보기만 됩니다'):[h('span','muted','저장 위치 '),h('code',null,t.label),' ',link(t.loc)],
      t.kind==='css'&&t.hits>1?h('span','muted',' · 이 규칙을 쓰는 '+t.hits+'개 요소가 함께 바뀝니다'):null,t.kind==='utility'?h('span','muted',' · Tailwind 클래스를 바꿉니다'):null);
    const body=h('div','layout'+(pending.has('layout')?' dirty':''),h('div','lbar',where,revertBtn('layout')),content,place,text);body.dataset.key='layout';
    return section('배치',null,body);
  }
  // ---- 수정 지도: before editing, where a change lands, what else it changes, and where the same decision is copied.
  // Results of host lookups for this pick: component usage, workspace scans of a literal.
  const map={usage:null,scans:new Map(),busy:new Set()};
  const COLOR_LIT=/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i,LEN_LIT=/(?<![\w.#-])-?\d*\.?\d+(?:px|rem)\b/;
  const LEN_KIND=/^(margin|padding|gap|row-gap|column-gap|border-radius|font-size|width|height|max-width|min-width|max-height|min-height|top|left|right|bottom|inset)/;
  // A hard-coded design value in a declaration: a color, or a length on spacing / radius / size properties.
  function literalOf(p,v){
    if(/var\(\s*--/.test(v)||p.startsWith('--'))return null;
    const c=String(v).match(COLOR_LIT);if(c&&!/^(transparent|currentcolor|inherit)$/i.test(c[0]))return {value:c[0],kind:'color'};
    const l=LEN_KIND.test(p)&&String(v).match(LEN_LIT);if(l&&!/^-?0(px|rem)?$/.test(l[0]))return {value:l[0],kind:'length'};
    return null;
  }
  const sameValue=(a,b,kind)=>kind==='color'?toHex(a)===toHex(b):String(a).trim()===String(b).trim();
  // An existing token with the same value (colors compared as resolved colors).
  function tokenFor(lit){return (data.tokens||[]).find(t=>(lit.kind==='color'?t.kind==='color':t.kind!=='color')&&sameValue(t.c||t.v,lit.value,lit.kind));}
  function suggestName(r,p,lit){
    const base=(r.selector.match(/[.#]([\w-]+)/)||[])[1]||'value';
    const n=lit.kind==='color'?'--'+base+'-'+({'background-color':'bg',background:'bg',color:'text','border-color':'border',border:'border'}[p]||p.replace(/-color$/,'')):
      '--'+(/radius/.test(p)?'radius':/font-size/.test(p)?'text':/width|height/.test(p)?'size':'space')+'-'+String(lit.value).replace(/(px|rem)$/,'').replace('.','_');
    let name=n,i=2;while((data.tokens||[]).some(t=>t.n===name))name=n+'-'+i++;
    return name;
  }
  function hardcoded(){
    const out=[];const main=data.rules.filter(r=>!r.base);
    main.forEach((r,i)=>{if(!r.loc?.save||r.loc.utility)return;for(const d of r.decls){if(d.over)continue;const lit=literalOf(d.p,d.v);if(lit)out.push({r,d,i,lit,key:'rule:'+i+':'+d.p});}});
    return out.slice(0,8);
  }
  const scanKey=(lit,p)=>lit.value.toLowerCase()+'|'+(lit.kind==='color'?'':p);
  function flash(o){api.postMessage({type:'flash',...o});}
  function mapSection(){
    const kids=[];
    // 1. What a change here also changes.
    const own=data.rules.find(r=>!r.base&&!r.from&&!r.inline&&!r.state&&r.loc?.save);
    if(own)kids.push(h('div','mrow',h('span','micon','◎'),h('div','mtext',
      h('div',null,'스타일 규칙 ',h('code',null,own.selector),' · ',own.hits>1?h('b',null,'화면의 '+own.hits+'개 요소'):'이 요소에만',own.hits>1?'에 함께 적용':' 적용'),
      h('div','mact',link(own.loc),own.hits>1?mapBtn('화면에서 보기',()=>flash({selector:own.selector})):null))));
    const comp=data.components.find(c=>!c.lib&&!c.block&&!c.server);
    if(comp){
      const u=map.usage&&map.usage.name===comp.name?map.usage:null;
      kids.push(h('div','mrow',h('span','micon','◇'),h('div','mtext',
        h('div',null,'컴포넌트 ',h('b',null,'<'+comp.name+'>'),u?[' · 프로젝트에서 ',h('b',null,u.count+'곳'),'에서 사용']:' · 컴포넌트를 고치면 쓰는 곳이 모두 바뀝니다'),
        u?h('div','mlist',u.items.map(it=>h('div',null,action('loc',it.label,()=>open(it.id),it.text)))):null,
        h('div','mact',comp.def!=null?mapBtn('정의 열기',()=>open(comp.def)):null,!u?mapBtn(map.busy.has('usage')?'찾는 중…':'사용 위치 찾기',()=>{map.busy.add('usage');api.postMessage({type:'usage',name:comp.name});render();}):null))));
    }
    // 2. The same look, made in several places.
    const a=data.alike;
    if(a&&(a.same||a.groups.length)){
      const lookCount=a.groups.reduce((n,g)=>n+g.count,0);
      kids.push(h('div','mrow',h('span','micon','≋'),h('div','mtext',
        a.same?h('div',null,'같은 클래스의 요소 ',h('b',null,a.same+'개'),' · 규칙을 고치면 함께 바뀝니다 ',mapBtn('화면에서 보기',()=>flash({group:-1}))):null,
        a.groups.length?[h('div',null,'모양은 같은데 ',h('b',null,'따로 만든 요소 '+lookCount+'개'),' · '+a.groups.length+'곳에서 정의'),
          h('div','mlist',a.groups.map((g,i)=>h('div',null,h('code',null,g.label),' '+g.count+'개 ',mapBtn('보기',()=>flash({group:i}))))),
          h('div','mhint','같은 디자인이 여러 곳에 복사돼 있습니다. 하나만 고치면 나머지는 그대로입니다. 아래 하드코딩 값을 토큰으로 만들면 이 값들을 한 번에 관리할 수 있습니다.')]:null)));
    }
    // 3. Hard-coded values → tokens.
    const lits=hardcoded();
    if(lits.length){
      const list=h('div','mlits');
      for(const {r,d,i,lit,key} of lits){
        const tok=tokenFor(lit),sk=scanKey(lit,d.p),scan=map.scans.get(sk);
        const cur=drafts.has(key)?drafts.get(key):d.v,done=/var\(\s*--/.test(cur);
        const row=h('div','mlit'+(pending.has(key)?' dirty':''),
          h('div','mlit-head',lit.kind==='color'?swatch(lit.value):null,h('code',null,d.p+': '+d.v),h('span','muted',' '+r.selector)),
          h('div','mact',
            tok&&!done?mapBtn('토큰 '+tok.n+'로 바꾸기',()=>{preview(key,payload(r,d,String(d.v).replace(lit.value,'var('+tok.n+')'),{mode:'css',token:tok.n,file:tok.file}),true);render();},'같은 값의 토큰이 이미 있습니다 · 이 선언만 바꿉니다 (저장 전 미리보기)'):null,
            done?h('span','ok','토큰 사용으로 바뀜 (저장 전)'):null,
            !scan?mapBtn(map.busy.has(sk)?'찾는 중…':'다른 곳도 찾기',()=>{map.busy.add(sk);api.postMessage({type:'scan-literal',value:lit.value,prop:lit.kind==='color'?undefined:d.p});render();},'같은 값을 직접 쓴 다른 CSS 위치를 찾습니다'):null));
        if(scan)row.append(scanBox(r,d,lit,tok,scan));
        list.append(row);
      }
      kids.push(h('div','mrow',h('span','micon','#'),h('div','mtext',h('div',null,'직접 쓴 값 ',h('b',null,lits.length+'개'),' · 토큰으로 바꾸면 한 곳에서 관리됩니다'),list)));
    }
    if(!kids.length)return null;
    return section('수정 지도',null,h('div','map',kids));
  }
  function scanBox(r,d,lit,tok,scan){
    const nameIn=h('input');nameIn.type='text';nameIn.value=tok?tok.n:suggestName(r,d.p,lit);nameIn.spellcheck=false;nameIn.setAttribute('aria-label','토큰 이름');
    const existing=()=>(data.tokens||[]).find(t=>t.n===nameIn.value.trim());
    const file=tok?.file||(data.tokens||[]).find(t=>t.file)?.file||null;
    const go=mapBtn('',()=>{const n=nameIn.value.trim();api.postMessage({type:'tokenize',value:lit.value,prop:lit.kind==='color'?undefined:d.p,name:n,create:!existing(),file});setFoot('preview','바꾸는 중…',pending.size>0);},'모든 CSS 파일의 같은 값을 var(토큰)으로 바꿉니다 · 한 번의 저장이라 되돌리기로 한 번에 원래대로');
    go.classList.add('primary');
    const label=()=>{go.textContent=(existing()?'':'토큰 만들고 ')+scan.count+'곳 모두 바꾸기';go.disabled=!scan.count||!/^--[A-Za-z][\w-]*$/.test(nameIn.value.trim());};
    nameIn.oninput=label;label();
    return h('div','mscan',
      h('div',null,'CSS ',h('b',null,scan.count+'곳'),' (파일 '+scan.files+'개)',scan.code.count?[' · 코드(JSX·HTML) ',h('b',null,scan.code.count+'곳'),' — 자동으로 바꾸지 않습니다']:null),
      h('div','mlist',scan.items.map(it=>h('div',null,action('loc',it.label,()=>open(it.id),it.text))),scan.code.items.map(it=>h('div','muted',action('loc',it.label,()=>open(it.id),it.text)))),
      scan.count?h('div','mform',nameIn,go):null);
  }
  function mapBtn(label,fn,title){const b=h('button','mbtn',label);b.type='button';if(title)b.title=title;b.onclick=fn;return b;}
  function render(){
    // Each pick has its own id from the host: two identical-looking elements (same tag and text) are still different targets.
    const id=data?data.sel:null;
    const same=id===identity;
    const scrollY=same?(document.documentElement.scrollTop||document.body.scrollTop||0):0;
    if(!same){
      if(pending.size)stale={items:[...pending],tag:lastTag};
      drafts.clear();committed.clear();pending.clear();wide.clear();saved.clear();batches.clear();pick=null;identity=id;saving=false;
      map.usage=null;map.scans.clear();map.busy.clear();
    }
    const keep=document.getElementById('status');
    root.textContent='';
    if(!data){
      root.append(h('p','empty','개발 화면에서 ‘요소 선택’으로 요소를 고르면 여기서 텍스트와 색을 바로 고칠 수 있습니다. 화면에는 즉시 반영됩니다.'));
      root.append(h('div','nav',action('navbtn','디자인 시스템',()=>api.postMessage({type:'open-palette'})),action('navbtn','화면 그리드',()=>api.postMessage({type:'open-screens'}))));
      return;
    }
    const e=data.el;
    lastTag='<'+e.tag+(e.id?'#'+e.id:'')+'>';
    if(stale){
      const sv=h('button','mode on','저장'),dc=h('button','mode','버리기');sv.onclick=saveStale;dc.onclick=()=>{stale=null;render();};
      root.append(h('div','note warn stale','이전 요소 '+stale.tag+'에서 저장하지 않은 변경 '+stale.items.length+'개 (화면 미리보기는 해제됨) ',sv,' ',dc));
    }
    const rel=(dir,label,title)=>{const b=h('button','mode',label);b.type='button';b.title=title;b.disabled=!data.doc;b.onclick=()=>api.postMessage({type:'select-relative',dir});return b;};
    root.append(h('div','head',h('code','tag','<'+e.tag+(e.id?'#'+e.id:'')+(e.classes.length?'.'+e.classes.slice(0,6).join('.'):'')+'>'),link(data.element),
      h('span','relnav',rel('parent','↑ 부모','이 요소를 감싸는 부모 요소 선택'),rel('child','↓ 자식','이 요소 안의 첫 요소 선택'))));
    root.append(h('div','nav',action('navbtn','디자인 시스템',()=>api.postMessage({type:'open-palette'})),action('navbtn','화면 그리드',()=>api.postMessage({type:'open-screens'}))));
    if(data.error)root.append(h('p','warn','일부 정보를 수집하지 못했습니다: '+data.error));
    root.append(h('p','hint','값을 바꾸면 화면에 바로 보이고, ',h('b',null,'소스에 저장'),'(Ctrl+S)을 눌러야 파일에 들어갑니다.'));
    const ms=mapSection();if(ms)root.append(ms);

    const text=e.ownText||e.text;
    const from=data.components.find(c=>c.props.some(p=>p.t));const p=from&&from.props.find(p=>p.t);
    const textId=from?.loc?.id ?? data.element.id, textOld=e.ownText||e.text||'';
    if(text||from){
      const ti=h('input');ti.type='text';ti.className='textedit';ti.value=drafts.has('text')?drafts.get('text'):text||'';ti.maxLength=200;
      const sendText=v=>({selId:data.sel,mode:'text',id:textId,value:v,old:committed.get('text')??textOld,text:v});
      ti.oninput=()=>preview('text',sendText(ti.value),!!data.element.save);
      const tw=h('div','editwrap textwrap'+(pending.has('text')?' dirty':''),ti,revertBtn('text'));tw.dataset.key='text';
      root.append(section('텍스트',null,[tw,h('div','row','요소 위치 ',link(data.element)),
        from?h('div','row','prop에서 전달: ',h('b',null,from.name),' ',h('code',null,p.k+'='+p.v),' ',link(from.loc),h('span','muted',' · 사용 위치의 문구가 저장됩니다')):null]));
    }

    if(data.layout)root.append(layoutSection());

    const comps=data.components.filter(c=>state.showLib||!c.lib),hidden=data.components.length-comps.length;
    const toggle=hidden||state.showLib?action('toggle',state.showLib?'라이브러리 내부 숨기기':'라이브러리 내부 '+hidden+'개 표시',()=>{state.showLib=!state.showLib;api.setState(state);render();}):null;
    root.append(section('컴포넌트 · 조건 (안쪽 → 바깥)',comps.length,[
      comps.length?h('ol','comps',comps.map(c=>h('li',c.block?'block':c.lib?'lib':null,
        h('div','row',h('b',null,c.name),c.server?h('span','badge','서버'):null,c.lib?h('span','badge','라이브러리'):null,c.kind==='definition'?h('span','badge','정의 파일'):null,link(c.loc),c.def!=null?action('def','정의 찾기',()=>open(c.def)):null),
        c.props.length?h('div','props',c.props.map(chip)):null))):h('p','muted','감지된 컴포넌트가 없습니다.'),toggle]));

    const main=data.rules.filter(r=>!r.base),base=data.rules.filter(r=>r.base);
    root.append(section('적용된 CSS 규칙 (위가 우선 · 바로 수정)',data.rules.length,[
      main.map((r,i)=>rule(r,'rule',i)),base.length?section('기본·리셋 규칙',base.length,base.map((r,i)=>rule(r,'base',i)),false):null,
      data.rules.length?null:h('p','muted','요소에 직접 일치하는 규칙이 없습니다.'),
      action('toggle','워크스페이스에서 CSS 후보 검색',()=>api.postMessage({type:'styles'}))]));
    if(data.states.length)root.append(section('상태별 규칙 (:hover, ::before 등)',data.states.length,data.states.map((r,i)=>rule(r,'state',i)),false));
    if(data.inherited.length)root.append(section('부모에서 상속 — 부모를 고치면 영향 받는 요소가 함께 바뀝니다',data.inherited.length,data.inherited.map((r,i)=>rule(r,'inh',i))));
    const hoverNote=data.hovered&&data.states.some(r=>/:hover/.test(r.state||''))?h('p','muted','선택 순간 마우스가 요소 위에 있어 :hover 값이 반영됐을 수 있습니다.'):null;
    if(data.computed.length)root.append(section('최종 계산값',null,[hoverNote,h('div','grid',data.computed.map(([p,v])=>[h('span','p',p),h('span','v',swatch(v),v)]))],false));
    if(data.vars.length)root.append(section('사용된 CSS 변수',data.vars.length,h('div','grid',data.vars.map(([p,v])=>[h('span','p',p),h('span','v',swatch(v),v||'(정의 없음)')]))));
    const st=h('div','status');st.id='status';if(keep){st.className=keep.className;st.textContent=keep.textContent;}
    else {st.className='status';st.textContent='값을 바꾸면 화면에 바로 보입니다. 파일에 쓰려면 저장을 누르세요.';}
    const save=h('button','save','소스에 저장');save.id='save';save.disabled=saving||!pending.size;save.onclick=saveAll;
    save.textContent=saving?'저장 중…':pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장';
    const cancel=h('button','ghostbtn','취소');cancel.id='cancel';cancel.type='button';cancel.title='저장하지 않은 변경을 모두 버리고 화면을 원래대로';cancel.onclick=cancelAll;
    const undo=h('button','ghostbtn','되돌리기');undo.id='undo';undo.type='button';undo.onclick=()=>{api.postMessage({type:'undo'});setFoot('preview','되돌리는 중…',pending.size>0);};
    root.append(h('div','foot',st,h('div','foot-actions',undo,cancel,save)));
    setFoot(null,null,pending.size>0);
    requestAnimationFrame(()=>{document.documentElement.scrollTop=scrollY;document.body.scrollTop=scrollY;});
  }
  window.addEventListener('message',e=>{
    if(e.data?.type==='data'){data=e.data.data;render();}
    if(e.data?.type==='status')setFoot(e.data.kind,e.data.message,pending.size>0);
    if(e.data?.type==='layout-decls')layoutApplied(e.data);
    if(e.data?.type==='usage'){map.usage=e.data;map.busy.delete('usage');render();}
    if(e.data?.type==='literal-scan'){const k=String(e.data.value).toLowerCase()+'|'+(e.data.prop||'');map.scans.set(k,e.data);map.busy.delete(k);render();}
    if(e.data?.type==='tokenize-result'){for(const k of [...map.scans.keys()])if(k.startsWith(String(e.data.value).toLowerCase()+'|'))map.scans.delete(k);render();}
    if(e.data?.type==='history'){history={canUndo:!!e.data.canUndo,label:e.data.label||''};setFoot(null,null,pending.size>0);}
    if(e.data?.type==='undone'){
      // Fields go back to what they showed before that save; the file itself was restored by the host.
      const prev=batches.get(e.data.batch);if(!prev)return;batches.delete(e.data.batch);
      for(const [k,v] of prev){
        if(v.had)committed.set(k,v.committed);else committed.delete(k);
        if(v.saved)saved.set(k,v.saved);else saved.delete(k);
        if(!pending.has(k)){if(v.had)drafts.set(k,v.committed);else drafts.delete(k);}
      }
      syncPreview();render();
    }
    if(e.data?.type==='save-result'){
      saving=false;
      const prev=new Map();
      for(const r of e.data.results||[]){
        if(!r.ok||String(r.key).startsWith('stale:'))continue;
        prev.set(r.key,{had:committed.has(r.key),committed:committed.get(r.key),saved:saved.get(r.key)});
        // Saved: the file now holds this value, so the next edit of the same declaration replaces it.
        if(drafts.has(r.key))committed.set(r.key,drafts.get(r.key));
        if(pending.has(r.key))saved.set(r.key,pending.get(r.key));
        pending.delete(r.key);
      }
      if(e.data.batch!=null&&prev.size)batches.set(e.data.batch,prev);
      markDirty();
      const failed=(e.data.results||[]).filter(r=>!r.ok);
      setFoot(e.data.kind,e.data.message+(failed.length>1?' (외 '+(failed.length-1)+'개 실패: '+failed.slice(1,3).map(r=>r.message).join(' / ')+')':''),pending.size>0);
    }
  });
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveAll();}});
  render();api.postMessage({type:'ready'});
})();
