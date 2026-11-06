'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const path = require('path');
const fsp = require('fs/promises');
const {EXCLUDE} = require('./core');
const {routesFromPaths,withHomeFallback,fillRoute,pickProject,mergeCaptures,cleanLinks,mergeLinks} = require('./screen-routes');
const {DEVICES} = require('./devices');
const decoder = new TextDecoder();
const PARAMS = 'pointCode.routeParams', PROJECT = 'pointCode.screenProject';
const LINKS = 'pointCode.links', HIDDEN = 'pointCode.hiddenScreens', SNAPS = 'pointCode.snapshots';
const SNAP_ID = /^[0-9a-f]{16}$/, MAX_SNAPS = 40;
const rel = uri => vscode.workspace.asRelativePath(uri,false).replace(/\\/g,'/');

async function discoverProjects() {
  const out = [];
  for(const uri of await vscode.workspace.findFiles('**/package.json',EXCLUDE,60)) {
    try {
      const pkg = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(uri)));
      const dir = path.posix.dirname(rel(uri));
      out.push({dir:dir==='.'?'':dir,name:typeof pkg.name==='string'?pkg.name:'',deps:Object.keys({...pkg.dependencies,...pkg.devDependencies}),scripts:Object.values(pkg.scripts||{}).join(' ')});
    } catch {}
  }
  if(!out.some(p=>p.dir==='')) out.push({dir:'',name:'',deps:[],scripts:''});
  return out;
}

async function discoverRoutes(projects) {
  const rels = [];
  for(const [glob,limit] of [
    ['**/app/**/page.{tsx,jsx,js,ts}',200],
    ['**/pages/**/*.{tsx,jsx,js,ts,vue,svelte}',200],
    ['**/routes/**/+page.{svelte,tsx,jsx,ts,js}',100],
    // Vanilla / static / Vite HTML entrypoints
    ['**/*.{html,htm}',150]
  ]) {
    for(const uri of await vscode.workspace.findFiles(glob,EXCLUDE,limit)) rels.push(rel(uri));
  }
  return routesFromPaths(rels, projects);
}

