'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const {EXCLUDE,safeSource,selectorClasses,locateSelector,nearUsage,setDeclaration,swapUtility,replaceClass,replaceText,setInlineStyle,layoutDecls,layoutUtilities,setUtilityGroup,rewriteClassLiteral,findLiterals,replaceLiterals,addVariable,isColorLiteral} = require('./core');
const io = require('./workspace-io');
const {readDoc,writeDoc,savedNote,persistToken,CSS_GLOB} = io;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Payload comes from the page; everything is clipped and later rendered with textContent only.
const arr = (v,n) => Array.isArray(v) ? v.slice(0,n) : [];
const str = (v,n=400) => typeof v==='string' ? v.slice(0,n) : '';
const num = (v,max=9999) => Number.isInteger(v) ? Math.max(0, Math.min(v, max)) : 0;
const cleanSource = s => s && typeof s.file==='string' ? {file:s.file.slice(0,500),line:Number.isInteger(s.line)&&s.line>0?s.line:undefined,column:Number.isInteger(s.column)&&s.column>0?s.column:1,approx:!!s.approx} : null;
const fileLabel = f => {try {return decodeURIComponent(new URL(f).pathname.split('/').pop()).replace(/\?.*$/,'');} catch {return f.split(/[\\/]/).pop();}};
const cleanRule = r => ({selector:str(r?.selector,300),nest:str(r?.nest,200)||null,file:str(r?.file,500)||null,label:str(r?.label,40)||(typeof r?.file==='string'?fileLabel(r.file).slice(0,60):null),ctx:arr(r?.ctx,6).map(c=>str(c,120)),state:str(r?.state,60)||null,inline:!!r?.inline,from:str(r?.from,120)||null,
  fromClasses:arr(r?.fromClasses,100).filter(c=>typeof c==='string'),fromSource:cleanSource(r?.fromSource),hits:num(r?.hits),kids:num(r?.kids),
  decls:arr(r?.decls,40).map(d=>({p:str(d?.p,80),v:str(d?.v,300),imp:!!d?.imp,over:!!d?.over}))});
