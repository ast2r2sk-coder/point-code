// Real HTTP bridge + proxy with a mocked VS Code host. HTTP_ONLY=1 skips the Chromium part.
const assert=require('node:assert/strict');const Module=require('module');const http=require('http');const fs=require('fs/promises');const fsSync=require('fs');const path=require('path');
const {chromium}=process.env.HTTP_ONLY?{}:require(process.env.PLAYWRIGHT_PATH || 'playwright');
const request=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const r=http.request(url,{method,headers},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:b}));});r.on('error',reject);r.end(body);});
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}assert.fail('timed out');};
(async()=>{
 const root=path.resolve(__dirname,'..');let clipboard='',opened,selection;const providers={};const commands={},store={},posted=[];
 const cssPath=path.join(root,'demo.css');
 await fs.writeFile(cssPath,':root{--brand: #ff0000}\nbody{font-family:serif}\nbutton{color:green;padding:4px}\n#target{color:var(--brand)}\n#target:hover{color:blue}\n');
 const html='<!doctype html><html><head><style data-vite-dev-id="'+cssPath.replace(/\\/g,'/')+'">'+fsSync.readFileSync(cssPath,'utf8')+'</style></head><body><button id="target" data-point-source=\''+JSON.stringify({file:'demo.html',line:2,column:1})+'\'>Choose me</button><button id="menu">Menu</button><script>window.normalClicks=0;window.pointerDowns=0;document.querySelector("#target").onclick=()=>window.normalClicks++;document.querySelector("#menu").onpointerdown=()=>window.pointerDowns++;</script></body></html>';
 const pageServer=http.createServer((req,res)=>{res.setHeader('X-Seen-Host',req.headers.host);res.setHeader('X-Seen-Origin',req.headers.origin||'');if(req.url==='/go')res.writeHead(302,{Location:url+'/'});else res.setHeader('Content-Type','text/html');res.end(req.url==='/go'?'':html);});
 pageServer.on('upgrade',(req,socket)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Seen-Host: '+req.headers.host+'\r\n\r\n');socket.pipe(socket);});
 await new Promise(r=>pageServer.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+pageServer.address().port;
 await fs.writeFile(path.join(root,'demo.html'),'<!doctype html>\n<button>Choose me</button>');
 const mock={env:{clipboard:{writeText:async s=>clipboard=s}},Uri:{file:p=>({fsPath:p}),joinPath:(u,...p)=>({fsPath:path.join(u.fsPath,...p)})},CancellationTokenSource:class{constructor(){this.token={};}cancel(){}},
  workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:root}}],findFiles:async()=>[],asRelativePath:u=>path.relative(root,typeof u==='string'?u:u.fsPath).replace(/\\/g,'/'),fs:{readFile:async u=>fsSync.readFileSync(u.fsPath),stat:async u=>fsSync.statSync(u.fsPath)},
    openTextDocument:async file=>{const p=typeof file==='string'?file:file.fsPath;const text=()=>fsSync.readFileSync(p,'utf8');const lines=()=>text().split(/\n/);return{uri:{fsPath:p},isDirty:false,getText:()=>text(),positionAt:o=>o,get lineCount(){return lines().length;},lineAt(i){const L=lines();return{text:L[i]||'',range:{end:{line:i,character:(L[i]||'').length}}};},save:async()=>{}};},
    applyEdit:async we=>{for(const op of we._ops||[]){const t=fsSync.readFileSync(op.uri.fsPath,'utf8');fsSync.writeFileSync(op.uri.fsPath,t.slice(0,op.range.start)+op.text+t.slice(op.range.end));}return true;},save:async()=>true},
  ViewColumn:{One:1,Two:2},TextEditorRevealType:{InCenter:1},Position:class{constructor(line,character){this.line=line;this.character=character;}},Selection:class{constructor(a,b){this.start=a;this.end=b;}},Range:class{constructor(a,b){this.start=a;this.end=b;}},WorkspaceEdit:class{constructor(){this._ops=[];}replace(uri,range,text){this._ops.push({uri,range,text});}},
  commands:{registerCommand:(id,fn)=>{commands[id]=fn;return{dispose(){}};},executeCommand:async()=>{}},
  window:{registerWebviewViewProvider:(id,p)=>{providers[id]=p;return{dispose(){}};},showInputBox:async()=>url,showInformationMessage:async()=>{},showErrorMessage:s=>{throw Error(s);},setStatusBarMessage(){},showQuickPick:async()=>undefined,showTextDocument:async(doc,opts)=>{assert.equal(opts.viewColumn,2);opened=doc.uri?.fsPath||doc;return{set selection(s){selection=s;},revealRange(){}};},createWebviewPanel:()=>({webview:{onDidReceiveMessage(){},postMessage:async()=>{}},onDidDispose(){},dispose(){},reveal(){}})}};
 const load=Module._load;Module._load=function(id,...args){return id==='vscode'?mock:load.call(this,id,...args);};
 const ext=require('../extension');Module._load=load;ext.activate({extensionPath:root,extensionUri:{fsPath:root},subscriptions:[],workspaceState:{get:k=>store[k],update:async(k,v)=>{store[k]=v;}}});
 let fromView;const view={webview:{cspSource:'vscode-resource:',asWebviewUri:u=>u.fsPath,onDidReceiveMessage:fn=>{fromView=fn;},postMessage:async m=>{posted.push(m);}},show(){},onDidDispose(){}};
 providers['pointCode.inspector'].resolveWebviewView(view);assert.match(view.webview.html,/inspector-view\.js/);await fromView({type:'ready'});
 const lastData=()=>posted.filter(m=>m.type==='data'&&m.data).at(-1)?.data;
 let browser;
 try{
  await commands['pointCode.start']();const proxyUrl=clipboard;assert.match(proxyUrl,/^http:\/\/127\.0\.0\.1:\d+\/$/);const proxyOrigin=proxyUrl.slice(0,-1);
  await commands['pointCode.copyScript']();const script=clipboard.match(/src="([^"]+)/)[1];const endpoint=script.replace('/picker.js','/select');
  assert.equal((await request(script.replace(/token=.*/,'token=wrong'))).status,403);
  assert.equal((await request(script,{headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal((await request(proxyUrl,{headers:{Host:'evil.test'}})).status,403);
  const page=await request(proxyUrl,{headers:{'Sec-Fetch-Dest':'document'}});assert.equal(page.status,200);assert.match(page.body,/Choose me/);assert.match(page.body,/<script src="\/__point_code__\/picker\.js\?token=[0-9a-f]+"><\/script>\s*$/);assert.equal(page.headers['x-seen-host'],new URL(url).host);
  assert.doesNotMatch((await request(proxyUrl,{headers:{'Sec-Fetch-Dest':'empty'}})).body,/__point_code__/);
  assert.equal((await request(proxyUrl+'go')).headers.location,proxyOrigin+'/');
  const picker=await request(proxyOrigin+'/__point_code__/picker.js?token='+new URL(script).searchParams.get('token'));assert.match(picker.body,new RegExp(proxyOrigin.replace(/[.:/]/g,'\\$&')+'/__point_code__/select'));
  const upgraded=await new Promise((resolve,reject)=>{const r=http.request(proxyUrl+'hmr',{headers:{Connection:'Upgrade',Upgrade:'websocket'}});r.on('upgrade',(res,socket)=>{socket.once('data',d=>{socket.destroy();resolve({host:res.headers['x-seen-host'],echo:String(d)});});socket.write('ping');});r.on('error',reject);r.end();});
  assert.deepEqual(upgraded,{host:new URL(url).host,echo:'ping'});
  const select=(origin,el)=>request(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:JSON.stringify({tag:'button',id:'',classes:[],text:'Choose me',...el})});
  opened=selection=undefined;
  assert.equal((await select(url,{source:{file:'demo.html',line:2,column:1}})).status,204);
  await until(()=>lastData()?.element.label==='demo.html:2');
  assert.equal(opened,undefined,'selecting does not steal the editor');
  await fromView({type:'open',id:lastData().element.id});await until(()=>opened===path.join(root,'demo.html')&&selection?.start.line===1);
  opened=selection=undefined;assert.equal((await select(proxyOrigin,{source:{file:'demo.html'}})).status,204);await until(()=>lastData()?.element);
  opened=selection=undefined;assert.equal((await select(url.replace('127.0.0.1','localhost'),{source:{file:url+'/demo.html?t=1',line:1,approx:true}})).status,204);await until(()=>lastData()?.element.label);
  assert.equal((await select('http://evil.test',{})).status,403);
  assert.equal((await request(endpoint,{method:'POST',headers:{Origin:url},body:'{}'})).status,400);
  const panels=[];mock.window.createWebviewPanel=()=>{const p={webview:{onDidReceiveMessage(){},postMessage:async()=>{}},onDidDispose(){},dispose(){},reveal(){p.revealed=true;}};panels.push(p);return p;};
  clipboard='';await commands['pointCode.start']();assert.equal(clipboard,'','a running session reopens its preview without asking for the URL again');
  await commands['pointCode.stop']();await commands['pointCode.start']();assert.equal(clipboard,proxyUrl,'port is stable across restarts');
  await commands['pointCode.copyScript']();assert.equal(clipboard.match(/src="([^"]+)/)[1],script,'token is stable across restarts');
  console.log('PASS HTTP: token/origin/host checks, proxy injection, redirect rewrite, HMR upgrade tunnel, exact + approximate source navigation, stable port and token');
  if(process.env.HTTP_ONLY)return;
  opened=selection=undefined;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const tab=await browser.newPage();await tab.goto(proxyUrl);
  const ui=tab.locator('[data-point-code-ui]');await ui.locator('button').click();
  await tab.locator('#menu').dispatchEvent('pointerdown');assert.equal(await tab.evaluate(()=>window.pointerDowns),0,'pointerdown blocked while picking');
  await tab.locator('#target').hover();assert.equal(await ui.locator('.box').isVisible(),true);
  await tab.locator('#target').click();await tab.waitForFunction(()=>document.querySelector('[data-point-code-ui]').shadowRoot.querySelector('span').textContent==='선택 전달 완료');
  assert.equal(opened,undefined,'pick does not open an editor tab');assert.equal(await tab.evaluate(()=>window.normalClicks),0);
  await until(()=>lastData()?.rules.length);const d=lastData();
  assert.deepEqual(d.rules.map(r=>r.selector),['#target','button'],'rules sorted by priority');
  assert.equal(d.rules[1].decls.find(x=>x.p==='color').over,true,'button color is overridden by #target');
  assert.equal(d.rules[1].decls.find(x=>x.p==='padding').over,false);
  assert.deepEqual(d.states.map(r=>[r.selector,r.state]),[['#target:hover',':hover']]);
  assert.equal(d.inherited[0].from,'body');assert.equal(d.inherited[0].decls[0].p,'font-family');
  assert.equal(d.hovered,true);assert.ok(d.computed.some(([p,v])=>p==='color'&&v==='rgb(0, 0, 255)'),'computed values are taken while hovered');
  assert.ok(d.tokens.some(t=>t.n==='--brand'),'design tokens collected');
  const targetRule=d.rules.find(r=>r.selector==='#target');
  assert.equal(targetRule.loc.save,true,'workspace CSS can be saved');
  const sel=d.sel;assert.ok(sel,'each pick has a selection id');
  await fromView({type:'preview',selId:sel,mode:'css',id:targetRule.loc.id,prop:'color',value:'#00ff00',css:[{selector:'#target',prop:'color',value:'#00ff00',scope:'rule'}]});
  await tab.waitForFunction(()=>getComputedStyle(document.querySelector('#target')).color==='rgb(0, 255, 0)');
  const before=posted.length;
  await fromView({type:'preview',selId:sel,mode:'text',id:d.element.id,value:'Changed',old:'Choose me',text:'Changed'});
  await tab.waitForFunction(()=>document.querySelector('#target').textContent.includes('Changed'));
  // Two edits to the same file in one save: both must land (they used to overwrite each other).
  const buttonRule=d.rules.find(r=>r.selector==='button');
  await fromView({type:'save',items:[
    {key:'a',selId:sel,mode:'token',token:'--brand',value:'#0000ff',file:cssPath},
    {key:'b',selId:sel,mode:'css',id:buttonRule.loc.id,prop:'padding',value:'9px'},
    {key:'c',selId:sel,mode:'text',id:d.element.id,value:'Changed',old:'Choose me'}]});
  await until(()=>posted.some((m,i)=>i>=before&&m.type==='save-result'));
  const result=posted.filter(m=>m.type==='save-result').at(-1);
  assert.deepEqual(result.results.map(r=>r.ok),[true,true,true],JSON.stringify(result.results));
  const css=fsSync.readFileSync(cssPath,'utf8');
  assert.match(css,/--brand: #0000ff/);assert.match(css,/button\{color:green;padding:9px\}/);
  assert.ok(fsSync.readFileSync(path.join(root,'demo.html'),'utf8').includes('Changed'));
  const bodyRule=d.inherited.find(r=>r.from==='body');
  await fromView({type:'preview',selId:sel,mode:'css',id:bodyRule.loc.id,prop:'font-family',value:'monospace',css:[{selector:'body',prop:'font-family',value:'monospace',scope:'rule'}],highlight:{selector:'body',from:'body',broad:false}});
  await tab.waitForFunction(()=>document.body.getAttribute('data-point-from')==='');
  await tab.locator('#target').click();assert.equal(await tab.evaluate(()=>window.normalClicks),1);
  await tab.locator('#menu').click();assert.equal(await tab.evaluate(()=>window.pointerDowns),1,'pointerdown passes when not picking');
  await tab.keyboard.press('Alt+Shift+P');await tab.keyboard.press('Escape');assert.equal(await ui.locator('button').textContent(),'요소 선택');
  await tab.addScriptTag({url:script});assert.equal(await tab.locator('[data-point-code-ui]').count(),1);
  // Board frames: no picker UI and no SSE connection of their own; previews arrive from the parent by postMessage.
  const board=await browser.newPage();let sse=0;board.on('request',r=>{if(r.url().includes('/__point_code__/live'))sse++;});
  await board.setContent('<iframe name="point-code-board" src="'+proxyUrl+'" style="width:800px;height:600px"></iframe>');
  const frame=await (await board.waitForSelector('iframe')).contentFrame();await frame.waitForFunction(()=>!!window.__pointCodeCleanup);
  assert.equal(await frame.locator('[data-point-code-ui]').count(),0,'no picker UI in board frames');
  await board.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({__pointCode:'live',payload:{channel:'palette',tokens:[{n:'--brand',v:'#123456'}]}},'*'));
  await frame.waitForFunction(()=>document.documentElement.style.getPropertyValue('--brand')==='#123456');
  await board.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({__pointCode:'live',payload:{channel:'inspector',reset:true}},'*'));
  await new Promise(r=>setTimeout(r,200));
  assert.equal(await frame.evaluate(()=>document.documentElement.style.getPropertyValue('--brand')),'#123456','inspector reset keeps Design System previews');
  assert.equal(sse,0,'board frames open no SSE connection');
  console.log('PASS Chromium via proxy: auto injection, highlight, pointerdown blocking, pick without opening editor, inspector rules/overrides/states/inheritance, live CSS/token/text preview, persist, normal browsing, Escape, reinjection');
 }finally{if(browser)await browser.close();await ext.deactivate();pageServer.close();await fs.unlink(path.join(root,'demo.html')).catch(()=>{});await fs.unlink(cssPath).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