function createScreens(context, deps) {
  let view, panel, routes = [], projects = [], project = null, base = '', lastPost = '';
  const captures = new Map();
  const targets = () => [view, panel].filter(Boolean);
  const params = () => context.workspaceState.get(PARAMS) || {};
  const ws = (k, d) => context.workspaceState.get(k) || d;
  const proj = () => project || '';

  function list() {
    const values = params(), hidden = new Set(ws(HIDDEN, []));
    const pages = withHomeFallback(routes.filter(r=>(r.project||'')===proj()), proj()).map(r => r.params?.length
      ? {...r, values:values[r.id]||{}, route:fillRoute(r.pattern, values[r.id]||{})}
      : r);
    // Links seen on the running page: screens a single-index.html app never has as files.
    const known = new Set(pages.map(p=>p.route).filter(Boolean));
    const links = (ws(LINKS, {})[proj()] || []).filter(l=>!known.has(l.route) && !hidden.has('link:'+l.route))
      .map(l=>({id:'link:'+l.route, label:l.label, route:l.route, pattern:l.route, params:[], kind:'page', origin:'link', project:proj()}));
    const snaps = ws(SNAPS, []).filter(x=>(x.project||'')===proj())
      .map(x=>({id:'snap:'+x.id, label:x.label, route:x.route, kind:'snapshot', at:x.at, src:deps.snapshotSrc?.(x.id)||''}));
    return [...mergeCaptures(captures, null, []), ...snaps, ...pages, ...links];
  }
  function post(force = true) {
    const msg = {type:'screens',base,screens:list(),devices:DEVICES,
      projects:projects.length>1?projects.map(d=>({dir:d,label:d||'(루트)'})):[],project:project||''};
    const key = JSON.stringify(msg);
    if(!force && key===lastPost) return;
    lastPost = key;
    for(const t of targets()) t.webview.postMessage(msg);
  }

  async function refresh() {
    const found = await discoverProjects();
    routes = await discoverRoutes(found);
    projects = [...new Set(routes.map(r=>r.project||''))];
    const saved = context.workspaceState.get(PROJECT);
    project = projects.includes(saved) ? saved : pickProject(found, routes, deps.targetPort?.());
    base = deps.proxyBase?.() || '';
    post();
  }

  // Each page reports its own open layers; only that page's entry changes. Unchanged reports do not repaint the board.
  async function setCaptures(doc, layers, links) {
    const found = cleanLinks(links);
    if(found.length) {
      const all = {...ws(LINKS, {})}, next = mergeLinks(all[proj()] || [], found);
      if(next) {all[proj()] = next; await context.workspaceState.update(LINKS, all); lastPost = '';}
    }
    const clean = (Array.isArray(layers)?layers:[]).slice(0,40).map((c,i)=>({
      id:'cap:'+String(c.id||i).slice(0,200),
      label:String(c.label||c.kind||'capture').slice(0,80),
      route:String(c.route||'/').slice(0,300),
      kind:['modal','toast','drawer','popover','view'].includes(c.kind)?c.kind:'view',
      selector:typeof c.selector==='string'?c.selector.slice(0,200):null,
      doc:typeof doc==='string'?doc.slice(0,64):null
    }));
    mergeCaptures(captures, typeof doc==='string'?doc.slice(0,64):'legacy', clean);
    post(false);
  }

  // ---- Captured screens ("화면 담기"): the page's DOM at that moment, scripts removed, kept in workspace storage.
  const snapDir = () => vscode.Uri.joinPath(context.storageUri || context.globalStorageUri, 'snapshots').fsPath;
  async function addSnapshot(data) {
    const id = crypto.randomBytes(8).toString('hex');
    await fsp.mkdir(snapDir(), {recursive:true});
    await fsp.writeFile(path.join(snapDir(), id+'.html'), data.html, 'utf8');
    const route = typeof data.route==='string' && data.route.startsWith('/') ? data.route.slice(0,300) : '/';
    const label = (typeof data.label==='string' && data.label.trim() ? data.label.trim() : route).slice(0,80);
    const all = [{id, label, route, project:proj(), at:Date.now()}, ...ws(SNAPS, [])];
    for(const old of all.slice(MAX_SNAPS)) await fsp.unlink(path.join(snapDir(), old.id+'.html')).catch(()=>{});
    await context.workspaceState.update(SNAPS, all.slice(0, MAX_SNAPS));
    post();
    return id;
  }
  async function snapshotHtml(id) {
    if(!SNAP_ID.test(id) || !ws(SNAPS, []).some(x=>x.id===id)) return null;
    return fsp.readFile(path.join(snapDir(), id+'.html'), 'utf8').catch(()=>null);
  }
  async function removeScreen(id) {
    if(id.startsWith('snap:')) {
      const sid = id.slice(5);
      await context.workspaceState.update(SNAPS, ws(SNAPS, []).filter(x=>x.id!==sid));
      if(SNAP_ID.test(sid)) await fsp.unlink(path.join(snapDir(), sid+'.html')).catch(()=>{});
    } else if(id.startsWith('link:')) {
      await context.workspaceState.update(HIDDEN, [...new Set([...ws(HIDDEN, []), id])].slice(-200));
    }
    post();
  }
  async function renameSnapshot(id) {
    const sid = id.slice(5), all = ws(SNAPS, []), item = all.find(x=>x.id===sid);
    if(!item) return;
    const label = await vscode.window.showInputBox({title:'담은 화면 이름', value:item.label, validateInput:v=>v.trim()?null:'이름을 입력하세요'});
    if(!label) return;
    await context.workspaceState.update(SNAPS, all.map(x=>x.id===sid ? {...x, label:label.trim().slice(0,80)} : x));
    post();
  }

  async function onMessage(m) {
    try {
      if(m?.type==='remove' && typeof m.id==='string') return removeScreen(m.id.slice(0,400));
      if(m?.type==='rename' && typeof m.id==='string' && m.id.startsWith('snap:')) return renameSnapshot(m.id);
      // Ask the page that has this layer open to capture itself.
      if(m?.type==='capture' && typeof m.doc==='string') return deps.live?.({snapshot:{doc:m.doc.slice(0,64)}});
      if(m?.type==='reset-links') {
        const all = {...ws(LINKS, {})}; delete all[proj()];
        await context.workspaceState.update(LINKS, all);
        await context.workspaceState.update(HIDDEN, ws(HIDDEN, []).filter(id=>!id.startsWith('link:')));
        return post();
      }
      if(m?.type==='ready') return post();
      if(m?.type==='refresh') {
        deps.live?.({pullScreens:true});
        return refresh();
      }
      if(m?.type==='copy' && typeof m.route==='string') {
        const url = (deps.proxyBase?.()||'')+m.route;
        await vscode.env.clipboard.writeText(url);
        return void vscode.window.showInformationMessage('화면 URL을 복사했습니다: '+url);
      }
      if(m?.type==='open' && typeof m.route==='string') return deps.showInPreview?.(m.route.slice(0,300), typeof m.selector==='string'?m.selector.slice(0,200):null);
      if(m?.type==='params' && typeof m.id==='string' && m.values && typeof m.values==='object') {
        const all = {...params()}, values = {};
        for(const [k,v] of Object.entries(m.values).slice(0,8)) if(typeof v==='string') values[k.slice(0,60)] = v.slice(0,200);
        all[m.id.slice(0,300)] = values;
        await context.workspaceState.update(PARAMS, all);
        return post();
      }
      if(m?.type==='project' && typeof m.dir==='string' && projects.includes(m.dir)) {
        project = m.dir;
        await context.workspaceState.update(PROJECT, project);
        return post();
      }
      if(m?.type==='focus-palette') return vscode.commands.executeCommand('pointCode.openPalette');
    } catch(e) {vscode.window.showErrorMessage('Point Code 화면 그리드: '+e.message);}
  }

  function htmlFor(webview) {
    const media = vscode.Uri.joinPath(context.extensionUri,'media');
    const nonce = crypto.randomBytes(16).toString('hex');
    const uri = name => webview.asWebviewUri(vscode.Uri.joinPath(media,name));
    const origin = (()=>{try{return deps.proxyBase?.()?new URL(deps.proxyBase()).origin:'';}catch{return '';}})();
    const frame = origin || 'http://127.0.0.1:* http://localhost:*';
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src ${frame} ${webview.cspSource};"><link rel="stylesheet" href="${uri('tokens.css')}"><link rel="stylesheet" href="${uri('screens-view.css')}"></head><body class="board"><div id="root"></div><script nonce="${nonce}" src="${uri('screens-view.js')}"></script></body></html>`;
  }

  function paintTarget(t) {
    if(!t) return;
    t.webview.options = {enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]};
    t.webview.html = htmlFor(t.webview);
  }

  function reveal() {
    if(panel) {
      panel.reveal(vscode.ViewColumn.Beside, false);
      post();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      'pointCode.screenBoard',
      '화면 그리드',
      {viewColumn:vscode.ViewColumn.Beside, preserveFocus:false},
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]}
    );
    paintTarget(panel);
    panel.webview.onDidReceiveMessage(onMessage);
    panel.onDidDispose(()=>{panel=undefined;});
    void refresh();
  }

  const provider = {
    resolveWebviewView(v) {
      view = v;
      paintTarget(v);
      v.webview.onDidReceiveMessage(onMessage);
      v.onDidDispose(()=>{if(view===v) view=undefined;});
      void refresh();
    }
  };

  return {
    provider,
    refresh,
    reveal,
    setCaptures,
    addSnapshot,
    snapshotHtml,
    // Board frames have no SSE connection of their own (browsers allow ~6 per host); live previews arrive through the board webview.
    forward:payload=>{for(const t of targets()) t.webview.postMessage({type:'live',payload});},
    setBase:b=>{
      const next=b||'';
      const changed=next!==base;
      base=next;
      if(changed) {
        if(view) paintTarget(view);
        if(panel) paintTarget(panel);
      }
      post();
    }
  };
}

module.exports = {createScreens,discoverRoutes,routesFromPaths};
