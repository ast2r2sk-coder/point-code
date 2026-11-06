'use strict';
const vscode = require('vscode');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {EXCLUDE,localUrl,originAliases,sourcePath,safeSource,scoreLine,rank} = require('./core');
const {createInspector} = require('./inspector');
const {createPalette} = require('./palette');
const {createScreens} = require('./screens');
const {DEVICES} = require('./devices');
const io = require('./workspace-io');
const SNAPSHOT_LIMIT = 8*1024*1024;
const PREFIX = '/__point_code__/';
const STATE = 'pointCode.session';
let mediaUri, session, panel, selected, generation = 0, pickCancel, inspector, palette, screens, pendingFocus;
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
  if((endpoint.pathname===PREFIX+'palette' || endpoint.pathname===PREFIX+'screens') && req.method==='POST' && origin) {
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>600000) req.destroy();});
    req.on('end',()=>{try {
      const data=JSON.parse(body);
      if(endpoint.pathname===PREFIX+'palette') {
        if(!Array.isArray(data.tokens) || data.tokens.length>250) throw Error();
        palette?.update(data.tokens);
      } else {
        if(data.layers!=null && !Array.isArray(data.layers)) throw Error();
        if(data.links!=null && !Array.isArray(data.links)) throw Error();
        void screens?.setCaptures(typeof data.doc==='string'?data.doc:null,data.layers||[],data.links||[]);
      }
      res.writeHead(204);res.end();
    }catch {res.writeHead(400);res.end();}});
    return;
  }
  // "화면 담기": the page posts its DOM (scripts already removed); served back to Screens board frames with only the picker attached.
  if(endpoint.pathname===PREFIX+'snapshot' && req.method==='POST' && origin) {
    const chunks=[];let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>SNAPSHOT_LIMIT){res.writeHead(413);res.end();req.destroy();}else chunks.push(chunk);});
    req.on('end',async()=>{try {
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof data.html!=='string' || !/^<!doctype html>/i.test(data.html)) throw Error();
      const id=await screens.addSnapshot(data);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id}));
    }catch {if(!res.headersSent){res.writeHead(400);res.end();}}});
    return;
  }
  const snap=endpoint.pathname.match(/^\/__point_code__\/snap\/([0-9a-f]{16})\.html$/);
  if(snap && req.method==='GET') {
    void screens?.snapshotHtml(snap[1]).then(html=>{
      if(html==null){res.writeHead(404);return res.end();}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(html+'\n<script src="'+s.base+PREFIX+'picker.js?token='+s.token+'"></script>\n');
    });
    return;
  }
  if(endpoint.pathname!==PREFIX+'select' || req.method!=='POST' || !origin) {res.writeHead(403);return res.end();}
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>600000) req.destroy();});
  req.on('end',()=>{try {
    const el=JSON.parse(body);
    if(typeof el.tag!=='string' || typeof el.text!=='string' || (el.ownText!=null && typeof el.ownText!=='string') || (el.inspect!=null && typeof el.inspect!=='object') || !Array.isArray(el.classes) || el.classes.length>100 || el.classes.some(c=>typeof c!=='string') || (el.id!=null && typeof el.id!=='string')) throw Error();
    res.writeHead(204);res.end();void handleSelection(el);
    if(Array.isArray(el.inspect?.tokens)) palette?.update(el.inspect.tokens);
  }catch {res.writeHead(400);res.end();}});
}
const pageUrl = s => s.base+s.target.pathname+s.target.search+s.target.hash;
const scriptTag = s => '<script src="'+s.base+PREFIX+'picker.js?token='+s.token+'"></script>';
// A running session just reopens its preview; changing the dev server address is a separate command.
async function start(context) {
  if(session) return openPreview(session);
  return connect(context);
}
async function connect(context) {
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
  screens?.setBase(s.base);
  void screens?.refresh();
  void palette?.refresh();
  openPreview(s);
  await vscode.env.clipboard.writeText(pageUrl(s));
  const moved = saved.port && saved.port!==port ? ` 이전 포트(${saved.port})가 사용 중이라 ${port}로 바뀌었습니다.` : '';
  void vscode.window.showInformationMessage('미리보기가 열렸습니다. 화면 아래 ‘요소 선택’으로 고칠 부분을 찍으세요.'+moved,'디자인 시스템','화면 그리드').then(a=>{
    if(a==='디자인 시스템') void vscode.commands.executeCommand('pointCode.openPalette');
    if(a==='화면 그리드') void vscode.commands.executeCommand('pointCode.openScreens');
  });
}
function openPreview(s) {
  if(panel) return panel.reveal(vscode.ViewColumn.One);
  panel = vscode.window.createWebviewPanel('pointCode','Point Code',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[mediaUri]});
  panel.webview.html = previewHtml(s, panel.webview);
  panel.webview.onDidReceiveMessage(m=>{
    if(m.type==='url') void copyProxyUrl();
    if(m.type==='copy') void copyScript();
    if(m.type==='styles'&&selected) void candidates(selected,true);
    if(m.type==='palette') void vscode.commands.executeCommand('pointCode.openPalette');
    if(m.type==='screens') void vscode.commands.executeCommand('pointCode.openScreens');
    if(m.type==='loaded' && pendingFocus) {const f = pendingFocus; pendingFocus = undefined; setTimeout(()=>broadcast({focus:f}),400);}
  });
  const own = panel; own.onDidDispose(()=>{if(panel===own) panel=undefined;});
}
// Screens board → preview: go to that route (or stay, if already there) and scroll to a captured layer.
function showInPreview(route, selector) {
  if(!session) return vscode.window.showInformationMessage('먼저 Point Code: 시작을 실행하세요.');
  openPreview(session);
  if(selector) pendingFocus = {selector,route};
  panel?.webview.postMessage({type:'navigate',route});
}
let broadcast = () => {};
function previewHtml(s, webview) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const src = escape(pageUrl(s));
  const app = escape(s.target.href);
  const css = name => webview?.asWebviewUri ? String(webview.asWebviewUri(vscode.Uri.joinPath(mediaUri,name))) : '';
  // Styles come from the shared design tokens (media/tokens.css) and media/preview.css; nothing is styled inline.
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escape(s.base)}; style-src ${webview?.cspSource||"'none'"}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css('tokens.css')}"><link rel="stylesheet" href="${css('preview.css')}"></head><body>
<header class="bar pc-bar">
  <span class="brand">Point Code</span>
  <div class="pc-seg" id="devices" role="group" aria-label="해상도"></div>
  <span class="spacer"></span>
  <button id="snap" title="지금 보이는 화면(열린 모달·탭 포함)을 화면 그리드에 고정합니다">화면 담기</button>
  <button class="icon" id="reload" title="새로고침" aria-label="새로고침">↻</button>
  <details class="more"><summary title="더보기" aria-label="더보기">···</summary><div class="menu">
    <button id="url">프록시 주소 복사</button>
    <button id="styles">워크스페이스 CSS 후보</button>
  </div></details>
  <span class="divider"></span>
  <button id="palette">디자인 시스템</button>
  <button id="screens">화면 그리드</button>