const pairs = (v,n) => arr(v,n).filter(Array.isArray).map(([a,b])=>[str(a,60),str(b,300)]);
const isBase = sel => !/[.#[]/.test(sel) && /(^|[\s,])(\*|html|:root)/.test(sel);
const okVal = v => typeof v==='string' && v.trim() && v.length<=300 && !/[{}]|<\/|javascript:/i.test(v) ? v.trim() : null;
const okProp = p => typeof p==='string' && /^-{0,2}[\w-]+$/.test(p);
const LAYOUT_SELF = ['display','dir','wrap','justify','align','justifyItems','gap','textAlign','alignSelf','justifySelf','kids','fullWidth','placeX','placeY'];
const pickFacts = (o, keys) => o && typeof o==='object' ? Object.fromEntries(keys.map(k=>[k, typeof o[k]==='boolean' ? o[k] : Number.isInteger(o[k]) ? num(o[k]) : str(o[k],60)])) : null;
const cleanAlike = a => a && typeof a==='object' ? {same:num(a.same), sameSelector:str(a.sameSelector,300)||null,
  groups:arr(a.groups,8).map(g=>({label:str(g?.label,80), count:num(g?.count)})).filter(g=>g.count)} : null;
const cleanLayout = l => l && typeof l==='object' ? {self:pickFacts(l.self,LAYOUT_SELF)||{}, parent:pickFacts(l.parent,['tag','display','dir'])} : null;
const broadSel = sel => {const s=(sel||'').split(',')[0].trim();return /^(html|body|:root|\*|html body)$/i.test(s) || /^\*/.test(sel||'');};

function createInspector(context, deps) {
  // Targets per selection: edits queued for an earlier element still save to that element's source.
  let view, data, gen = 0, snap = emptySnap();
  const targetsBySel = new Map();
  io.onHistory(h=>view?.webview.postMessage({type:'history',...h}));
  const post = () => view?.webview.postMessage({type:'data',data});
  const status = (kind, message) => view?.webview.postMessage({type:'status',kind,message});
  function emptySnap() {return {css:[],tokens:[],text:null,highlight:null};}
  function sendLive() {deps.live?.({channel:'inspector',...snap});}
  function resetLive() {snap = emptySnap();deps.live?.({channel:'inspector',reset:true});}

  async function collect(glob, find) {
    const files = await vscode.workspace.findFiles(glob,EXCLUDE,1200);
    const items = [];
    for(let i=0;i<files.length&&items.length<200;i+=32) {
      await Promise.all(files.slice(i,i+32).map(async uri=>{
        try {
          if((await vscode.workspace.fs.stat(uri)).size>500000) return;
          const lines = await deps.readLines(uri);
          for(const n of find(lines,uri)) items.push({label:vscode.workspace.asRelativePath(uri)+':'+n,description:(lines[n-1]||'').trim().slice(0,130),source:{file:uri.fsPath,line:n,column:1}});
        } catch {}
      }));
    }
    return items;
  }
  async function search(glob, find, title) {
    const items = await collect(glob, find);
    if(!items.length) return vscode.window.showInformationMessage('Point Code: 찾지 못했습니다 — '+title);
    if(items.length===1) return deps.openSource(items[0].source);
    const picked = await vscode.window.showQuickPick(items,{title,matchOnDescription:true});
    if(picked) await deps.openSource(picked.source);
  }
  const findDefinition = name => {
    const def = new RegExp('(?:function|class|const|let|var)\\s+'+escapeRe(name)+'\\b');
    return search('**/*.{tsx,jsx,ts,js,vue,svelte}',(lines,uri)=>{
      if(new RegExp('[\\\\/]'+escapeRe(name)+'\\.(vue|svelte)$').test(uri.fsPath)) return [1];
      return lines.map((l,i)=>def.test(l)?i+1:0).filter(Boolean);
    },name+' 정의');
  };
  const usageTag = name => new RegExp('<'+escapeRe(name)+'(?=[\\s/>]|$)');
  const findUsage = name => search('**/*.{tsx,jsx,vue,svelte,mdx}',lines=>lines.map((l,i)=>usageTag(name).test(l)?i+1:0).filter(Boolean),'<'+name+'> 사용 위치');
  // Locations become open targets of the current pick, so the view can link them.
  const linkable = items => {const t = targetsBySel.get(data?.sel); return items.map(it=>({label:it.label, text:it.description, id:t ? t.push({source:it.source})-1 : null}));};
  // 수정 지도: where else this component is used.
  async function usage(name) {
    const tag = usageTag(name);
    const items = await collect('**/*.{tsx,jsx,vue,svelte,mdx}',lines=>lines.map((l,i)=>tag.test(l)?i+1:0).filter(Boolean));
    view?.webview.postMessage({type:'usage', name, count:items.length, items:linkable(items.slice(0,8))});
  }
  // 수정 지도: every stylesheet place the same color / length is written directly, plus a count in markup / scripts.
  async function scanLiteral(value, prop) {
    const files = await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,600), hits = [];
    for(const uri of files) {
      try {
        if((await vscode.workspace.fs.stat(uri)).size>500000) continue;
        const text = await readDoc(uri.fsPath), found = findLiterals(text, value, {prop});
        const lines = text.split(/\r?\n/);
        for(const h of found) hits.push({label:vscode.workspace.asRelativePath(uri)+':'+h.line, description:h.prop+': '+(lines[h.line-1]||'').trim().slice(0,100), source:{file:uri.fsPath,line:h.line,column:1}});
      } catch {}
    }
    let code = [];
    if(isColorLiteral(value) && /^#/.test(value)) {
      const needle = value.toLowerCase();
      code = await collect('**/*.{tsx,jsx,ts,js,html}',lines=>lines.map((l,i)=>l.toLowerCase().includes(needle)?i+1:0).filter(Boolean));
    }
    view?.webview.postMessage({type:'literal-scan', value, prop, count:hits.length, files:new Set(hits.map(h=>h.source.file)).size, items:linkable(hits.slice(0,12)), code:{count:code.length, items:linkable(code.slice(0,5))}});
  }
  // Turn a hard-coded value into a token everywhere in the stylesheets: one batch, so one undo restores every file.
  async function tokenize(m) {
    const value = okVal(m.value), name = str(m.name,80), prop = okProp(m.prop) ? m.prop : undefined;
    if(!value || !/^--[A-Za-z][\w-]*$/.test(name)) return status('error','토큰 이름은 --로 시작해야 합니다 (예: --brand)');
    return io.exclusive(async()=>{
      const batch = io.beginBatch('inspector');
      let count = 0, files = 0, defined = '';
      try {
        if(m.create) {
          const f = (m.file && await resolveAny(str(m.file,500))) || null;
          let file = f?.file;
          if(!file) {for(const uri of await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,600)) {try {if(findLiterals(await readDoc(uri.fsPath), value, {prop}).length) {file = uri.fsPath;break;}} catch {}}}
          if(!file) return status('error','토큰을 둘 CSS 파일을 찾지 못했습니다');
          const t = addVariable(await readDoc(file), name, value);
          if(t.error) return status('error','토큰 '+name+'이(가) 이미 있습니다. 다른 이름을 쓰거나 기존 토큰으로 바꾸세요.');
          await writeDoc(file, t.text);
          defined = vscode.workspace.asRelativePath(file)+':'+t.line+' ('+t.selector+')';
        }
        for(const uri of await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,600)) {
          try {
            if((await vscode.workspace.fs.stat(uri)).size>500000) continue;
            const r = replaceLiterals(await readDoc(uri.fsPath), value, 'var('+name+')', {prop});
            if(!r.count) continue;
            await writeDoc(uri.fsPath, r.text);count += r.count;files++;
          } catch {}
        }
      } finally {io.endBatch();}
      const message = (defined ? name+' 만듦 · '+defined+' · ' : '')+files+'개 파일 '+count+'곳을 var('+name+')로 바꿨습니다'+(count ? ' · 되돌리기로 한 번에 원래대로' : '');
      view?.webview.postMessage({type:'tokenize-result', value, name, count, files, batch:batch.files.size ? batch.id : null});
      status(count||defined ? 'saved' : 'warn', count||defined ? message : '바꿀 곳을 찾지 못했습니다');
    });
  }
  const findSelector = (selector,nest) => search('**/*.{css,scss,sass,less,styl,vue,svelte}',lines=>{const n=locateSelector(lines,selector,nest);return n?[n]:[];},selector+' 규칙');
  async function locateUnique(selector, nest) {
    if(!selector) return null;
    const files = await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,400);
    const hits = [];
    for(let i=0;i<files.length && hits.length<2;i++) {
      try {
        if((await vscode.workspace.fs.stat(files[i])).size>500000) continue;
        const lines = await deps.readLines(files[i]);
        const n = locateSelector(lines, selector, nest);
        if(n) hits.push({file:files[i].fsPath, line:n, column:1});
      } catch {}
    }
    return hits.length===1 ? hits[0] : null;
  }

  // The webview sends the complete list of edits to show (saved + pending); cancelling one simply leaves it out.
  function setPreview(items) {
    snap = emptySnap();
    for(const m of items) applyPreview(m, false);
    if(!items.some(m=>typeof m.text==='string')) snap.text = null;
    deps.live?.({channel:'inspector',reset:true});
    sendLive();
  }
  function applyPreview(m, send = true) {
    if(Array.isArray(m.css)) {
      for(const c of m.css) {
        if(!okProp(c.prop) || !okVal(c.value)) continue;
        snap.css = snap.css.filter(x => !(x.prop===c.prop && x.scope===c.scope && x.selector===c.selector && x.from===c.from));
        snap.css.push({selector:str(c.selector,500),prop:c.prop,value:c.value.trim(),scope:c.scope==='element'?'element':'rule',from:str(c.from,120)||null});
      }
    }
    if(Array.isArray(m.tokens)) {
      for(const t of m.tokens) {
        if(!okProp(t.n) || !t.n.startsWith('--') || !okVal(t.v)) continue;
        snap.tokens = snap.tokens.filter(x => x.n!==t.n);
        snap.tokens.push({n:t.n,v:t.v.trim()});
      }
    }
    if(typeof m.text==='string') snap.text = str(m.text, 500);
    if(m.highlight && typeof m.highlight==='object') snap.highlight = {selector:str(m.highlight.selector,500)||null,from:str(m.highlight.from,120)||null,broad:!!m.highlight.broad};
    if(send) sendLive();
  }

  async function persistLayout(m, targets) {
    const decls = arr(m.decls,12).filter(d=>Array.isArray(d) && okProp(d[0]) && okVal(d[1])).map(([p,v])=>[p,okVal(v)]);
    if(!decls.length) return {error:'배치 값이 없습니다'};
    const t = targets[m.id];
    if(!t) return {error:'이 요소의 소스 위치를 모릅니다. 미리보기만 적용됐습니다.', previewOnly:true};
    const summary = decls.map(([p,v])=>p+': '+v).join('; ');
    if(m.target==='utility') {
      // Tailwind: replace the utilities of the same group in the class string that holds this element's classes.
      if(!t.source) return {error:'className 위치를 모릅니다'};
      const change = layoutUtilities(decls);
      if(!change) return {error:'이 배치는 Tailwind 클래스로 바꾸지 못했습니다 ('+summary+')'};
      const text = await readDoc(t.source.file);
      const anchors = arr(m.classes,50).map(c=>str(c,120)).filter(Boolean).sort((a,b)=>b.length-a.length);
      let r = null;
      for(const a of anchors) {r = rewriteClassLiteral(text, t.source.line, a, v=>setUtilityGroup(v,change)); if(r) break;}
      if(!r) return {error:'소스에서 이 요소의 class 문자열을 찾지 못했습니다'};
      if(r.after===r.before) return {message:'이미 '+r.after};
      const w = await writeDoc(t.source.file, r.text);
      return {message:vscode.workspace.asRelativePath(t.source.file)+':'+r.line+' · '+r.after+savedNote(w)};
    }
    if(!t.source && (t.selector || m.selector)) {
      const found = await locateUnique(t.selector || m.selector, t.nest || m.nest);
      if(found) t.source = found;
    }
    if(!t.source) return {error:'소스 CSS를 찾지 못함 · 화면만 변경됨', previewOnly:true};
    let text = await readDoc(t.source.file);
    for(const [prop, value] of decls) {
      const next = setDeclaration(text, t.source.line, prop, value);
      if(!next) return {error:'규칙 블록을 찾지 못했습니다'};
      text = next;
    }
    const w = await writeDoc(t.source.file, text);
    return {message:vscode.workspace.asRelativePath(t.source.file)+':'+t.source.line+' · '+summary+savedNote(w)};
  }

  async function persist(m, resolveFile) {
    const targets = targetsBySel.get(m.selId) || [];
    if(m.mode==='layout') return persistLayout(m, targets);
    const value = okVal(m.value);
    if(!value) return {error:'값이 올바르지 않습니다'};
    const mode = m.mode;
    if(mode==='text') {
      const t = targets[m.id];
      if(!t?.source) return {error:'텍스트 위치를 모릅니다. 미리보기만 적용됐습니다.'};
      const r = replaceText(await readDoc(t.source.file), t.source.line, str(m.old,160), value, t.source.file);
      if(!r) return {error:'소스에서 문구를 찾지 못했습니다. 미리보기는 유지됩니다.'};
      if(r.error) return {error:r.error};
      const w = await writeDoc(t.source.file, r.text);
      const prev = t.source; io.onUndo(()=>{t.source = prev;});
      t.source = {...t.source, line:r.line};
      return {message:vscode.workspace.asRelativePath(t.source.file)+':'+r.line+' 저장'+savedNote(w)};
    }
    if(mode==='token') {
      const name = m.token;
      if(!okProp(name) || !name.startsWith('--')) return {error:'토큰 이름이 올바르지 않습니다'};
      const written = await persistToken(name, value, {hintFile:str(m.file,500)||null, selector:str(m.tokenSel,200)||null, resolveFile});
      if(!written) return {error:'토큰 '+name+' 정의가 여러 곳에 있거나 없어 저장할 위치를 정하지 못했습니다'};
      return {message:written+' 저장'};
    }
    const t = targets[m.id], prop = okProp(m.prop) && m.prop;
    if(!prop || !t) return {error:'이 속성은 소스에 연결되지 않았습니다. 미리보기는 유지됩니다.'};
    if(t.inline || mode==='inline') {
      if(!t.source) return {error:'인라인 스타일 위치를 모릅니다'};
      const r = setInlineStyle(await readDoc(t.source.file), t.source.line, prop, value, t.source.file);
      if(!r) return {error:'인라인 style 리터럴을 찾지 못했습니다'};
      const w = await writeDoc(t.source.file, r.text);
      return {message:vscode.workspace.asRelativePath(t.source.file)+':'+r.line+' 저장'+savedNote(w)};
    }
    if(t.utility || mode==='utility') {
      if(!t.cls || !t.source) return {error:'className 위치를 모릅니다'};
      const next = swapUtility(t.cls, str(m.old,300), value, prop);
      if(!next) return {error:'이 유틸리티 클래스는 자동으로 바꾸지 못했습니다'};
      const r = replaceClass(await readDoc(t.source.file), t.source.line, t.cls, next);
      if(!r) return {error:'소스에서 클래스 '+t.cls+' 를 찾지 못했습니다'};
      const w = await writeDoc(t.source.file, r.text);
      const prev = {cls:t.cls, source:t.source}; io.onUndo(()=>{t.cls = prev.cls; t.source = prev.source;});
      t.cls = next;
      t.source = {...t.source, line:r.line};
      return {message:vscode.workspace.asRelativePath(t.source.file)+':'+r.line+' · '+next+savedNote(w)};
    }
    if(!t.source && (t.selector || m.selector)) {
      const found = await locateUnique(t.selector || m.selector, t.nest || m.nest);
      if(found) t.source = found;
    }
    if(!t.source) return {error:'소스 CSS를 찾지 못함 · 화면만 변경됨. Next/번들 CSS는 원본 파일이 아닙니다. Tailwind면 className이 있는 요소를 고르세요.', previewOnly:true};
    const next = setDeclaration(await readDoc(t.source.file), t.source.line, prop, value);
    if(!next) return {error:'규칙 블록을 찾지 못했습니다'};
    const w = await writeDoc(t.source.file, next);
    return {message:vscode.workspace.asRelativePath(t.source.file)+':'+t.source.line+' 저장'+savedNote(w)};
  }

  async function onMessage(m) {
    try {
      if(m?.type==='ready') {post();view?.webview.postMessage({type:'history',...io.historyState()});return;}
      if(m?.type==='styles') return deps.styles();
      if(m?.type==='open-palette') return vscode.commands.executeCommand('pointCode.openPalette');
      if(m?.type==='open-screens') return vscode.commands.executeCommand('pointCode.openScreens');
      if(m?.type==='preview') {
        if(m.selId===data?.sel) applyPreview(m);
        return status('preview','화면 미리보기 · 아직 파일에는 안 넣었습니다. 아래 ‘소스에 저장’을 누르세요.');
      }
      if(m?.type==='preview-all' && Array.isArray(m.items)) {
        if(m.selId===data?.sel) setPreview(m.items.slice(0,200));
        return;
      }
      if(m?.type==='undo') return deps.undo?.();
      // Layout intents ("center", "stack vertically") become declarations here, from core.layoutDecls (one tested place).
      if(m?.type==='layout-intent' && m.intent && typeof m.intent==='object') {
        const i = m.intent, pos = v => typeof v==='string' ? v.slice(0,20) : undefined;
        const intent = {type:pos(i.type), value:i.type==='gap' ? okVal(i.value) : pos(i.value), axis:pos(i.axis), x:pos(i.x), y:pos(i.y)};
        const ctx = cleanLayout(m.ctx) || {};
        const r = intent.type==='gap' && !intent.value ? {decls:[], error:'value'} : layoutDecls(intent, ctx);
        return view?.webview.postMessage({type:'layout-decls', selId:m.selId, ui:m.ui, ...r});
      }
      if(m?.type==='usage' && typeof m.name==='string') return usage(m.name.slice(0,80));
      if(m?.type==='scan-literal' && okVal(m.value)) return scanLiteral(okVal(m.value), okProp(m.prop) ? m.prop : undefined);
      if(m?.type==='tokenize') return tokenize(m);
      // Point at elements on the page for a moment: a selector, or a look-alike group the page kept from the pick.
      if(m?.type==='flash' && data?.doc) return deps.live?.({flash:{doc:data.doc, selector:str(m.selector,300)||null, group:Number.isInteger(m.group)?m.group:null}});
      // Move the selection to the parent / first child, in the page that made the current pick.
      if(m?.type==='select-relative' && (m.dir==='parent' || m.dir==='child')) {
        if(!data?.doc) return status('warn','이 선택은 페이지에서 다시 고를 수 없습니다. 요소 선택으로 다시 고르세요.');
        return deps.live?.({relative:{dir:m.dir, doc:data.doc}});
      }
      // One message per save; items run one after another so edits to the same file build on each other.
      if(m?.type==='save' && Array.isArray(m.items)) return io.exclusive(()=>saveItems(m.items.slice(0,100)));
      const t = m?.type==='open' && (targetsBySel.get(data?.sel)||[])[m.id];
      if(!t) return;
      if(t.source) await deps.openSource(t.source);
      else if(t.search) await deps.candidates();
      else if(t.definition) await findDefinition(t.definition);
      else if(t.usage) await findUsage(t.usage);
      else if(t.selector) await findSelector(t.selector,t.nest);
    } catch(e) {vscode.window.showErrorMessage('Point Code: '+e.message);status('error', e.message);}
  }

  const roots = () => (vscode.workspace.workspaceFolders||[]).map(f=>f.uri.fsPath);
  const resolveAny = async file => (await safeSource(roots(),{file}))||(await deps.bySuffix(roots(),{file}));
  async function saveItems(items) {
    const results = [];
    const batch = io.beginBatch('inspector');
    try {
      for(const m of items) {
        let r;
        try {r = await persist(m, resolveAny);} catch(e) {r = {error:e.message};}
        results.push({key:str(m.key,200), ok:!r.error, message:r.error||r.message});
        if(!r.error) batch.keys.push(str(m.key,200));
      }
    } finally {io.endBatch();}
    const ok = results.filter(r=>r.ok), fail = results.filter(r=>!r.ok);
    const kind = !fail.length ? 'saved' : ok.length ? 'warn' : 'error';
    const message = !fail.length ? (ok.length===1 ? ok[0].message : ok.length+'개 저장 · '+ok.map(r=>r.message.split(' · ')[0]).slice(0,3).join(', '))
      : (ok.length ? ok.length+'개 저장, ' : '')+fail.length+'개는 미리보기만 — '+fail[0].message;
    view?.webview.postMessage({type:'save-result',kind,message,results,batch:batch.files.size?batch.id:null});
  }
  // A save was undone (from this view, the Design System, or the command).
  function undone(r) {
    if(r.batch?.source==='inspector') view?.webview.postMessage({type:'undone',batch:r.batch.id,keys:r.batch.keys});
    status(r.kind||'error', r.error||r.message);
  }

  async function update(el, element, isCurrent) {
    const my = ++gen;
    resetLive();
    const ins = el.inspect && typeof el.inspect==='object' ? el.inspect : {};
    const roots = (vscode.workspace.workspaceFolders||[]).map(f=>f.uri.fsPath);
    const next = [], add = t => next.push(t)-1, rel = f => vscode.workspace.asRelativePath(f);
    const files = new Map(), texts = new Map();
    const resolveFile = async file => {if(!files.has(file)) files.set(file,(await safeSource(roots,{file}))||(await deps.bySuffix(roots,{file})));return files.get(file);};
    const read = async file => {if(!texts.has(file)) texts.set(file,await deps.readLines(vscode.Uri.file(file)).catch(()=>[]));return texts.get(file);};
    const elementLoc = element ? {label:rel(element.file)+':'+element.line+(element.approx?' (추정)':''),id:add({source:element}),save:true} : {label:'소스 후보 검색',id:add({search:true}),save:false};
    const components = [];
    for(const c of arr(ins.components,40)) {
      const name = str(c?.name,80)||'Anonymous', kind = c?.kind==='definition'?'definition':'usage', src = cleanSource(c?.source);
      const props = arr(c?.props,16).map(p=>({k:str(p?.k,60),v:str(p?.v,80),b:typeof p?.b==='boolean'?p.b:undefined,t:!!p?.t}));
      let loc = null;
      const f = src && await resolveFile(src.file);
      if(f) {
        let line = src.line, approx = src.approx || !line;
        if(approx) {const lines = await read(f.file);line = (kind==='definition' ? lines.findIndex(l=>/^\s*<template/.test(l))+1 : nearUsage(lines,name,props.find(p=>p.t),line)) || line || 1;}
        loc = {label:rel(f.file)+':'+line+(approx?' (추정)':''),id:add({source:{file:f.file,line,column:approx?1:src.column}}),save:true};
      }
      if(!loc && !c?.block && kind==='usage') loc = {label:'사용 위치 찾기',id:add({usage:name}),search:true,save:false};
      components.push({name,kind,block:!!c?.block,server:!!c?.server,lib:!!c?.lib,props,loc,def:c?.block?null:add({definition:name})});
    }
    const classes = arr(el.classes,100);
    async function ownerLoc(r) {
      if(!r.from) return elementLoc;
      const f = r.fromSource && await resolveFile(r.fromSource.file);
      return f ? {id:add({source:{file:f.file,line:r.fromSource.line||1,column:r.fromSource.column}})} : elementLoc;
    }
    async function ruleLoc(r) {
      if(r.inline) return {label:'style 속성 → 요소 위치',id:add({source:element,inline:true}),inline:true,save:!!element};
      const cls = selectorClasses(r.selector), owner = r.from ? r.fromClasses : classes;
      const utility = cls.length===1 && owner.includes(cls[0]);
      const f = r.file && await resolveFile(r.file);
      if(f) {
        const n = locateSelector(await read(f.file),r.selector,r.nest);
        if(n) return {label:rel(f.file)+':'+n,id:add({source:{file:f.file,line:n,column:1}}),save:true};
        if(utility) {
          const ownerL = await ownerLoc(r);
          const src = next[ownerL.id]?.source;
          return {label:'className 유틸리티 → '+(r.from?'부모 ':'')+'요소 위치',id:add({source:src,utility:true,cls:cls[0]}),utility:true,save:!!src};
        }
        // The file is known but the rule is not: never fall back to line 1 (that would edit whichever rule comes first).
        return {label:rel(f.file)+' (규칙 위치 못 찾음)',id:add({selector:r.selector,nest:r.nest}),save:false};
      }
      if(utility) {
        const ownerL = await ownerLoc(r);
        const src = next[ownerL.id]?.source;
        return {label:'className 유틸리티 → '+(r.from?'부모 ':'')+'요소 위치',id:add({source:src,utility:true,cls:cls[0]}),utility:true,save:!!src};
      }
      return {label:(r.label||'stylesheet')+' · 원본 없음',id:add({selector:r.selector,nest:r.nest}),save:false};
    }
    const withLoc = async list => {const out = [];for(const {fromClasses,fromSource,...r} of list) out.push({...r,base:isBase(r.selector),loc:await ruleLoc({...r,fromClasses,fromSource})});return out;};
    const result = {
      sel:my, doc:str(el.doc,20)||null, layout:cleanLayout(ins.layout), alike:cleanAlike(ins.alike),
      el:{tag:str(el.tag,40),id:str(el.id,120),classes,text:str(el.text,160),ownText:str(el.ownText,160)},
      element:elementLoc, components,
      rules:await withLoc(arr(ins.rules,60).map(cleanRule)),
      states:await withLoc(arr(ins.states,30).map(cleanRule)),
      inherited:await withLoc(arr(ins.inherited,12).map(cleanRule)),
      computed:pairs(ins.computed,30), hovered:ins.hovered===true, vars:pairs(ins.vars,30),
      tokens:arr(ins.tokens,200).map(t=>({n:str(t?.n,80),v:str(t?.v,120),c:str(t?.c,80),kind:str(t?.kind,20)||'other',file:str(t?.file,500)||null,sel:str(t?.sel,200)||null})).filter(t=>t.n.startsWith('--')),
      scales:{
        weight:arr(ins.scales?.weight,12).map(s=>({label:str(s?.label,40),value:str(s?.value,40),util:str(s?.util,40)||null})),
        font:arr(ins.scales?.font,12).map(s=>({label:str(s?.label,40),value:str(s?.value,80),util:str(s?.util,40)||null}))
      },
      error:str(ins.error,200)
    };
    if(!isCurrent() || my!==gen) return;
    targetsBySel.set(my,next);
    for(const k of targetsBySel.keys()) if(k < my-2) targetsBySel.delete(k);
    data = result;
    if(view) {view.show?.(true);post();}
    else await vscode.commands.executeCommand('pointCode.inspector.focus');
  }
  const provider = {
    resolveWebviewView(v) {
      view = v;
      const media = vscode.Uri.joinPath(context.extensionUri,'media');
      v.webview.options = {enableScripts:true,localResourceRoots:[media]};
      const nonce = crypto.randomBytes(16).toString('hex');
      const uri = name => v.webview.asWebviewUri(vscode.Uri.joinPath(media,name));
      v.webview.html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('tokens.css')}"><link rel="stylesheet" href="${uri('inspector-view.css')}"></head><body><div id="root"></div><script nonce="${nonce}" src="${uri('inspector-view.js')}"></script></body></html>`;
      v.webview.onDidReceiveMessage(onMessage);
      v.onDidDispose(()=>{if(view===v) view = undefined;});
    }
  };
  return {provider,update,undone};
}
module.exports = {createInspector};
