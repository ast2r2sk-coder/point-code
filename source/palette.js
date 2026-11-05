'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const {EXCLUDE,safeSource} = require('./core');
const {persistToken,CSS_GLOB} = require('./workspace-io');
const decoder = new TextDecoder();
const str = (v,n=400) => typeof v==='string' ? v.slice(0,n) : '';
const okVal = v => typeof v==='string' && v.trim() && v.length<=300 && !/[{}]|<\/|javascript:/i.test(v) ? v.trim() : null;
const okProp = p => typeof p==='string' && /^--[\w-]+$/.test(p);
const KINDS = ['color','weight','font','size','space','other'];
const KIND_LABEL = {color:'색',weight:'굵기',font:'폰트',size:'크기',space:'간격·라디우스',other:'기타'};

function cleanToken(t) {
  const n = str(t?.n,80);
  if(!n.startsWith('--')) return null;
  const kind = KINDS.includes(t?.kind) ? t.kind : 'other';
  return {n,v:str(t?.v,200),c:str(t?.c,80)||str(t?.v,80),kind,file:str(t?.file,500)||null,sel:str(t?.sel,120)||null,source:!!t?.source};
}

async function discoverComponents() {
  const out = [], seen = new Set();
  const globs = [
    '**/components/**/*.{tsx,jsx,vue,svelte}',
    '**/ui/**/*.{tsx,jsx,vue,svelte}',
    '**/design-system/**/*.{tsx,jsx,vue,svelte}'
  ];
  for(const glob of globs) {
    for(const uri of await vscode.workspace.findFiles(glob,EXCLUDE,80)) {
      const rel = vscode.workspace.asRelativePath(uri).replace(/\\/g,'/');
      const base = rel.split('/').pop().replace(/\.(tsx|jsx|vue|svelte)$/,'');
      if(!base || /^index$/i.test(base) || seen.has(base.toLowerCase())) continue;
      seen.add(base.toLowerCase());
      out.push({id:'comp:'+rel,name:base,file:uri.fsPath,rel});
      if(out.length>=60) return out;
    }
  }
  return out;
}

