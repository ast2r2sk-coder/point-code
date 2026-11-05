'use strict';
const vscode = require('vscode');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {EXCLUDE,localUrl,originAliases,sourcePath,safeSource,scoreLine,rank} = require('./core');
const {createInspector} = require('./inspector');
const PREFIX = '/__point_code__/';
const STATE = 'pointCode.session';
let session, panel, selected, generation = 0, pickCancel, inspector;
const decoder = new TextDecoder();
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readLines = async uri => decoder.decode(await vscode.workspace.fs.readFile(uri)).split(/\r?\n/);
async function stop() {
  const s = session; session = undefined; selected = undefined;
  pickCancel?.cancel();
  if(panel) panel.dispose(); panel = undefined;
  if(!s) return;
  for(const socket of s.sockets) socket.destroy();
  for(const res of s.live||[]) {try{res.end();}catch{}}
  await new Promise(resolve=>s.server.close(()=>resolve()));
}
async function openSource(source) {
  const doc = await vscode.workspace.openTextDocument(source.file);
  const row = Math.min(source.line-1,doc.lineCount-1);
  const pos = new vscode.Position(row,Math.min(source.column-1,doc.lineAt(row).text.length));
  const editor = await vscode.window.showTextDocument(doc,{viewColumn:vscode.ViewColumn.Two,preview:true,preserveFocus:true});
  editor.selection = new vscode.Selection(pos,pos);
  editor.revealRange(new vscode.Range(pos,pos),vscode.TextEditorRevealType.InCenter);
}
// File known, line unknown or post-transform: pick the best matching line inside that file.
async function refine(source, el) {
  if(!source.approx) return source;
  const near = l => source.line ? Math.abs(l-source.line) : l;
  const lines = (await readLines(vscode.Uri.file(source.file))).map((text,i)=>({text,line:i+1}));
  const best = rank(lines,el,false,Infinity).sort((a,b)=>b.score-a.score||near(a.line)-near(b.line))[0];
  return best ? {...source,line:best.line,column:Math.max(1,best.text.search(/\S/)+1)} : {...source,line:source.line||1};
}
// Monorepos: the dev server root (e.g. apps/web) can differ from the workspace root.
async function bySuffix(roots, source) {
  if(!source || typeof source.file!=='string') return null;
  const rel = sourcePath(source.file).replace(/\\/g,'/').replace(/^\.\//,'');
  if(!rel || path.isAbsolute(rel)) return null;
  const uris = await vscode.workspace.findFiles('**/'+path.posix.basename(rel).replace(/[[\]{}*?]/g,'?'),EXCLUDE,50);
  const hits = uris.filter(u=>u.fsPath.replace(/\\/g,'/').endsWith('/'+rel));
  return hits.length===1 ? safeSource(roots,{...source,file:hits[0].fsPath}) : null;
}
async function candidates(el, styles=false, gen=generation) {
  const glob = styles?'**/*.{css,scss,sass,less,tsx,jsx,vue,svelte}':'**/*.{tsx,jsx,ts,js,vue,svelte,html,mdx}';
  const files = await vscode.workspace.findFiles(glob,EXCLUDE,1200);
  const entries = [];
  for(let i=0;i<files.length;i+=32) {
    await Promise.all(files.slice(i,i+32).map(async uri=>{
      try {
        if((await vscode.workspace.fs.stat(uri)).size>500000) return;
        (await readLines(uri)).forEach((text,j)=>{if(scoreLine(text,el,styles)>=3) entries.push({text,uri,line:j+1});});
      } catch {}
    }));
    if(gen!==generation) return;
  }
  const items = rank(entries,el,styles).map(e=>({label:vscode.workspace.asRelativePath(e.uri)+':'+e.line,description:e.text.trim().slice(0,130),source:{file:e.uri.fsPath,line:e.line,column:1}}));
  if(!items.length) return vscode.window.showInformationMessage('소스 후보가 없습니다. 정확한 연결은 integration/babel.cjs 또는 data-point-source 속성을 사용하세요.');
  pickCancel?.cancel(); pickCancel = new vscode.CancellationTokenSource();
  const picked = await vscode.window.showQuickPick(items,{title:styles?'스타일 후보 — 실제 적용 규칙인지 확인하세요':'소스 후보 — 검색 결과에서 선택하세요',matchOnDescription:true},pickCancel.token);
  if(picked && gen===generation) await openSource(picked.source);
}
// A newer selection supersedes an older one that is still searching or showing its QuickPick.
async function handleSelection(el) {
  const gen = ++generation; pickCancel?.cancel(); selected = el;
  try {
    const roots = (vscode.workspace.workspaceFolders||[]).map(f=>f.uri.fsPath);
    const found = await safeSource(roots,el.source) || await bySuffix(roots,el.source);
    if(gen!==generation) return;
    const exact = found && await refine(found,el);
    if(gen!==generation) return;
    void inspector?.update(el,exact,()=>gen===generation).catch(e=>vscode.window.showErrorMessage('Point Code 인스펙터: '+e.message));
    vscode.window.setStatusBarMessage('Point Code · 요소 인스펙터에서 바로 수정하세요'+(exact?' · '+path.basename(exact.file)+':'+exact.line+(exact.approx?' (추정)':'') : ''),5000);
  } catch(e) {vscode.window.showErrorMessage('Point Code: '+e.message);}
}
function listen(server, port) {
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});});
}
const upstreamHost = s => s.target.hostname.replace(/^\[|\]$/g,'');
// Dev servers check Host/Origin (Vite allowedHosts, Next allowedDevOrigins); the proxy presents itself as the dev server.
function upstreamHeaders(s, headers, base) {
  const h = {...headers,host:s.target.host};
  if(h.origin===base) h.origin = s.target.origin;
  if(h.referer?.startsWith(base)) h.referer = s.target.origin+h.referer.slice(base.length);
  return h;
}
function proxy(s, req, res) {
  const base = 'http://'+req.headers.host;
  const headers = upstreamHeaders(s,req.headers,base); delete headers['accept-encoding'];
  const dest = req.headers['sec-fetch-dest'];
  const page = req.method==='GET' && (dest ? dest==='document'||dest==='iframe' : /text\/html/.test(req.headers.accept||''));
  const up = http.request({host:upstreamHost(s),port:s.target.port||80,method:req.method,path:req.url,headers,autoSelectFamily:true},r=>{
    const h = {...r.headers};
    if(h.location?.startsWith(s.target.origin)) h.location = base+h.location.slice(s.target.origin.length);
    const inject = page && r.statusCode!==204 && r.statusCode!==304 && /text\/html/i.test(h['content-type']||'') && !h['content-encoding'];
    if(inject) delete h['content-length'];
    res.writeHead(r.statusCode,r.statusMessage,h);
    r.pipe(res,{end:!inject});
    if(inject) r.on('end',()=>res.end('\n<script src="'+PREFIX+'picker.js?token='+s.token+'"></script>\n'));
  });
  up.on('error',()=>{if(!res.headersSent) res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('Point Code: 개발 서버('+s.target.origin+')에 연결할 수 없습니다. 개발 서버가 실행 중인지 확인하세요.');});
  req.pipe(up);
}
// HMR (Vite, Next.js, webpack-dev-server) runs over WebSocket upgrades on the page origin.
function tunnel(s, req, socket, head) {
  if(!s.hosts.has(req.headers.host) || req.url.startsWith(PREFIX)) return socket.destroy();
  const headers = upstreamHeaders(s,req.headers,'http://'+req.headers.host);
  const up = net.connect({host:upstreamHost(s),port:+(s.target.port||80),autoSelectFamily:true},()=>{
    up.write(req.method+' '+req.url+' HTTP/1.1\r\n'+Object.entries(headers).flatMap(([k,v])=>[].concat(v).map(x=>k+': '+x+'\r\n')).join('')+'\r\n');
    if(head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error',()=>socket.destroy()); socket.on('error',()=>up.destroy());
  up.on('close',()=>socket.destroy()); socket.on('close',()=>up.destroy());
}
function handle(s, req, res) {
  // Host check blocks DNS rebinding now that the proxy forwards to the dev server.
  if(!s.hosts.has(req.headers.host)) {res.writeHead(403);return res.end();}
  const endpoint = new URL(req.url,'http://127.0.0.1');
  if(!endpoint.pathname.startsWith(PREFIX)) return proxy(s,req,res);
  const origin = req.headers.origin;
  if(endpoint.searchParams.get('token')!==s.token || (origin && !s.origins.has(origin))) {res.writeHead(403);return res.end();}
  if(origin) res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS') {res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);return res.end();}
  if(endpoint.pathname===PREFIX+'picker.js' && req.method==='GET') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(s.picker.replace('__POINT_ENDPOINT__',JSON.stringify('http://'+req.headers.host+PREFIX+'select?token='+s.token)));
  }
  if(endpoint.pathname===PREFIX+'live' && req.method==='GET') {
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(':\n\n');
    s.live.add(res);
    const ping=setInterval(()=>{try{res.write(':\n\n');}catch{clearInterval(ping);s.live.delete(res);}},15000);
    req.on('close',()=>{clearInterval(ping);s.live.delete(res);});
    return;
  }
  if(endpoint.pathname!==PREFIX+'select' || req.method!=='POST' || !origin) {res.writeHead(403);return res.end();}
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>600000) req.destroy();});
  req.on('end',()=>{try {
    const el=JSON.parse(body);
    if(typeof el.tag!=='string' || typeof el.text!=='string' || (el.ownText!=null && typeof el.ownText!=='string') || (el.inspect!=null && typeof el.inspect!=='object') || !Array.isArray(el.classes) || el.classes.length>100 || el.classes.some(c=>typeof c!=='string') || (el.id!=null && typeof el.id!=='string')) throw Error();
    res.writeHead(204);res.end();void handleSelection(el);
  }catch {res.writeHead(400);res.end();}});
}
const pageUrl = s => s.base+s.target.pathname+s.target.search+s.target.hash;
const scriptTag = s => '<script src="'+s.base+PREFIX+'picker.js?token='+s.token+'"></script>';
async function start(context) {
  if(!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders) return vscode.window.showErrorMessage('먼저 신뢰할 수 있는 로컬 프로젝트 폴더를 열어주세요.');
  if(vscode.env.remoteName) return vscode.window.showErrorMessage('Point Code는 로컬 Cursor만 지원합니다. SSH/WSL/컨테이너 환경은 지원하지 않습니다.');
  const saved = context.workspaceState.get(STATE)||{};
  const value = await vscode.window.showInputBox({title:'개발 서버 주소',value:session?.url||saved.url||'http://localhost:5173',validateInput:v=>{try{localUrl(v);}catch(e){return e.message;}}});
  if(!value) return;
  const target = localUrl(value); await stop();
  const s = {target,url:target.href,token:saved.token||crypto.randomBytes(24).toString('hex'),sockets:new Set(),live:new Set(),picker:await fs.readFile(path.join(context.extensionPath,'media','picker.js'),'utf8')};
  const server = http.createServer((req,res)=>handle(s,req,res));
  server.on('connection',c=>{s.sockets.add(c);c.on('close',()=>s.sockets.delete(c));});
  server.on('upgrade',(req,socket,head)=>tunnel(s,req,socket,head));
  let port;
  try {port = await listen(server,saved.port||0);} catch {port = await listen(server,0);}
  Object.assign(s,{server,base:'http://127.0.0.1:'+port,hosts:new Set(['127.0.0.1:'+port,'localhost:'+port]),origins:new Set([...originAliases(target.origin),'http://127.0.0.1:'+port,'http://localhost:'+port])});
  await context.workspaceState.update(STATE,{port,token:s.token,url:target.href});
  session = s;
  panel = vscode.window.createWebviewPanel('pointCode','Point Code',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escape(s.base)}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>body{padding:0;margin:0;font:13px system-ui;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}header{padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:7px 12px;cursor:pointer}p{padding:0 12px;font-size:12px;opacity:.8}iframe{width:100%;height:calc(100vh - 112px);border:0;background:white}</style></head><body><header><strong>Point Code</strong><button id="url">프록시 주소 복사</button><button id="copy">스크립트 태그 복사</button><button id="reload">새로고침</button><button id="styles">CSS 후보</button></header><p>${escape(pageUrl(s))} → ${escape(target.href)} · 프로젝트 수정 없이 연결됩니다. 하단 ‘요소 선택’ 또는 Alt+Shift+P</p><iframe src="${escape(pageUrl(s))}" title="개발 화면" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"></iframe><script nonce="${nonce}">const api=acquireVsCodeApi();for(const id of ['url','copy','styles'])document.getElementById(id).onclick=()=>api.postMessage({type:id});document.getElementById('reload').onclick=()=>{const f=document.querySelector('iframe');f.src=f.src;};</script></body></html>`;
  panel.webview.onDidReceiveMessage(m=>{if(m.type==='url') void copyProxyUrl();if(m.type==='copy') void copyScript();if(m.type==='styles'&&selected) void candidates(selected,true);});
  const own = panel; own.onDidDispose(()=>{if(panel===own) panel=undefined;});
  await vscode.env.clipboard.writeText(pageUrl(s));
  const moved = saved.port && saved.port!==port ? ` 이전 포트(${saved.port})가 사용 중이라 ${port}로 바뀌었습니다. 스크립트 태그를 쓰고 있다면 다시 복사하세요.` : '';
  void vscode.window.showInformationMessage('프록시 주소를 복사했습니다: '+pageUrl(s)+' — Cursor 브라우저에서 이 주소를 열면 됩니다.'+moved,'스크립트 태그 복사').then(a=>{if(a) void copyScript();});
}
async function copyScript(){if(!session)return vscode.window.showInformationMessage('먼저 Point Code: Start를 실행하세요.');await vscode.env.clipboard.writeText(scriptTag(session));vscode.window.showInformationMessage('스크립트 태그를 복사했습니다. 개발용 HTML의 </body> 앞에 넣으세요. 포트·토큰은 이 프로젝트에서 계속 유지됩니다.');}
async function copyProxyUrl(){if(!session)return vscode.window.showInformationMessage('먼저 Point Code: Start를 실행하세요.');await vscode.env.clipboard.writeText(pageUrl(session));vscode.window.showInformationMessage('프록시 주소를 복사했습니다: '+pageUrl(session));}
function activate(context){
  const live=payload=>{if(!session)return;const data='data: '+JSON.stringify(payload)+'\n\n';for(const res of session.live){try{res.write(data);}catch{session.live.delete(res);}}};
  inspector=createInspector(context,{openSource,bySuffix,readLines,live,candidates:()=>selected&&candidates(selected,false),styles:()=>selected&&candidates(selected,true)});
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('pointCode.inspector',inspector.provider,{webviewOptions:{retainContextWhenHidden:true}}));
  for(const [id,fn] of Object.entries({start:()=>start(context),copyScript,copyProxyUrl,styles:()=>selected?candidates(selected,true):vscode.window.showInformationMessage('먼저 페이지 요소를 선택하세요.'),stop}))context.subscriptions.push(vscode.commands.registerCommand('pointCode.'+id,async()=>{try{await fn();}catch(e){vscode.window.showErrorMessage(e.message);}}));context.subscriptions.push({dispose:()=>void stop()});}
module.exports={activate,deactivate:stop};
