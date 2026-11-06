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
 const ext=require('../extension');Module._load=load;const storage=await fs.mkdtemp(path.join(require('os').tmpdir(),'pc-store-'));
 ext.activate({extensionPath:root,extensionUri:{fsPath:root},storageUri:{fsPath:storage},subscriptions:[],workspaceState:{get:k=>store[k],update:async(k,v)=>{store[k]=v;}}});
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
  const ui=tab.locator('[data-point-code-ui]');await ui.locator('button.pick').click();
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
  // Undo that save: all three edits in both files go back, other content untouched.
  await commands['pointCode.undoSave']();
  await until(()=>fsSync.readFileSync(cssPath,'utf8').includes('--brand: #ff0000'));
  assert.match(fsSync.readFileSync(cssPath,'utf8'),/button\{color:green;padding:4px\}/);
  assert.ok(fsSync.readFileSync(path.join(root,'demo.html'),'utf8').includes('Choose me'),'text edit undone');
  assert.ok(posted.some(m=>m.type==='undone'),'inspector told which save was undone');
  assert.equal(posted.filter(m=>m.type==='history').at(-1).canUndo,false);
  // Cancel: the webview sends the remaining edits (none); the page drops the overlay.
  await fromView({type:'preview-all',selId:sel,items:[]});
  await tab.waitForFunction(()=>getComputedStyle(document.querySelector('#target')).color!=='rgb(0, 255, 0)');
  // Layout: the page reports box facts, the host turns "center both" into declarations, save writes them into the rule, undo restores.
  assert.ok(d.doc,'pick carries its page id');assert.equal(d.layout.parent.tag,'body');assert.ok(d.layout.self.display);
  await fromView({type:'layout-intent',selId:sel,intent:{type:'align',x:'center',y:'center'},ctx:d.layout,ui:{align:{x:'center',y:'center'}}});
  const ld=posted.filter(m=>m.type==='layout-decls').at(-1);
  assert.deepEqual(ld.decls,[['display','inline-flex'],['justify-content','center'],['align-items','center']],'an inline-block button becomes inline-flex');assert.equal(ld.made,true);
  await fromView({type:'layout-intent',selId:sel,intent:{type:'self',axis:'y',value:'center'},ctx:d.layout});
  assert.equal(posted.filter(m=>m.type==='layout-decls').at(-1).error,'block-y','no vertical placement in a block parent');
  const b2=posted.length;
  await fromView({type:'save',items:[{key:'layout',selId:sel,mode:'layout',id:targetRule.loc.id,target:'css',decls:ld.decls}]});
  await until(()=>posted.some((m,i)=>i>=b2&&m.type==='save-result'));
  assert.equal(posted.filter(m=>m.type==='save-result').at(-1).results[0].ok,true,JSON.stringify(posted.filter(m=>m.type==='save-result').at(-1)));
  assert.match(fsSync.readFileSync(cssPath,'utf8'),/#target\{color:var\(--brand\);\s*display:\s*inline-flex;\s*justify-content:\s*center;\s*align-items:\s*center;?\s*\}/);
  await commands['pointCode.undoSave']();
  await until(()=>fsSync.readFileSync(cssPath,'utf8').includes('#target{color:var(--brand)}'));
  // 수정 지도: look-alike facts come with the pick; "show on page" flashes elements; the same hard-coded color
  // in two files becomes one new token in one save, and one undo restores both files.
  assert.ok(d.alike&&Array.isArray(d.alike.groups),'look-alike facts collected');
  await fromView({type:'flash',selector:'#target'});
  await tab.waitForFunction(()=>document.querySelector('#target').hasAttribute('data-point-affected'));
  const extra=path.join(root,'demo-extra.css');await fs.writeFile(extra,'.x{color:#123456}\n.y{border:1px solid #123456}\n');
  const ff=mock.workspace.findFiles;mock.workspace.findFiles=async g=>/css/.test(g)?[{fsPath:cssPath},{fsPath:extra}]:[];
  try{
    await fromView({type:'scan-literal',value:'#123456'});
    const sc=posted.filter(m=>m.type==='literal-scan').at(-1);assert.equal(sc.count,2);assert.equal(sc.files,1);
    const b3=posted.length;
    await fromView({type:'tokenize',value:'#123456',name:'--ink',create:true,file:cssPath});
    await until(()=>posted.some((m,i)=>i>=b3&&m.type==='tokenize-result'));
    assert.equal(posted.filter(m=>m.type==='tokenize-result').at(-1).count,2);
    assert.match(fsSync.readFileSync(cssPath,'utf8'),/:root\{--brand: #ff0000;\s*--ink: #123456;?\s*\}/,'new token defined in :root');
    assert.equal(fsSync.readFileSync(extra,'utf8'),'.x{color:var(--ink)}\n.y{border:1px solid var(--ink)}\n');
    await commands['pointCode.undoSave']();
    await until(()=>fsSync.readFileSync(extra,'utf8').includes('#123456'));
    assert.doesNotMatch(fsSync.readFileSync(cssPath,'utf8'),/--ink/,'one undo restores both files');
  }finally{mock.workspace.findFiles=ff;await fs.unlink(extra).catch(()=>{});}
  const bodyRule=d.inherited.find(r=>r.from==='body');
  await fromView({type:'preview',selId:sel,mode:'css',id:bodyRule.loc.id,prop:'font-family',value:'monospace',css:[{selector:'body',prop:'font-family',value:'monospace',scope:'rule'}],highlight:{selector:'body',from:'body',broad:false}});
  await tab.waitForFunction(()=>document.body.getAttribute('data-point-from')==='');
  // Select the parent from the inspector: the page that made the pick re-picks its parent.
  await fromView({type:'select-relative',dir:'parent'});
  await until(()=>lastData()?.el.tag==='body');
  await fromView({type:'select-relative',dir:'child'});
  await until(()=>lastData()?.el.tag==='button');
  await tab.locator('#target').click();assert.equal(await tab.evaluate(()=>window.normalClicks),1);
  await tab.locator('#menu').click();assert.equal(await tab.evaluate(()=>window.pointerDowns),1,'pointerdown passes when not picking');
  await tab.keyboard.press('Alt+Shift+P');await tab.keyboard.press('Escape');assert.equal(await ui.locator('button.pick').textContent(),'요소 선택');
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
  // Vanilla / single-page apps: links on the page become screens, and "화면 담기" pins the current state.
  await tab.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<a href="/#/settings">Settings</a><a href="/about.html">About</a><input id="q"><dialog open id="m"><h2>Hello modal</h2></dialog>'));
  await tab.fill('#q','hello');
  await until(()=>(store['pointCode.links']?.['']||[]).some(l=>l.route==='/#/settings'));
  assert.ok(store['pointCode.links'][''].some(l=>l.route==='/about.html'&&l.label==='About'));
  await ui.locator('button.snap').click();
  await tab.waitForFunction(()=>document.querySelector('[data-point-code-ui]').shadowRoot.querySelector('span').textContent==='화면 그리드에 담았습니다');
  const snapItem=store['pointCode.snapshots'][0];assert.match(snapItem.label,/Hello modal/);
  const token=new URL(script).searchParams.get('token');
  const snapUrl=proxyOrigin+'/__point_code__/snap/'+snapItem.id+'.html?token='+token;
  assert.equal((await request(snapUrl.replace(token,'wrong'))).status,403);
  const snapPage=await request(snapUrl);assert.equal(snapPage.status,200);
  assert.doesNotMatch(snapPage.body,/normalClicks/,'app scripts removed');
  assert.match(snapPage.body,/<base href="http:\/\/127\.0\.0\.1/);assert.match(snapPage.body,/value="hello"/);assert.match(snapPage.body,/<dialog open/);
  assert.match(snapPage.body,/__point_code__\/picker\.js\?token=/,'picker attached for live previews');
  const snapFrame=await browser.newPage();
  await snapFrame.setContent('<iframe name="point-code-board" src="'+snapUrl+'" style="width:800px;height:600px"></iframe>');
  const sf=await (await snapFrame.waitForSelector('iframe')).contentFrame();await sf.waitForFunction(()=>!!window.__pointCodeCleanup);
  assert.equal(await sf.evaluate(()=>document.querySelector('dialog')?.open),true,'captured modal stays open');
  await snapFrame.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({__pointCode:'live',payload:{channel:'palette',tokens:[{n:'--brand',v:'#654321'}]}},'*'));
  await sf.waitForFunction(()=>document.documentElement.style.getPropertyValue('--brand')==='#654321');
  console.log('PASS Chromium via proxy: auto injection, highlight, pointerdown blocking, pick without opening editor, inspector rules/overrides/states/inheritance, live CSS/token/text preview, persist, normal browsing, Escape, reinjection');
 }finally{if(browser)await browser.close();await ext.deactivate();pageServer.close();await fs.unlink(path.join(root,'demo.html')).catch(()=>{});await fs.unlink(cssPath).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
