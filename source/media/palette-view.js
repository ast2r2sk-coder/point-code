(()=>{
  const api=acquireVsCodeApi();const root=document.getElementById('root');
  let tokens=[],components=[],pending=new Map(),section='overview',history={canUndo:false,label:''};
  const KINDS=['color','font','weight','size','space','other'];
  const LABEL={color:'색',font:'타이포',weight:'굵기',size:'크기',space:'간격',other:'기타'};
  const h=(tag,cls,...kids)=>{const n=document.createElement(tag);if(cls)n.className=cls;for(const k of kids.flat(Infinity)){if(k==null||k===false)continue;n.append(k instanceof Node?k:String(k));}return n;};
  const btn=(cls,label,fn)=>{const b=h('button',cls,label);b.type='button';b.onclick=fn;return b;};
  function toHex(v){try{const c=h('span');c.style.color=v;root.append(c);const rgb=getComputedStyle(c).color;c.remove();const m=rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);return m?'#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join(''):'#888888';}catch{return '#888888';}}
  function setFoot(kind,msg){
    const n=document.getElementById('status'),b=document.getElementById('save');
    if(n&&kind!=null){n.className='status '+kind;n.textContent=msg||'';}
    if(b){b.disabled=!pending.size;b.textContent=pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장';}
    const c=document.getElementById('cancel');if(c)c.disabled=!pending.size;
    const u=document.getElementById('undo');if(u){u.disabled=!history.canUndo;u.title=history.canUndo?'마지막 저장 되돌리기 · '+history.label:'되돌릴 저장이 없습니다';}
  }
  // Typing must not rebuild the page (that would drop focus after every key and close the color picker mid-drag).
  function markDirty(){for(const el of root.querySelectorAll('[data-token]'))el.classList.toggle('dirty',pending.has(el.dataset.token));}
  function preview(n,v){pending.set(n,v);api.postMessage({type:'preview',n,v});markDirty();setFoot('preview','연결된 모든 화면에 미리보기 · ‘소스에 저장’으로 파일에 씁니다');}
  const field=(t,val,on)=>{const i=h('input');i.type='text';i.value=val;i.dataset.key=t.n+':text';i.setAttribute('aria-label',t.n);i.spellcheck=false;i.oninput=()=>{on?.(i.value);preview(t.n,i.value);};return i;};

  function colorSection(){
    const list=tokens.filter(t=>t.kind==='color');
    const box=h('section','block');
    box.append(h('h2',null,'Colors'),h('p','sub',list.length?'공통 색 토큰 · 클릭·입력으로 수정':'색 토큰이 없습니다. 페이지를 연 뒤 새로고침하세요.'));
    const grid=h('div','swatches');
    for(const t of list){
      const val=pending.has(t.n)?pending.get(t.n):t.v;
      const card=h('div','swatch'+(pending.has(t.n)?' dirty':''));card.dataset.token=t.n;
      const face=h('div','face');face.style.background=val;
      const inp=field(t,val,v=>{face.style.background=v;});
      const pick=h('input');pick.type='color';pick.value=toHex(val);pick.dataset.key=t.n+':color';pick.setAttribute('aria-label',t.n+' 색 선택');
      pick.oninput=()=>{inp.value=pick.value;face.style.background=pick.value;preview(t.n,pick.value);};
      card.append(face,h('code',null,t.n),h('div','row',pick,inp));
      if(t.file) card.append(btn('link','파일',()=>api.postMessage({type:'open',file:t.file})));
      grid.append(card);
    }
    box.append(grid);
    return box;
  }

  function typeSection(){
    const fonts=tokens.filter(t=>t.kind==='font');
    const weights=tokens.filter(t=>t.kind==='weight');
    const sizes=tokens.filter(t=>t.kind==='size');
    const box=h('section','block');
    box.append(h('h2',null,'Typography'));
    const specimens=h('div','specimens');
    const sampleFonts=fonts.length?fonts:[{n:'(기본)',v:'system-ui, sans-serif',c:'system-ui'}];
    for(const f of sampleFonts.slice(0,6)){
      const val=pending.has(f.n)?pending.get(f.n):f.v;
      const card=h('div','specimen');
      const sample=h('div','sample','가나다 ABC 123');
      sample.style.fontFamily=val;
      card.append(h('code',null,f.n),sample);
      if(f.n.startsWith('--')){
        card.dataset.token=f.n;if(pending.has(f.n))card.classList.add('dirty');
        card.append(field(f,val,v=>{sample.style.fontFamily=v;}));
      }
      specimens.append(card);
    }
    box.append(specimens);
    if(weights.length||sizes.length){
      const list=h('div','token-list');
      for(const t of [...weights,...sizes]){
        const val=pending.has(t.n)?pending.get(t.n):t.v;
        const row=h('div','trow'+(pending.has(t.n)?' dirty':''),h('code',null,t.n));row.dataset.token=t.n;
        row.append(field(t,val));
        list.append(row);
      }
      box.append(list);
    }
    return box;
  }

  function spaceSection(){
    const list=tokens.filter(t=>t.kind==='space'||t.kind==='size');
    const box=h('section','block');
    box.append(h('h2',null,'Spacing & Size'),h('p','sub','간격·라디우스·크기 토큰'));
    const listEl=h('div','token-list');
    for(const t of list){
      const val=pending.has(t.n)?pending.get(t.n):t.v;
      const row=h('div','trow'+(pending.has(t.n)?' dirty':''),h('code',null,t.n));row.dataset.token=t.n;
      const bar=h('div','space-bar');bar.style.width= /^\d/.test(val)?val:'24px';
      row.append(bar,field(t,val,v=>{if(/^\d/.test(v))bar.style.width=v;}));
      listEl.append(row);
    }
    if(!list.length) listEl.append(h('p','sub','간격 토큰이 없습니다.'));
    box.append(listEl);
    return box;
  }

  function componentsSection(){
    const box=h('section','block');
    box.append(h('h2',null,'Components'),h('p','sub',components.length?'워크스페이스 components / ui 폴더에서 모았습니다. 파일을 열어 수정하세요.':'components·ui 폴더를 찾지 못했습니다.'));
    const grid=h('div','comps');
    for(const c of components){
      const card=h('div','comp');
      card.append(h('div','comp-name',c.name),h('code','comp-path',c.rel));
      card.append(btn('link','소스 열기',()=>api.postMessage({type:'open',file:c.file})));
      grid.append(card);
    }
    box.append(grid);
    return box;
  }

  function render(keepStatus=true){
    const prev=keepStatus?document.getElementById('status'):null;
    // A refresh from the page may arrive while someone is typing: put the caret back where it was.
    const act=document.activeElement,key=act?.dataset?.key,sel=key&&act.type==='text'?[act.selectionStart,act.selectionEnd]:null,typed=key&&act.type==='text'?act.value:null,scroll=document.scrollingElement?.scrollTop||0;
    root.textContent='';
    root.append(h('header','hero',
      h('div',null,h('p','eyebrow','Point Code'),h('h1',null,'Design System')),
      h('div','hero-actions',btn('ghost','새로고침',()=>api.postMessage({type:'refresh'})),btn('ghost','화면 그리드',()=>api.postMessage({type:'open-screens'})))
    ));
    root.append(h('p','lede','토큰과 컴포넌트를 한곳에서 보고 고칩니다. 값을 바꾸면 연결된 미리보기·화면 보드에 바로 반영됩니다.'));

    const nav=h('nav','toc');
    for(const [id,label] of [['overview','전체'],['color','Colors'],['type','Typography'],['space','Spacing'],['components','Components']]){
      nav.append(btn('toc-btn'+(section===id?' on':''),label,()=>{section=id;render();}));
    }
    root.append(nav);

    const main=h('div','main');
    if(section==='overview'||section==='color') main.append(colorSection());
    if(section==='overview'||section==='type') main.append(typeSection());
    if(section==='overview'||section==='space') main.append(spaceSection());
    if(section==='overview'||section==='components') main.append(componentsSection());
    if(!tokens.length&&!components.length) main.append(h('p','empty','아직 데이터가 없습니다. Point Code: Start로 앱을 연결한 뒤 새로고침하세요.'));
    root.append(main);

    const st=h('div','status');st.id='status';
    if(prev){st.className=prev.className;st.textContent=prev.textContent;}
    else st.textContent=tokens.length?'토큰 '+tokens.length+' · 컴포넌트 '+components.length+' · 변경 '+pending.size:'';
    // ↺ on every token card/row; visible only while that token has an unsaved change.
    for(const el of main.querySelectorAll('[data-token]')){
      const r=btn('revert','↺',()=>api.postMessage({type:'discard',n:el.dataset.token}));r.title='이 토큰 되돌리기 (저장 전)';r.setAttribute('aria-label',el.dataset.token+' 되돌리기');
      (el.querySelector('.row')||el).append(r);
    }
    const save=btn('save',pending.size?'소스에 저장 ('+pending.size+')':'소스에 저장',()=>api.postMessage({type:'save'}));
    save.id='save';save.disabled=!pending.size;
    const cancel=btn('ghost','취소',()=>api.postMessage({type:'discard'}));cancel.id='cancel';cancel.title='저장하지 않은 변경을 모두 버리고 화면을 원래대로';
    const undo=btn('ghost','되돌리기',()=>api.postMessage({type:'undo'}));undo.id='undo';
    root.append(h('div','foot',st,undo,cancel,save));
    setFoot(null,null);
    // The refresh may carry an older value than what was just typed: the focused field keeps the user's text.
    if(key){const n=[...root.querySelectorAll('[data-key]')].find(x=>x.dataset.key===key);if(n){if(typed!=null&&n.value!==typed){n.value=typed;if(key.endsWith(':text')){pending.set(key.slice(0,-5),typed);markDirty();}}n.focus();if(sel)try{n.setSelectionRange(sel[0],sel[1]);}catch{}}}
    if(document.scrollingElement)document.scrollingElement.scrollTop=scroll;
  }

  window.addEventListener('message',e=>{
    if(e.data?.type==='palette'){
      tokens=e.data.tokens||[];
      components=e.data.components||[];
      pending=new Map((e.data.pending||[]).map(p=>[p.n,p.v]));
      render();
    }
    if(e.data?.type==='pending'){pending=new Map((e.data.pending||[]).map(p=>[p.n,p.v]));markDirty();setFoot('preview',document.getElementById('status')?.textContent||'');}
    if(e.data?.type==='status')setFoot(e.data.kind,e.data.message);
    if(e.data?.type==='history'){history={canUndo:!!e.data.canUndo,label:e.data.label||''};setFoot(null,null);}
  });
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();api.postMessage({type:'save'});}});
  render();api.postMessage({type:'ready'});
})();