function createPalette(context, deps) {
  let view, panel, tokens = [], components = null, pending = new Map(), gen = 0;
  const targets = () => [view, panel].filter(Boolean);
  const post = () => {
    const msg = {type:'palette',tokens,components:components||[],pending:[...pending.entries()].map(([n,v])=>({n,v})),board:true};
    for(const t of targets()) t.webview.postMessage(msg);
  };
  const status = (kind, message) => {
    for(const t of targets()) t.webview.postMessage({type:'status',kind,message});
  };

  const resolveFile = async file => {
    const roots = (vscode.workspace.workspaceFolders||[]).map(f=>f.uri.fsPath);
    return (await safeSource(roots,{file})) || (await deps.bySuffix(roots,{file}));
  };

  async function scanWorkspace() {
    const files = await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,200);
    const seen = new Map();
    const re = /(^|[{;\s])(--[\w-]+)\s*:\s*([^;{}]+)/g;
    for(const uri of files) {
      try {
        if((await vscode.workspace.fs.stat(uri)).size>500000) continue;
        const raw = decoder.decode(await vscode.workspace.fs.readFile(uri));
        let m; re.lastIndex = 0;
        while((m = re.exec(raw))) {
          const n = m[2], v = m[3].trim();
          if(!seen.has(n)) seen.set(n, {n,v,c:v,kind:guessKind(n,v),file:uri.fsPath,sel:null,source:true});
        }
      } catch {}
    }
    return [...seen.values()].slice(0,200);
  }
  function guessKind(n,v) {
    if(/color|background|foreground|fill|stroke|accent|brand|tint|shade/i.test(n)||/^#|^rgba?\(|^hsla?\(|oklch|oklab/i.test(v)) return 'color';
    if(/weight/i.test(n)||/^(100|200|300|400|500|600|700|800|900)$/.test(v)) return 'weight';
    if(/font-size|text-size|^--text-/i.test(n)) return 'size';
    if(/font-family|^--font-(?!weight|size)/i.test(n)) return 'font';
    if(/spacing|space|gap|radius|size|width|height/i.test(n)||/^\d+(\.\d+)?(px|rem|em)$/.test(v)) return 'space';
    return 'other';
  }

  // `full`: rescan the workspace (button / command). Page reports only replace the token list; the component scan is cached.
  async function refresh(fromPage, full = false) {
    const my = ++gen;
    if(fromPage && Array.isArray(fromPage)) {
      tokens = fromPage.map(cleanToken).filter(Boolean);
    } else {
      if(full) deps.live?.({pullTokens:true});
      const scanned = await scanWorkspace();
      if(my!==gen) return;
      if(!tokens.length) tokens = scanned.map(cleanToken).filter(Boolean);
      else {
        const byName = new Map(scanned.map(t=>[t.n,t]));
        tokens = tokens.map(t => byName.has(t.n) ? {...t,file:t.file||byName.get(t.n).file,source:true} : t);
        for(const t of scanned) if(!tokens.some(x=>x.n===t.n)) tokens.push(cleanToken(t));
      }
    }
    if(full || !components) {
      const found = await discoverComponents();
      if(my!==gen) return;
      components = found;
    }
    post();
  }

  function preview(name, value) {
    if(!okProp(name) || !okVal(value)) return;
    pending.set(name, value);
    sendLive();
    // The editing webview already shows the value; a full re-render would steal focus from the input being typed in.
    for(const t of targets()) t.webview.postMessage({type:'pending',pending:[...pending.entries()].map(([n,v])=>({n,v}))});
    status('preview','모든 연결된 화면에 미리보기 · ‘소스에 저장’으로 파일에 씁니다');
  }

  const sendLive = () => deps.live?.({channel:'palette',tokens:[...pending.entries()].map(([n,v])=>({n,v}))});
  const resolveAny = async file => (await resolveFile(file));
  async function saveAll() {
    if(!pending.size) return status('warn','저장할 변경이 없습니다');
    const items = [...pending.entries()];
    const ok = [], fail = [];
    for(const [n,v] of items) {
      const tok = tokens.find(t=>t.n===n);
      let written = null;
      try {written = await persistToken(n, v, {hintFile:tok?.file||null, selector:tok?.sel||null, resolveFile:resolveAny});} catch {}
      if(written) {
        ok.push(written);
        pending.delete(n);
        const i = tokens.findIndex(t=>t.n===n);
        if(i>=0) tokens[i] = {...tokens[i],v,c:v};
      } else fail.push(n);
    }
    sendLive();
    post();
    const why = '정의가 여러 곳에 있거나 없어 위치를 정하지 못함';
    if(fail.length && !ok.length) return status('error',why+': '+fail.slice(0,5).join(', '));
    if(fail.length) return status('warn',ok.length+'개 저장, '+fail.length+'개는 미리보기만 ('+why+': '+fail.slice(0,3).join(', ')+')');
    status('saved',ok.length===1?ok[0]+' 저장':ok.length+'개 토큰 저장 · '+ok.slice(0,3).map(s=>s.split(' · ')[0]).join(', '));
  }

  async function onMessage(m) {
    try {
      if(m?.type==='ready') return post();
      if(m?.type==='refresh') return refresh(null, true);
      if(m?.type==='open-screens') return vscode.commands.executeCommand('pointCode.openScreens');
      if(m?.type==='preview' && m.n && m.v!=null) return preview(m.n, String(m.v));
      if(m?.type==='save') return saveAll();
      if(m?.type==='open' && m.file) {
        const f = await resolveFile(m.file);
        if(f) await deps.openSource({file:f.file,line:1,column:1});
      }
    } catch(e) {vscode.window.showErrorMessage('Point Code 디자인 시스템: '+e.message);status('error',e.message);}
  }

  function htmlFor(webview) {
    const media = vscode.Uri.joinPath(context.extensionUri,'media');
    const nonce = crypto.randomBytes(16).toString('hex');
    const uri = name => webview.asWebviewUri(vscode.Uri.joinPath(media,name));
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('palette-view.css')}"></head><body class="board"><div id="root"></div><script nonce="${nonce}" src="${uri('palette-view.js')}"></script></body></html>`;
  }

  function reveal() {
    if(panel) {
      panel.reveal(vscode.ViewColumn.Beside, false);
      post();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      'pointCode.designSystem',
      '디자인 시스템',
      {viewColumn:vscode.ViewColumn.Beside, preserveFocus:false},
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]}
    );
    panel.webview.html = htmlFor(panel.webview);
    panel.webview.onDidReceiveMessage(onMessage);
    panel.onDidDispose(()=>{panel=undefined;});
    if(tokens.length) post(); else void refresh();
  }

  const provider = {
    resolveWebviewView(v) {
      view = v;
      v.webview.options = {enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]};
      v.webview.html = htmlFor(v.webview);
      v.webview.onDidReceiveMessage(onMessage);
      v.onDidDispose(()=>{if(view===v) view=undefined;});
      if(tokens.length) post(); else void refresh();
    }
  };

  return {
    provider,
    update(pageTokens) {void refresh(pageTokens);},
    refresh:()=>refresh(null, true),
    reveal,
    KIND_LABEL
  };
}

module.exports = {createPalette,KINDS,KIND_LABEL};