</header>
<div class="help" id="help"><span><code>${app}</code> · 오른쪽 아래 <b>요소 선택</b>(Alt+Shift+P) → 사이드바에서 수정 → <b>소스에 저장</b></span><button class="close" id="hideHelp" title="도움말 닫기" aria-label="도움말 닫기">✕</button></div>
<div class="stage" id="stage"><div class="frame-shell" id="shell"><iframe id="frame" src="${src}" title="개발 화면" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"></iframe></div></div>
<script nonce="${nonce}">
const api=acquireVsCodeApi();
const frame=document.getElementById('frame'),shell=document.getElementById('shell'),devices=document.getElementById('devices'),stage=document.getElementById('stage');
const list=[{id:'full',label:'전체',w:0,h:0}].concat(${JSON.stringify(DEVICES)});
const origin=${JSON.stringify(s.base)};let route=${JSON.stringify(s.target.pathname+s.target.search+s.target.hash)};
let cur='full';
function paint(){
  devices.querySelectorAll('button.chip').forEach(b=>b.classList.toggle('on',b.dataset.id===cur));
  const d=list.find(x=>x.id===cur)||list[0];
  shell.classList.toggle('device',!!d.w);
  if(!d.w){shell.style.width='100%';shell.style.height='100%';shell.style.maxHeight='none';return;}
  const maxW=Math.max(200,stage.clientWidth-24),maxH=Math.max(200,stage.clientHeight-24);
  const scale=Math.min(1,maxW/d.w,maxH/d.h);
  shell.style.width=Math.round(d.w*scale)+'px';
  shell.style.height=Math.round(d.h*scale)+'px';
  frame.style.width=d.w+'px';frame.style.height=d.h+'px';
  frame.style.transform='scale('+scale+')';frame.style.transformOrigin='0 0';
}
for(const d of list){
  const b=document.createElement('button');b.type='button';b.className='chip'+(d.id===cur?' on':'');b.dataset.id=d.id;b.textContent=d.label;
  b.title=d.w?d.w+'×'+d.h+(d.approx?' (근사값)':''):'창 너비 전체';b.onclick=()=>{cur=d.id;if(!d.w){frame.style.width='100%';frame.style.height='100%';frame.style.transform='';}paint();};
  devices.append(b);
}
window.addEventListener('resize',paint);paint();
const help=document.getElementById('help'),st=api.getState()||{};help.hidden=!!st.hideHelp;
document.getElementById('hideHelp').onclick=()=>{help.hidden=true;api.setState({...(api.getState()||{}),hideHelp:true});paint();};
document.querySelector('.more').addEventListener('click',e=>{if(e.target.closest('.menu button'))e.currentTarget.open=false;});
for(const id of ['url','styles','palette','screens'])document.getElementById(id).onclick=()=>api.postMessage({type:id});
document.getElementById('reload').onclick=()=>{frame.src=frame.src;};
frame.addEventListener('load',()=>api.postMessage({type:'loaded'}));
document.getElementById('snap').onclick=()=>{try{frame.contentWindow.postMessage({__pointCode:'snapshot'},origin);}catch{}};
window.addEventListener('message',e=>{
  if(e.data?.type!=='navigate'||typeof e.data.route!=='string')return;
  if(e.data.route===route){api.postMessage({type:'loaded'});return;}
  route=e.data.route;frame.src=origin+route;
});
</script></body></html>`;
}
async function copyScript(){if(!session)return vscode.window.showInformationMessage('먼저 Point Code: 시작을 실행하세요.');await vscode.env.clipboard.writeText(scriptTag(session));vscode.window.showInformationMessage('스크립트 태그를 복사했습니다. 개발용 HTML의 </body> 앞에 넣으세요. 포트·토큰은 이 프로젝트에서 계속 유지됩니다.');}
async function copyProxyUrl(){if(!session)return vscode.window.showInformationMessage('먼저 Point Code: 시작을 실행하세요.');await vscode.env.clipboard.writeText(pageUrl(session));vscode.window.showInformationMessage('프록시 주소를 복사했습니다: '+pageUrl(session));}
function activate(context){
  mediaUri = vscode.Uri.joinPath(context.extensionUri,'media');
  // Previews go to every connected page over SSE, and to the Screens board frames through the board webview.
  const live=payload=>{broadcast(payload);if(payload?.channel)screens?.forward(payload);};
  // Undo the last "Save to source" (from the inspector, the Design System, or the command); both views refresh their state.
  const undo=()=>io.exclusive(async()=>{const r=await io.undoLast();inspector?.undone(r);palette?.undone(r);if(r.error)void vscode.window.setStatusBarMessage('Point Code: '+r.error,4000);});
  const snapshotSrc=id=>session?session.base+PREFIX+'snap/'+id+'.html?token='+session.token:'';
  const targetPort=()=>session?.target.port||'';
  broadcast=payload=>{if(!session)return;const data='data: '+JSON.stringify(payload)+'\n\n';for(const res of session.live){try{res.write(data);}catch{session.live.delete(res);}}};
  const proxyBase=()=>session?.base||'';
  inspector=createInspector(context,{openSource,bySuffix,readLines,live,undo,candidates:()=>selected&&candidates(selected,false),styles:()=>selected&&candidates(selected,true)});
  palette=createPalette(context,{openSource,bySuffix,live,proxyBase,undo});
  screens=createScreens(context,{live,proxyBase,targetPort,showInPreview,snapshotSrc});
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('pointCode.inspector',inspector.provider,{webviewOptions:{retainContextWhenHidden:true}}),
    vscode.window.registerWebviewViewProvider('pointCode.palette',palette.provider,{webviewOptions:{retainContextWhenHidden:true}}),
    vscode.window.registerWebviewViewProvider('pointCode.screens',screens.provider,{webviewOptions:{retainContextWhenHidden:true}})
  );
  const cmds={
    start:()=>start(context),changeUrl:()=>connect(context),copyScript,copyProxyUrl,
    styles:()=>selected?candidates(selected,true):vscode.window.showInformationMessage('먼저 페이지 요소를 선택하세요.'),
    stop,['palette.refresh']:()=>palette.refresh(),['screens.refresh']:()=>screens.refresh(),
    openPalette:()=>palette.reveal(),openScreens:()=>screens.reveal(),undoSave:undo
  };
  for(const [id,fn] of Object.entries(cmds))context.subscriptions.push(vscode.commands.registerCommand('pointCode.'+id,async()=>{try{await fn();}catch(e){vscode.window.showErrorMessage(e.message);}}));
  context.subscriptions.push({dispose:()=>void stop()});
}
module.exports={activate,deactivate:stop};
