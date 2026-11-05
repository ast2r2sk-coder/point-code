(()=>{
  const api=acquireVsCodeApi();const root=document.getElementById('root');
  const state=api.getState()||{showLib:false};let data=null,pick=null,identity='';
  const drafts=new Map(),committed=new Map(),pending=new Map(),wide=new Map();
  const h=(tag,cls,...kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;for(const k of kids.flat(Infinity)){if(k==null||k===false)continue;n.append(k instanceof Node?k:String(k));}return n;};
  const action=(cls,label,fn,title)=>{const a=h('a',cls,label);a.href='#';if(title)a.title=title;a.onclick=e=>{e.preventDefault();fn();};return a;};
  const open=id=>api.postMessage({type:'open',id});
  const link=loc=>loc?action('loc'+(loc.utility?' util':''),loc.label,()=>open(loc.id),'편집기에서 열기'):h('span','loc none','위치 없음');
  const swatch=v=>{const m=String(v).match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]*\)/i);if(!m)return null;const s=h('span','sw');s.style.background=m[0];return s;};
  const COLOR_PROP=/^(color|background-color|background|border-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color)$/;
  const colorish=(p,v)=>/url\(|gradient\(/i.test(v)?/var\(\s*--/.test(v):COLOR_PROP.test(p)||/^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\(|transparent$|currentcolor$|var\(\s*--)/i.test(String(v).trim());
  const kindFor=p=>COLOR_PROP.test(p)?'color':p==='font-weight'?'weight':p==='font-family'?'font':p==='font-size'?'size':/margin|padding|gap|radius/.test(p)?'space':null;
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
      mode,id:r.loc&&r.loc.id,prop:d.p,value,old:committed.get(r.loc?.id+':'+d.p)??d.v,token:extra?.token||tokenName,file:extra?.file||tok?.file,
      css:useToken?[]:[{selector:r.selector,prop:d.p,value,scope:r.loc?.utility?'element':'rule',from:r.from||null}],
      tokens:useToken&&tokenName?[{n:tokenName,v:value}]:[],
      highlight:useToken?{selector:null,from:null,broad:true}:{selector:r.selector,from:r.from||null,broad:broad(r.selector)}
    };
  }
  function setFoot(kind,message,canSave){
    const n=document.getElementById('status'),b=document.getElementById('save');
    if(n){n.className='status '+kind;n.textContent=message||'';}
    if(b){b.disabled=!canSave && pending.size===0;b.textContent=pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장';}
  }
  function preview(key,p,savable){
    drafts.set(key,p.value);
    api.postMessage({type:'preview',...p});
    if(savable){pending.set(key,p);setFoot('preview','화면 미리보기 · 파일은 아직입니다. ‘소스에 저장’을 누르세요.',true);}
    else setFoot('warn','화면만 바뀜 · 이 규칙은 번들 CSS라 프로젝트 파일이 없습니다. 저장되지 않습니다.',pending.size>0);
  }
  function saveAll(){
    if(!pending.size)return;
    const items=[...pending];pending.clear();
    setFoot('preview','파일에 쓰는 중…',false);
    for(const [,p] of items) api.postMessage({type:'edit',...p});
  }

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
    const apply=(value,extra)=>preview(key,payload(r,d,value,extra),!!(r.loc?.save||extra?.token));
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
          const item=h('div','item'+(on?' on':''),kind==='color'?(swatch(t.c||t.v)||h('span','sw')):null,h('code',null,t.n),h('span','muted',t.v));
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
    const push=v=>preview(key,payload(r,d,v,{mode:isWide?'token':undefined}),!!(isWide||r.loc?.save));
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
    if(r.from) notes.push(h('div','note parent','부모 '+(r.from)+' 의 규칙입니다. 여기 값을 바꾸면 이 부모를 상속하는 다른 요소도 함께 바뀝니다'+(r.kids? ' · 아래 요소 약 '+r.kids+'개':'')+'.'));
    else if(r.hits>1) notes.push(h('div','note','이 규칙 · 화면에서 '+r.hits+'개 요소에 적용됩니다. 바꾸면 모두 함께 미리보기됩니다.'));
    if(tokenName){
      const w=isWide;
      const all=h('button','mode'+(w?' on':''),'토큰 '+tokenName+' 전체');
      const one=h('button','mode'+(!w?' on':''),'이 규칙만');
      all.onclick=()=>{wide.set(r.loc?.id+':'+d.p,true);render();};
      one.onclick=()=>{wide.set(r.loc?.id+':'+d.p,false);render();};
      notes.push(h('div','note token','현재 값이 디자인 토큰입니다. ',all,' ',one, w?' · 토큰 정의를 고치면 이 토큰을 쓰는 모든 곳이 바뀝니다.':' · 이 규칙만 토큰에서 분리합니다.'));
    }
    if(r.loc?.utility) notes.push(h('div','note','className 유틸리티입니다. 저장 시 클래스 이름이 바뀝니다.'+((r.from)?' 부모 요소의 className을 고칩니다.':'')));
    if(!r.loc?.save) notes.push(h('div','note warn','미리보기만 · 원본 CSS 파일이 없습니다. Tailwind className 규칙은 저장됩니다. 번들 stylesheet는 화면 확인용입니다.'));
    return h('div','editwrap',h('div','edit',...rowKids),notes,pick&&pick.key===key?pickPanel(r,d,key):null);
  }
  function rule(r,kind,index){
    return h('div','rule'+(r.base?' base':'')+(r.from?' inherited':''),
      h('div','rhead',r.from?h('span','from','← '+r.from):null,h('code','sel',r.selector),r.hits>1?h('span','badge',r.hits+'개'):null,r.loc&&r.loc.save===false?h('span','badge warn','미리보기만'):null,r.state?h('span','badge state',r.state):null,r.ctx.map(c=>h('span','badge',c)),link(r.loc)),
      h('div','decls',r.decls.map(d=>editor(r,d,kind,index))));
  }
  function render(){
    const id=data?data.el.tag+'|'+(data.el.id||'')+'|'+(data.el.text||''):'';
    if(id!==identity){drafts.clear();committed.clear();pending.clear();wide.clear();pick=null;identity=id;}
    const keep=document.getElementById('status');
    root.textContent='';
    if(!data){root.append(h('p','empty','개발 화면에서 ‘요소 선택’으로 요소를 고르면 여기서 텍스트와 색을 바로 고칠 수 있습니다. 화면에는 즉시 반영됩니다.'));return;}
    const e=data.el;
    root.append(h('div','head',h('code','tag','<'+e.tag+(e.id?'#'+e.id:'')+(e.classes.length?'.'+e.classes.slice(0,6).join('.'):'')+'>'),link(data.element)));
    if(data.error)root.append(h('p','warn','일부 정보를 수집하지 못했습니다: '+data.error));
    root.append(h('p','hint','값을 바꾸면 화면은 바로 바뀝니다. 파일에 넣으려면 아래 ',h('b',null,'소스에 저장'),'을 누르세요. ',h('span','muted','‘미리보기만’ 규칙은 번들 CSS라 파일에는 안 들어갑니다.')));

    const text=e.ownText||e.text;
    const from=data.components.find(c=>c.props.some(p=>p.t));const p=from&&from.props.find(p=>p.t);
    const textId=from?.loc?.id ?? data.element.id, textOld=e.ownText||e.text||'';
    if(text||from){
      const ti=h('input');ti.type='text';ti.className='textedit';ti.value=drafts.has('text')?drafts.get('text'):text||'';ti.maxLength=200;
      const sendText=v=>({mode:'text',id:textId,value:v,old:committed.get('text')??textOld,text:v});
      ti.oninput=()=>preview('text',sendText(ti.value),!!data.element.save);
      root.append(section('텍스트',null,[ti,h('div','row','요소 위치 ',link(data.element)),
        from?h('div','row','prop에서 전달: ',h('b',null,from.name),' ',h('code',null,p.k+'='+p.v),' ',link(from.loc),h('span','muted',' · 사용 위치의 문구가 저장됩니다')):null]));
    }

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
    const save=h('button','save','소스에 저장');save.id='save';save.disabled=!pending.size;save.onclick=saveAll;
    save.textContent=pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장';
    root.append(h('div','foot',st,save));
  }
  window.addEventListener('message',e=>{
    if(e.data?.type==='data'){data=e.data.data;render();}
    if(e.data?.type==='status'){
      setFoot(e.data.kind,e.data.message,pending.size>0);
      if(e.data.kind==='saved') for(const [k,v] of drafts) committed.set(k,v);
    }
  });
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveAll();}});
  render();api.postMessage({type:'ready'});
})();
