(()=>{
  if(window.__pointCodeCleanup) window.__pointCodeCleanup();
  const endpoint=__POINT_ENDPOINT__;
  // Screens board frames are thumbnails: no picker UI, no SSE (browsers allow ~6 connections per host), no polling.
  // They get live previews from the board webview (their parent) by postMessage instead.
  const BOARD=window.name==='point-code-board'&&window.parent!==window;
  const DOC=Math.random().toString(36).slice(2,12);
  let active=false,last=null;
  const host=document.createElement('div');host.setAttribute('data-point-code-ui','');
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow=host.attachShadow({mode:'open'});
  // The picker lives inside the user's page, where VS Code theme variables do not exist: its look is defined here, once.
  const THEME={
    accent:'#0a84ff',onAccent:'#fff',accentFill:'rgb(10 132 255 / .12)',inherit:'#ff9f0a',affected:'#64d2ff',
    glass:'rgb(28 28 30 / .72)',glassBorder:'rgb(255 255 255 / .14)',glassBlur:'saturate(180%) blur(20px)',
    label:'#f5f5f7',fill:'rgb(255 255 255 / .12)',fillHover:'rgb(255 255 255 / .2)',shadow:'0 8px 32px rgb(0 0 0 / .35)',
    font:'500 12px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif',radius:'999px'
  };
  shadow.innerHTML=`<style>*{box-sizing:border-box}
.box{display:none;position:fixed;border:2px solid ${THEME.accent};border-radius:3px;background:${THEME.accentFill};pointer-events:none}
.label{position:fixed;display:none;max-width:90vw;padding:4px 8px;border-radius:6px;background:${THEME.accent};color:${THEME.onAccent};font:${THEME.font};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:${THEME.shadow}}
.bar{position:fixed;bottom:16px;right:16px;display:flex;gap:6px;align-items:center;padding:6px 6px 6px 14px;border:.5px solid ${THEME.glassBorder};border-radius:${THEME.radius};
  background:${THEME.glass};-webkit-backdrop-filter:${THEME.glassBlur};backdrop-filter:${THEME.glassBlur};color:${THEME.label};font:${THEME.font};box-shadow:${THEME.shadow};pointer-events:auto}
span{max-width:220px;opacity:.85}
button{height:28px;padding:0 14px;border:0;border-radius:${THEME.radius};background:${THEME.fill};color:${THEME.label};font:${THEME.font};cursor:pointer;transition:background .16s}
button:hover{background:${THEME.fillHover}}
button.pick{background:${THEME.accent};color:${THEME.onAccent}}
button:focus-visible{outline:2px solid ${THEME.accent};outline-offset:2px}
</style><div class="box"></div><div class="label"></div><div class="bar"><span>Point Code</span><button class="snap" title="지금 보이는 화면을 화면 그리드에 고정">화면 담기</button><button class="pick">요소 선택</button></div>`;
  if(!BOARD)document.documentElement.append(host);
  const box=shadow.querySelector('.box'),label=shadow.querySelector('.label'),button=shadow.querySelector('.pick'),status=shadow.querySelector('span');
  function toggle(v){active=v;button.textContent=v?'선택 중 · Esc':'요소 선택';if(!v){box.style.display=label.style.display='none';last=null;}}
  button.onclick=()=>toggle(!active);
  shadow.querySelector('.snap').onclick=()=>void snapshot();
  function isUI(e){return e.composedPath().includes(host);}
  function move(e){if(!active||isUI(e))return;const el=e.composedPath()[0];if(!(el instanceof Element))return;last=el;const r=el.getBoundingClientRect();Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});label.textContent=el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+' '+Array.from(el.classList).slice(0,4).join('.');Object.assign(label.style,{display:'block',left:Math.max(0,r.left)+'px',top:Math.max(0,r.top-28)+'px'});}
  const FRAME=/((?:https?|webpack-internal|file):\/\/\/?\S+?):(\d+):(\d+)\)?\s*$/;
  // React 19 removed _debugSource; the JSX call site survives only in the dev stack. Line numbers there are post-transform, so approx.
  function stackSource(stack){
    for(const line of String(stack||'').split('\n').slice(1)){
      const m=line.match(FRAME);
      if(m&&!/\/node_modules\/|\/\.vite\/deps\/|\/_next\/static\/|react-dom|jsx-dev-runtime/.test(m[1]))return {file:m[1],line:+m[2],column:+m[3],approx:true};
    }
    return null;
  }
  function source(el){
    // Explicit compile-time attributes are stable; framework dev metadata is best effort only.
    for(let n=el;n;n=n.parentElement){
      const raw=n.getAttribute('data-point-source');if(raw){try{return JSON.parse(raw);}catch{}}
      const vi=n.getAttribute('data-v-inspector')?.match(/^(.+):(\d+):(\d+)$/);if(vi)return {file:vi[1],line:+vi[2],column:+vi[3]};
      // Svelte 4 lines are 0-based and carry `char`; Svelte 5 lines are 1-based. Columns are 0-based in both.
      const sv=n.__svelte_meta?.loc;if(sv?.file)return {file:sv.file,line:sv.line+('char' in sv?1:0),column:sv.column+1};
    }
    const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
    let f=key&&el[key];
    for(let i=0;f&&i<40;i++,f=f.return){
      const s=f._debugSource;if(s?.fileName)return {file:s.fileName,line:s.lineNumber,column:s.columnNumber||1};
      const fromStack=f._debugStack&&stackSource(f._debugStack.stack);if(fromStack)return fromStack;
    }
    for(let n=el;n;n=n.parentElement){const file=n.__vueParentComponent?.type?.__file;if(file)return {file,approx:true};}
    return null;
  }
  function ownText(el){return Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim().replace(/\s+/g,' ').slice(0,160);}

  // ---- Inspector: component chain with props, matched CSS rules, inherited and computed styles.
  const short=v=>v===null?'null':v===undefined?'undefined':typeof v==='function'?'ƒ':typeof v==='string'?JSON.stringify(v.length>60?v.slice(0,60)+'…':v):typeof v!=='object'?String(v):Array.isArray(v)?'['+v.length+']':v.$$typeof?'<element>':'{…}';
  // React's dev serializer replaces unserializable server props (e.g. params promises) with this placeholder sentence.
  const OMITTED=/^This object has been omitted by React/;
  // `t` marks a string prop that is (part of) the visible text, i.e. where to edit the wording.
  function propsOf(p,text){const out=[];if(!p||typeof p!=='object')return out;for(const k of Object.keys(p)){if(k==='children'||k==='key'||k==='ref'||k.startsWith('__')||out.length>=16)continue;let v;try{v=p[k];}catch{continue;}if(typeof v==='string'&&OMITTED.test(v))v={};out.push({k,v:short(v),b:typeof v==='boolean'?v:undefined,t:typeof v==='string'&&v.trim().length>2&&text.includes(v.trim())||undefined});}return out;}
  const RUNTIME=/jsxDEV|\bjsxs?\b|createElement|jsx-dev-runtime|react_jsx|react-stack-top-frame/;
  function callSite(stack){for(const line of String(stack||'').split('\n').slice(1)){if(RUNTIME.test(line))continue;const m=line.match(FRAME);return m?{url:m[1],line:+m[2],column:+m[3]}:null;}return null;}
  function reactName(t){if(typeof t==='function')return t.displayName||t.name;if(t&&typeof t==='object')return t.displayName||reactName(t.render)||reactName(t.type);}
  // Server Components (Next.js App Router) have no client fiber; React 19 dev keeps their name/props in `_debugInfo`.
  // Their stack points at compiled server chunks unless the bundler keeps original paths (webpack-internal).
  function serverComponents(f,text,seen){
    const out=[];
    for(const x of (Array.isArray(f._debugInfo)?f._debugInfo:[]).slice().reverse()){
      if(!x||typeof x.name!=='string'||seen.has(x))continue;seen.add(x);
      const fr=Array.isArray(x.stack)&&Array.isArray(x.stack[0])?x.stack[0]:null,file=fr&&typeof fr[1]==='string'?fr[1]:'';
      const lib=/node_modules/.test(file),usable=file&&!lib&&!/[\\/]\.next[\\/]|^about:/.test(file);
      out.push({name:x.name,kind:'usage',server:true,source:usable?{file,line:fr[2],column:fr[3]||1,approx:true}:null,lib,props:propsOf(x.props,text)});
    }
    return out;
  }
  // `lib`: the element was created inside library code (framework internals), hidden by default in the view.
  function reactChain(el,text){
    const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));const out=[],seen=new Set();
    for(let f=key&&el[key],i=0;f&&i<300&&out.length<25;f=f.return,i++){
      out.push(...serverComponents(f,text,seen));
      if(!f.type||typeof f.type==='string')continue;const name=reactName(f.type);if(!name)continue;
      let source=null,lib=true;const ds=f._debugSource;
      if(ds?.fileName){lib=/node_modules/.test(ds.fileName);source={file:ds.fileName,line:ds.lineNumber,column:ds.columnNumber||1};}
      else{const cs=f._debugStack&&callSite(f._debugStack.stack);if(cs){lib=/node_modules/.test(cs.url);if(!lib&&!/\/_next\/static\//.test(cs.url))source={file:cs.url,line:cs.line,column:cs.column,approx:true};}}
      out.push({name,kind:'usage',source,lib,props:propsOf(f.memoizedProps,text)});
    }
    return out;
  }
  function vueChain(el,text){
    let n=el;while(n&&!n.__vueParentComponent)n=n.parentElement;const out=[];
    for(let c=n?.__vueParentComponent,i=0;c&&i<25;c=c.parent,i++){const t=c.type||{},file=typeof t.__file==='string'?t.__file:'';const lib=!file||/node_modules/.test(file);
      out.push({name:t.name||t.__name||(file.split(/[\\/]/).pop()||'Anonymous').replace(/\.vue$/,''),kind:'definition',source:lib?null:{file,approx:true},lib,props:propsOf(c.props,text)});}
    return out;
  }
  // Svelte 5 dev_stack: components plus {#if}/{#each}/{#await} blocks; lines 1-based, columns 0-based.
  function svelteChain(el){
    let n=el;while(n&&!n.__svelte_meta)n=n.parentElement;const out=[];
    for(let s=n?.__svelte_meta?.parent,i=0;s&&i<40;s=s.parent,i++){const comp=s.type==='component';
      out.push({name:comp?(s.componentTag||'component'):'{#'+s.type+'}',kind:'usage',block:!comp,source:s.file?{file:s.file,line:s.line,column:(s.column||0)+1}:null,lib:!s.file||/node_modules/.test(s.file),props:[]});}
    return out;
  }
  const is=(r,n)=>typeof window[n]==='function'&&r instanceof window[n];
  const PSEUDO=/::?(?:hover|focus-visible|focus-within|focus|active|visited|checked|disabled|placeholder-shown|before|after|placeholder|marker|selection|first-line|first-letter)\b/g;
  const INHERIT=new Set(['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','white-space','word-break','visibility','cursor']);
  function splitList(sel){const out=[];let depth=0,cur='';for(const ch of sel){if(ch==='('||ch==='[')depth++;else if(ch===')'||ch===']')depth--;if(ch===','&&!depth){out.push(cur.trim());cur='';}else cur+=ch;}if(cur.trim())out.push(cur.trim());return out;}
  function specificity(sel){
    const s=sel.replace(/\\./g,'x').replace(/:where\((?:[^()]|\([^()]*\))*\)/g,'').replace(/\[[^\]]*\]/g,' .a ').replace(/"[^"]*"|'[^']*'/g,'');
    const a=(s.match(/#[\w-]+/g)||[]).length,b=(s.match(/\.[\w-]+|:(?!:|is\(|not\(|has\(|where\()[\w-]+/g)||[]).length,c=(s.match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*|::[\w-]+/g)||[]).length;
    return a*10000+b*100+c;
  }
  // Authored declarations from cssText keep shorthands (`padding: 8px 16px`) as written.
  function decls(style){const out=[];let depth=0,cur='';const push=s=>{const i=s.indexOf(':');if(i<1)return;const v=s.slice(i+1).trim();out.push({p:s.slice(0,i).trim(),v:v.replace(/\s*!important$/,''),imp:/!important$/.test(v)});};
    for(const ch of style.cssText){if(ch==='(')depth++;else if(ch===')')depth--;if(ch===';'&&!depth){push(cur);cur='';}else cur+=ch;}push(cur);return out.slice(0,40);}
  // The pointer is over the element while picking, so transient states always go to the state list, never the applied cascade.
  const TRANSIENT=/:(?:hover|active|focus-visible|focus-within|focus)\b/;
  function matchPart(target,sel){
    if(!TRANSIENT.test(sel)){try{if(target.matches(sel))return {ok:true};}catch{return null;}}
    let bare=sel.replace(PSEUDO,'').trim();if(bare===sel.trim())return null;if(!bare||/[\s>+~(]$/.test(bare))bare+='*';
    try{return target.matches(bare)?{ok:false,state:(sel.match(PSEUDO)||[]).join('')}:null;}catch{return null;}
  }
  function sheetInfo(sheet){const id=sheet.ownerNode?.getAttribute?.('data-vite-dev-id');return id?{file:id}:sheet.href?{file:sheet.href}:{label:sheet.ownerNode?.tagName==='STYLE'?'<style>':'stylesheet'};}
  function collectRules(targets){
    const hits=targets.map(()=>[]);let order=0;const layers=new Map();const rank=n=>{if(!layers.has(n))layers.set(n,layers.size);return layers.get(n);};
    const visit=(list,info,ctx,layer,parent)=>{for(const r of list){order++;
      if(is(r,'CSSKeyframesRule')||is(r,'CSSFontFaceRule')||is(r,'CSSStartingStyleRule'))continue;
      if(is(r,'CSSStyleRule')||(parent&&r.style&&r.selectorText===undefined)){
        const own=r.selectorText;
        const display=own===undefined?parent.display:parent?(own.includes('&')?own.replaceAll('&',parent.display):parent.display+' '+own):own;
        const match=own===undefined?parent.match:parent?(own.includes('&')?own.replaceAll('&',':is('+parent.match+')'):':is('+parent.match+') '+own):own;
        if(r.style.length){const longs=Array.from(r.style),inh=longs.some(p=>INHERIT.has(p));
          targets.forEach((t,ti)=>{if(ti&&!inh)return;let best=null;
            for(const part of splitList(match)){const m=matchPart(t,part);if(!m)continue;const spec=specificity(part);if(!best||(m.ok&&!best.ok)||(m.ok===best.ok&&spec>best.spec))best={...m,spec};}
            if(best&&(ti===0||best.ok))hits[ti].push({...best,style:r.style,longs,display,nest:parent?own:undefined,info,ctx,layer:layer==null?Infinity:rank(layer),order});});}
        if(r.cssRules?.length)visit(r.cssRules,info,ctx,layer,{display,match});
      }else if(is(r,'CSSMediaRule')){if(matchMedia(r.media.mediaText).matches)visit(r.cssRules,info,[...ctx,'@media '+r.media.mediaText],layer,parent);}
      else if(is(r,'CSSLayerBlockRule')){const n=layer?layer+'.'+r.name:r.name;rank(n);visit(r.cssRules,info,[...ctx,'@layer '+(r.name||'(익명)')],n,parent);}
      else if(is(r,'CSSLayerStatementRule')){for(const n of r.nameList)rank(layer?layer+'.'+n:n);}
      else if(is(r,'CSSImportRule')){try{if(r.styleSheet)visit(r.styleSheet.cssRules,sheetInfo(r.styleSheet),ctx,r.layerName??layer,parent);}catch{}}
      else if(is(r,'CSSSupportsRule')){if(CSS.supports(r.conditionText))visit(r.cssRules,info,[...ctx,'@supports '+r.conditionText],layer,parent);}
      else if(r.cssRules)visit(r.cssRules,info,[...ctx,'@'+(r.conditionText||r.constructor.name)],layer,parent);
    }};
    for(const sh of [...document.styleSheets,...(document.adoptedStyleSheets||[])]){if(sh.ownerNode?.closest?.('[data-point-code-ui]')||sh.ownerNode?.hasAttribute?.('data-point-code-live'))continue;let list;try{list=sh.cssRules;}catch{continue;}visit(list,sheetInfo(sh),[],null,null);}
    return hits;
  }
  const cmp=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;};
  // Cascade order: !important (layers reversed), then layer (unlayered last = strongest), specificity, source order.
  const weight=(h,imp)=>[imp?1:0,imp?-h.layer:h.layer,h.spec,h.order];
  function cascade(hits){
    const win=new Map();
    for(const h of hits)for(const p of h.longs){const k=weight(h,h.style.getPropertyPriority(p)==='important');const w=win.get(p);if(!w||cmp(k,w.k)>0)win.set(p,{h,k});}
    for(const h of hits)h.decls=decls(h.style).map(d=>{const ls=h.longs.filter(p=>p===d.p||p.startsWith(d.p+'-'));return {...d,over:(ls.length?ls:[d.p]).every(p=>win.has(p)&&win.get(p).h!==h)};});
    return win;
  }
  const describe=n=>n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+Array.from(n.classList).slice(0,2).map(c=>'.'+c).join('');
  const countSel=sel=>{try{return document.querySelectorAll(sel).length;}catch{return 0;}};
  const ruleOut=h=>({selector:h.display,nest:h.nest,file:h.info.file||null,label:h.info.label||null,ctx:h.ctx,state:h.state||null,inline:!!h.inline,hits:countSel(h.display),decls:h.decls});
  function looksColor(v){
    const s=String(v||'').trim();if(!s)return false;
    try{return CSS.supports('color',s)&&!/^(inherit|initial|unset|revert|none)$/i.test(s);}catch{return /^#|^rgba?\(|^hsla?\(|oklch|oklab|^lab\(|^lch\(|^hwb\(|^color\(/i.test(s);}
  }
  // Classify --tokens from :root/@theme so the inspector can offer pickers (color, weight, font, size, space).
  function tokenKind(n,v){
    if(/color|background|foreground|fill|stroke|accent|brand|tint|shade/i.test(n)||looksColor(v))return 'color';
    if(/weight/i.test(n)||/^(100|200|300|400|500|600|700|800|900)$/.test(v))return 'weight';
    if(/font-size|text-size|^--text-/i.test(n)||/^\d+(\.\d+)?(px|rem|em)$/.test(v)&&/size|text|leading/i.test(n))return 'size';
    if(/font-family|^--font-(?!weight|size)/i.test(n)||/,/.test(v)&&/sans|serif|mono|system|arial|helvetica|inter|pretendard/i.test(v))return 'font';
    if(/spacing|space|gap|radius|size/i.test(n)||/^\d+(\.\d+)?(px|rem|em)$/.test(v))return 'space';
    return 'other';
  }
  function designTokens(){
    const out=[],seen=new Set(),root=getComputedStyle(document.documentElement);
    const add=(n,raw,file,sel)=>{
      if(!n.startsWith('--')||seen.has(n)||out.length>=200)return;
      const c=root.getPropertyValue(n).trim()||raw;if(!c)return;
      const kind=tokenKind(n,c);if(kind==='other'&&!/font|weight|size|color|space|radius|gap/i.test(n))return;
      seen.add(n);out.push({n,v:raw||c,c,kind,file:file||null,sel:sel||null});
    };
    const walk=(list,info)=>{for(const r of list){try{if(r.style){for(const p of Array.from(r.style))if(p.startsWith('--'))add(p,r.style.getPropertyValue(p).trim(),info.file,r.selectorText);}if(is(r,'CSSImportRule')&&r.styleSheet)walk(r.styleSheet.cssRules,sheetInfo(r.styleSheet));else if(r.cssRules)walk(r.cssRules,info);}catch{}}};
    for(const sh of [...document.styleSheets,...(document.adoptedStyleSheets||[])]){if(sh.ownerNode?.hasAttribute?.('data-point-code-live'))continue;let list;try{list=sh.cssRules;}catch{continue;}walk(list,sheetInfo(sh));}
    try{for(const p of root)if(p.startsWith('--'))add(p,root.getPropertyValue(p).trim(),null,':root');}catch{}
    return out;
  }
  // Fixed scales used when the page has no design tokens for that axis (still prefer tokens when present).
  const WEIGHT_SCALE=[['Thin','100','font-thin'],['Extra Light','200','font-extralight'],['Light','300','font-light'],['Normal','400','font-normal'],['Medium','500','font-medium'],['Semibold','600','font-semibold'],['Bold','700','font-bold'],['Extra Bold','800','font-extrabold'],['Black','900','font-black']].map(([label,value,util])=>({label,value,util}));
  const FONT_SCALE=[['Sans','sans-serif','font-sans'],['Serif','serif','font-serif'],['Mono','monospace','font-mono']].map(([label,value,util])=>({label,value,util}));
  const COMPUTED=['color','background-color','font-family','font-size','font-weight','line-height','letter-spacing','text-align','margin','padding','border','border-radius','width','height','display','gap','box-shadow','opacity'];
  // Where the element sits in its parent's content box (start / center / end / stretch), per axis.
  function placement(a,b,size,inner){const s=a<2&&b<2?'stretch':Math.abs(a-b)<2?'center':a<2?'start':b<2?'end':'';return size>=inner-1&&s!=='stretch'?'stretch':s;}
  function layoutOf(el,cs){
    const p=el.parentElement,ps=p&&getComputedStyle(p),r=el.getBoundingClientRect();
    const self={display:cs.display,dir:cs.flexDirection,wrap:cs.flexWrap,justify:cs.justifyContent,align:cs.alignItems,justifyItems:cs.justifyItems,gap:cs.columnGap,textAlign:cs.textAlign,alignSelf:cs.alignSelf,justifySelf:cs.justifySelf,kids:el.children.length};
    if(!p||p===document.documentElement)return {self,parent:null};
    const pr=p.getBoundingClientRect(),n=k=>parseFloat(ps[k])||0;
    const left=pr.left+n('borderLeftWidth')+n('paddingLeft'),right=pr.right-n('borderRightWidth')-n('paddingRight');
    const top=pr.top+n('borderTopWidth')+n('paddingTop'),bottom=pr.bottom-n('borderBottomWidth')-n('paddingBottom');
    self.fullWidth=Math.abs(r.width-(right-left))<2;
    self.placeX=placement(r.left-left,right-r.right,r.width,right-left);
    self.placeY=placement(r.top-top,bottom-r.bottom,r.height,bottom-top);
    return {self,parent:{tag:describe(p),display:ps.display,dir:ps.flexDirection}};
  }
  // 수정 지도: elements on this page that share the pick's class list, and look-alikes (same tag and key computed styles)
  // that are styled from somewhere else — the same design decision made in several places.
  const LOOK=['color','background-color','font-size','font-weight','border-top-left-radius','padding-top','padding-left','border-top-width','border-top-color'];
  let lastAlike={same:[],groups:[]};
  function alikeOf(el){
    const sig=s=>LOOK.map(k=>s.getPropertyValue(k)).join('|'),me=sig(getComputedStyle(el)),cls=[...el.classList].sort().join(' ');
    const same=[],groups=new Map();
    for(const n of [...document.body.getElementsByTagName(el.tagName)].slice(0,400)){
      if(n===el||host.contains(n))continue;const r=n.getBoundingClientRect();if(!r.width||!r.height)continue;
      if(cls&&[...n.classList].sort().join(' ')===cls){same.push(n);continue;}
      if(sig(getComputedStyle(n))!==me)continue;
      const label=n.classList.length?'.'+[...n.classList].slice(0,3).join('.'):n.getAttribute('style')?'style 속성':'<'+n.tagName.toLowerCase()+'> (클래스 없음)';
      if(!groups.has(label))groups.set(label,[]);groups.get(label).push(n);
    }
    lastAlike={same,groups:[...groups.values()].slice(0,8)};
    return {same:same.length,sameSelector:cls?'.'+[...el.classList].map(c=>CSS.escape(c)).join('.'):null,groups:[...groups].slice(0,8).map(([label,list])=>({label,count:list.length}))};
  }
  function inspect(el,text){
    const components=(Object.keys(el).some(k=>k.startsWith('__reactFiber$'))?reactChain(el,text):[]).concat(vueChain(el,text),svelteChain(el));
    const ancestors=[];for(let n=el.parentElement;n&&ancestors.length<8;n=n.parentElement)ancestors.push(n);
    const hits=collectRules([el,...ancestors]);
    const own=hits[0].filter(h=>h.ok),states=hits[0].filter(h=>!h.ok);
    if(el.style?.length)own.push({ok:true,inline:true,style:el.style,longs:Array.from(el.style),display:'style 속성',info:{label:'inline'},ctx:[],layer:Infinity,spec:1e9,order:Infinity});
    const win=cascade(own);for(const h of states)h.decls=decls(h.style);
    own.sort((a,b)=>cmp(weight(b,false),weight(a,false)));
    const inherited=[],seen=new Set(win.keys());
    ancestors.forEach((n,i)=>{const w=cascade(hits[i+1]);const by=new Map();
      for(const [p,{h}] of w){if(!INHERIT.has(p)||seen.has(p))continue;seen.add(p);if(!by.has(h))by.set(h,[]);by.get(h).push(p);}
      for(const [h,props] of by)inherited.push({from:describe(n),fromClasses:Array.from(n.classList).slice(0,50),fromSource:source(n),kids:n.querySelectorAll('*').length,...ruleOut(h),decls:h.decls.filter(d=>props.some(p=>p===d.p||p.startsWith(d.p+'-')||d.p==='font'))});});
    const cs=getComputedStyle(el);
    const vars=[...new Set(own.flatMap(h=>h.decls.flatMap(d=>[...d.v.matchAll(/var\(\s*(--[\w-]+)/g)].map(m=>m[1]))))].slice(0,30).map(v=>[v,cs.getPropertyValue(v).trim()]);
    return {hovered:el.matches(':hover'),components,rules:own.slice(0,60).map(ruleOut),states:states.slice(0,30).map(ruleOut),inherited:inherited.slice(0,12),computed:COMPUTED.map(p=>[p,cs.getPropertyValue(p)]).filter(([,v])=>v),vars,tokens:designTokens(),scales:{weight:WEIGHT_SCALE,font:FONT_SCALE},layout:layoutOf(el,cs),alike:(()=>{try{return alikeOf(el);}catch{return null;}})()};
  }

  // Live preview from the inspector: CSS overlay, root token overrides, text, and outlines of affected elements.
  const liveStyle=document.createElement('style');liveStyle.setAttribute('data-point-code-live','');
  const liveMark=document.createElement('style');liveMark.setAttribute('data-point-code-live','');liveMark.textContent=`[data-point-picked]{outline:2px solid ${THEME.accent};outline-offset:1px}[data-point-from]{outline:2px dashed ${THEME.inherit};outline-offset:2px}[data-point-affected]{outline:2px dashed ${THEME.affected};outline-offset:2px}`;
  document.documentElement.append(liveStyle,liveMark);
  // Token previews per channel: the Design System board and the inspector each own theirs, so one never erases the other.
  let picked=null,origText=null,es,esTimer,poll;const tokenSets={palette:new Map(),inspector:new Map()},applied=new Set();
  const okVal=v=>typeof v==='string'&&v.length<=300&&!/[{}]|<\/|javascript:/i.test(v);
  const okProp=p=>typeof p==='string'&&/^-{0,2}[\w-]+$/.test(p);
  const clearAttr=a=>document.querySelectorAll('['+a+']').forEach(n=>n.removeAttribute(a));
  function restoreText(){if(picked&&origText!=null){const nodes=[...picked.childNodes].filter(n=>n.nodeType===3);if(nodes[0])nodes[0].textContent=origText;}origText=null;}
  function paintTokens(){const st=document.documentElement.style;for(const n of applied)st.removeProperty(n);applied.clear();for(const ch of ['palette','inspector'])for(const [n,v] of tokenSets[ch]){st.setProperty(n,v);applied.add(n);}}
  // Reset = a new element was picked: only the inspector's previews go; pending Design System edits stay visible.
  function resetLive(){liveStyle.textContent='';tokenSets.inspector.clear();paintTokens();restoreText();clearAttr('data-point-affected');clearAttr('data-point-from');}
  function focusLayer(f){
    if(!f||typeof f.selector!=='string'||(f.route&&f.route!==location.pathname+location.search+location.hash))return;
    let n=null;try{n=document.querySelector(f.selector.slice(0,200));}catch{}
    if(!n||host.contains(n))return;
    n.scrollIntoView({block:'center',behavior:'smooth'});n.setAttribute('data-point-affected','');setTimeout(()=>n.removeAttribute('data-point-affected'),2500);
  }
  function applyLive(msg){
    if(!msg||typeof msg!=='object')return;
    if(msg.pullTokens){if(!BOARD)void postPalette();return;}
    if(msg.pullScreens){if(!BOARD)void postScreens();return;}
    if(msg.focus){if(!BOARD)focusLayer(msg.focus);return;}
    if(msg.snapshot){if(!BOARD&&msg.snapshot.doc===DOC)void snapshot();return;}
    if(msg.flash){
      if(BOARD||msg.flash.doc!==DOC)return;
      let list=[];
      if(Number.isInteger(msg.flash.group))list=msg.flash.group<0?lastAlike.same:(lastAlike.groups[msg.flash.group]||[]);
      else if(typeof msg.flash.selector==='string'){try{list=[...document.querySelectorAll(msg.flash.selector.slice(0,300))].filter(n=>!host.contains(n));}catch{}}
      list=list.filter(n=>n.isConnected).slice(0,200);
      if(!list.length)return;
      list[0].scrollIntoView({block:'center',behavior:'smooth'});
      for(const n of list)n.setAttribute('data-point-affected','');
      setTimeout(()=>{for(const n of list)n.removeAttribute('data-point-affected');},2500);
      return;
    }
    if(msg.relative){
      if(BOARD||msg.relative.doc!==DOC||!picked?.isConnected)return;
      const n=msg.relative.dir==='parent'?(picked.parentElement!==document.documentElement&&picked.parentElement)
        :[...picked.children].find(c=>{const r=c.getBoundingClientRect();return r.width>0&&r.height>0;})||picked.firstElementChild;
      if(n)void choose(n);
      return;
    }
    const channel=msg.channel==='palette'?'palette':'inspector';
    if(msg.reset){resetLive();return;}
    if(Array.isArray(msg.tokens)){const set=tokenSets[channel];set.clear();for(const t of msg.tokens){if(!t||!okProp(t.n)||!t.n.startsWith('--')||!okVal(t.v))continue;set.set(t.n,t.v);}paintTokens();}
    if(channel==='palette')return;
    if(Array.isArray(msg.css))liveStyle.textContent=msg.css.map(o=>{if(!okProp(o.prop)||!okVal(o.value))return'';const sel=o.scope==='element'?(o.from?'[data-point-from]':'[data-point-picked]'):String(o.selector||'').slice(0,500);if(!sel||/[{}]|<\//.test(sel))return'';return sel+'{'+o.prop+':'+o.value+' !important;}';}).join('\n');
    if(typeof msg.text==='string'&&picked){const nodes=[...picked.childNodes].filter(n=>n.nodeType===3);if(origText==null)origText=nodes.map(n=>n.textContent).join('');if(!nodes.length)picked.insertBefore(document.createTextNode(msg.text),picked.firstChild);else{nodes[0].textContent=msg.text;for(let i=1;i<nodes.length;i++)nodes[i].textContent='';}}
    if(msg.highlight){clearAttr('data-point-affected');clearAttr('data-point-from');if(msg.highlight.from&&picked){for(let n=picked.parentElement;n;n=n.parentElement)if(describe(n)===msg.highlight.from){n.setAttribute('data-point-from','');break;}}if(!msg.highlight.broad&&msg.highlight.selector){try{for(const n of document.querySelectorAll(String(msg.highlight.selector).slice(0,500))){if(n===host||host.contains(n))continue;n.setAttribute('data-point-affected','');}}catch{}}}
  }
  // Open layers (dialog/toast) → design-system screens panel.
  // Only layers actually on screen: always-present live regions ([role=status]) and empty toast viewports are not toasts.
  function shown(el){
    if(host.contains(el))return false;
    const r=el.getBoundingClientRect();if(r.width<8||r.height<8)return false;
    const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0.05&&(el.textContent||'').trim().length>0;
  }
  function captureLayers(){
    const out=[],seen=new Set();
    const add=(el,kind,label)=>{if(!el||seen.has(el)||out.length>=30||!shown(el))return;if([...seen].some(s=>s.contains(el)))return;seen.add(el);const id=el.id?'#'+el.id:el.getAttribute('role')?'[role='+el.getAttribute('role')+']':el.className&&typeof el.className==='string'?('.'+el.className.trim().split(/\s+/).slice(0,2).join('.')):el.tagName.toLowerCase();out.push({id:kind+':'+id+':'+out.length,label:(label||el.getAttribute('aria-label')||id).slice(0,80),route:location.pathname+location.search+location.hash,kind,selector:id});};
    document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]').forEach(el=>add(el,'modal','모달'));
    document.querySelectorAll('[role="alert"],[role="status"],[class*="toast"],[class*="Toast"],[data-sonner-toast],[data-radix-toast-viewport] > *').forEach(el=>add(el,'toast','토스트'));
    document.querySelectorAll('[role="drawer"],[data-state="open"][class*="drawer"],aside[data-state="open"]').forEach(el=>add(el,'drawer','드로어'));
    return out;
  }
  // Same-site links on the page: for apps with one index.html these are the other screens (`/about.html`, `#/settings`).
  function collectLinks(){
    const out=[],seen=new Set();
    const add=(u,label)=>{if(u.origin!==location.origin||out.length>=60)return;const route=u.pathname+u.search+(/^#!?\//.test(u.hash)?u.hash:'');if(seen.has(route))return;seen.add(route);out.push({route,label});};
    for(const a of document.querySelectorAll('a[href]')){
      if(host.contains(a)||a.hasAttribute('download'))continue;
      let u;try{u=new URL(a.getAttribute('href'),document.baseURI);}catch{continue;}
      add(u,(a.getAttribute('aria-label')||a.textContent||'').trim().replace(/\s+/g,' ').slice(0,60));
    }
    // The screen the user navigated to by script (hash router) counts too.
    if(/^#!?\//.test(location.hash))add(new URL(location.href),document.title.slice(0,60));
    return out;
  }
  // ---- "화면 담기": the DOM as it is right now (open modal, active tab, filled form), scripts removed so it stays in this state.
  // Styles stay live: linked stylesheets load normally and the board still forwards token/CSS previews into it.
  const snapshotUrl=endpoint.replace('/select?','/snapshot?');
  function snapshotLabel(){
    const vis=n=>n&&shown(n);
    const dialog=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].find(vis);
    const head=[...(dialog||document).querySelectorAll('h1,h2,h3,[role="heading"]')].find(vis);
    const t=(dialog?.getAttribute('aria-label')||head?.textContent||document.title||'').trim().replace(/\s+/g,' ').slice(0,50);
    return (t?t+' · ':'')+(location.pathname+location.hash).slice(0,40);
  }
  function snapshotHtml(){
    const clone=document.documentElement.cloneNode(true);
    const pairs=sel=>{const a=document.querySelectorAll(sel),b=clone.querySelectorAll(sel);return [...a].map((n,i)=>[n,b[i]]).filter(([,c])=>c);};
    // Form state lives in properties, not attributes.
    for(const [el,c] of pairs('input,textarea,select')){
      if(el.tagName==='TEXTAREA')c.textContent=el.value;
      else if(el.tagName==='SELECT')[...c.options].forEach((o,j)=>{if(el.options[j]?.selected)o.setAttribute('selected','');else o.removeAttribute('selected');});
      else if(el.type==='checkbox'||el.type==='radio'){if(el.checked)c.setAttribute('checked','');else c.removeAttribute('checked');}
      else if(el.type==='password'||el.type==='file')c.removeAttribute('value');
      else c.setAttribute('value',el.value);
    }
    for(const [el,c] of pairs('canvas')){try{const img=document.createElement('img');img.src=el.toDataURL();img.width=el.width;img.height=el.height;img.style.cssText=el.style.cssText;img.className=el.className;c.replaceWith(img);}catch{}}
    // Rules added through CSSOM (insertRule / CSS-in-JS) are not in the <style> text.
    for(const [el,c] of pairs('style')){try{if(el.sheet&&!el.textContent.trim())c.textContent=[...el.sheet.cssRules].map(r=>r.cssText).join('\n');}catch{}}
    const head=clone.querySelector('head')||clone.insertBefore(document.createElement('head'),clone.firstChild);
    try{for(const sh of document.adoptedStyleSheets||[]){const st=document.createElement('style');st.textContent=[...sh.cssRules].map(r=>r.cssText).join('\n');head.append(st);}}catch{}
    clone.querySelectorAll('script,[data-point-code-ui],style[data-point-code-live],link[rel="modulepreload"],link[as="script"],base').forEach(n=>n.remove());
    for(const n of clone.querySelectorAll('*')){
      for(const a of [...n.attributes])if(/^on/i.test(a.name)||/^data-point-(picked|affected|from)$/.test(a.name)||(/^(href|src|action|formaction)$/i.test(a.name)&&/^\s*javascript:/i.test(a.value)))n.removeAttribute(a.name);
    }
    // Previews are not part of the app: drop token overrides set on <html>; the board re-applies previews live.
    for(const t of applied)clone.style.removeProperty(t);
    if(!clone.getAttribute('style'))clone.removeAttribute('style');
    const base=document.createElement('base');base.href=document.baseURI;head.insertBefore(base,head.firstChild);
    const meta=document.createElement('meta');meta.name='point-code-snapshot';meta.content=JSON.stringify({scroll:Math.round(scrollY),at:Date.now()});head.append(meta);
    return '<!doctype html>\n'+clone.outerHTML;
  }
  async function snapshot(){
    if(BOARD)return;
    status.textContent='화면 담는 중…';
    try{
      const html=snapshotHtml();
      if(html.length>8e6)throw Error('too big');
      const r=await fetch(snapshotUrl,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({html,label:snapshotLabel(),route:location.pathname+location.search+location.hash}),signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw Error();
      status.textContent='화면 그리드에 담았습니다';
    }catch(err){status.textContent=String(err?.message)==='too big'?'화면이 너무 커서 담지 못했습니다':'화면 담기 실패 · Point Code: 시작 실행 확인';}
  }
  // A captured screen restores where it was scrolled to.
  try{const m=document.querySelector('meta[name="point-code-snapshot"]');const y=m&&JSON.parse(m.content).scroll;if(y)addEventListener('load',()=>scrollTo(0,y),{once:true});}catch{}
  const paletteUrl=endpoint.replace('/select?','/palette?');
  const screensUrl=endpoint.replace('/select?','/screens?');
  async function postPalette(){try{await fetch(paletteUrl,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({tokens:designTokens()}),signal:AbortSignal.timeout(4000)});}catch{}}
  // Reports only when the open layers change (the host also ignores repeats), tagged with this document so pages do not overwrite each other.
  let lastLayers='';
  async function postScreens(force){const layers=captureLayers(),links=collectLinks(),key=JSON.stringify([layers,links]);if(!force&&key===lastLayers)return;lastLayers=key;try{await fetch(screensUrl,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({doc:DOC,layers,links,route:location.pathname+location.search+location.hash}),signal:AbortSignal.timeout(4000)});}catch{}}
  function connectLive(){try{es=new EventSource(endpoint.replace('/select?','/live?'));}catch{return;}es.onmessage=e=>{try{applyLive(JSON.parse(e.data));}catch{}};es.onerror=()=>{es.close();esTimer=setTimeout(connectLive,2000);};es.onopen=()=>{void postPalette();void postScreens(true);};}
  // Messages from the embedding webview: live previews (Screens board) or "화면 담기" (preview toolbar).
  function fromBoard(e){if(e.source!==window.parent||!e.data)return;if(BOARD&&e.data.__pointCode==='live')applyLive(e.data.payload);if(!BOARD&&e.data.__pointCode==='snapshot')void snapshot();}
  if(window.parent!==window)window.addEventListener('message',fromBoard);
  if(!BOARD){
    connectLive();
    setTimeout(()=>{void postPalette();void postScreens(true);},800);
    // Keep-alive every 4s (captures expire on the host after 12s); otherwise only changes are sent.
    let beat=0;poll=setInterval(()=>{void postScreens(++beat%3===0);},4000);
    window.addEventListener('pagehide',()=>{navigator.sendBeacon?.(screensUrl,JSON.stringify({doc:DOC,layers:[]}));});
  }

  async function click(e){if(!active||isUI(e))return;e.preventDefault();e.stopImmediatePropagation();const el=e.composedPath()[0];if(!(el instanceof Element))return;
    toggle(false);return choose(el);
  }
  async function choose(el){
    resetLive();clearAttr('data-point-picked');picked=el;el.setAttribute('data-point-picked','');
    const payload={doc:DOC,tag:el.tagName.toLowerCase(),id:el.id||'',classes:Array.from(el.classList).slice(0,50),text:(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,160),ownText:ownText(el),source:source(el)};
    try{payload.inspect=inspect(el,(el.textContent||'').replace(/\s+/g,' '));}catch(err){payload.inspect={error:String(err&&err.message||err)};}
    status.textContent='소스 연결 중…';
    try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error();status.textContent='선택 전달 완료';}catch{status.textContent='연결 실패 · Point Code: 시작 실행 확인';}
  }
  // Menus and dropdowns often react to pointerdown/mousedown, before click is dispatched.
  function block(e){if(active&&!isUI(e)){e.preventDefault();e.stopImmediatePropagation();}}
  const blocked=['pointerdown','mousedown','pointerup','mouseup'];
  function key(e){if(e.key==='Escape')toggle(false);if(e.altKey&&e.shiftKey&&e.code==='KeyP'){e.preventDefault();toggle(!active);}}
  function hide(){box.style.display=label.style.display='none';}
  if(!BOARD){
    window.addEventListener('pointermove',move,true);window.addEventListener('click',click,true);window.addEventListener('keydown',key,true);window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
    for(const t of blocked)window.addEventListener(t,block,{capture:true,passive:false});
  }
  window.__pointCodeCleanup=()=>{es?.close();clearTimeout(esTimer);clearInterval(poll);window.removeEventListener('message',fromBoard);resetLive();clearAttr('data-point-picked');liveStyle.remove();liveMark.remove();host.remove();window.removeEventListener('pointermove',move,true);window.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);for(const t of blocked)window.removeEventListener(t,block,true);};
})();
