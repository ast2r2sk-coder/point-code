// Webview UIs (Screens board, Design System, Inspector) in Chromium with a stubbed VS Code API. Needs Playwright (PLAYWRIGHT_PATH or 'playwright').
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');const http=require('http');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
const media=path.join(__dirname,'..','media');
async function boards(){
  let loads=0;
  const app=http.createServer((q,r)=>{if(q.url!=='/favicon.ico')loads++;r.setHeader('Content-Type','text/html');r.end('<h1>'+q.url+'</h1>');});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();const sent=[];
    await page.exposeFunction('__sent',m=>sent.push(m));
    const stub='window.acquireVsCodeApi=()=>({postMessage:m=>window.__sent(m),getState:()=>null,setState(){}});';
    const html=(css,js)=>'<!doctype html><style>'+fs.readFileSync(path.join(media,'tokens.css'),'utf8')+fs.readFileSync(path.join(media,css),'utf8')+'</style><div id="root"></div><script>'+stub+'</script><script>'+fs.readFileSync(path.join(media,js),'utf8')+'</script>';
    // ---- Screens board
    await page.setContent(html('screens-view.css','screens-view.js'));
    const devices=require(path.join(media,'..','devices.js')).DEVICES;
    const msg=(extra={})=>({type:'screens',base,devices,projects:[],project:'',screens:[
      {id:'a',label:'Home',route:'/',pattern:'/',params:[],kind:'page'},
      {id:'b',label:'/about',route:'/about',pattern:'/about',params:[],kind:'page'},
      {id:'c',label:'/users/[id]',route:null,pattern:'/users/[id]',params:['id'],values:{},kind:'page'},
      ...(extra.cap?[{id:'cap:m',label:'모달',route:'/',kind:'modal',selector:'#m'}]:[])]});
    const post=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
    await post(msg());await page.waitForFunction(()=>document.querySelectorAll('iframe').length===2);
    await new Promise(r=>setTimeout(r,500));const first=loads;assert.equal(first,2,'two frames loaded');
    for(let i=0;i<5;i++)await post(msg({cap:i%2===0}));               // repeated pushes (captures appear/disappear)
    await page.locator('input[type=range]').fill('0.5');                // zoom
    await page.locator('.devices button',{hasText:'iPhone'}).click();   // device
    await page.locator('.frame.kind-page input[type=checkbox]').first().check(); // selection
    await new Promise(r=>setTimeout(r,600));
    assert.equal(loads,first,'no frame reloads on pushes / zoom / device / selection');
    const w=await page.evaluate(()=>document.querySelector('iframe').style.width);assert.equal(w,'390px','device applied in place');
    assert.equal(await page.locator('.frame.kind-modal').count(),1,'capture card shown');
    // dynamic route: form instead of iframe, submit sends params
    await page.locator('.params input').fill('42');await page.locator('.params button').click();
    await new Promise(r=>setTimeout(r,100));assert.deepEqual(sent.find(m=>m.type==='params'),{type:'params',id:'c',values:{id:'42'}});
    console.log('PASS screens board: no reloads, in-place sizing, capture card, dynamic params');
    // ---- Design System board
    await page.setContent(html('palette-view.css','palette-view.js'));
    const tokens=[{n:'--brand',v:'#ff0000',c:'#ff0000',kind:'color'},{n:'--gap',v:'8px',c:'8px',kind:'space'}];
    await post({type:'palette',tokens,components:[],pending:[]});
    const input=page.locator('.swatch input[type=text]');await input.click();await input.press('End');
    await page.keyboard.type('aa');
    assert.equal(await input.inputValue(),'#ff0000aa','typing several characters keeps focus');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.key),'--brand:text');
    assert.ok(await page.locator('.swatch.dirty').count(),'dirty mark without re-render');
    // a token refresh from the page while typing keeps caret/focus
    await post({type:'palette',tokens,components:[],pending:[{n:'--brand',v:'#ff0000aa'}]});
    await page.keyboard.type('b');
    assert.equal(await page.locator('.swatch input[type=text]').inputValue(),'#ff0000aab','focus restored after refresh');
    assert.equal(sent.filter(m=>m.type==='preview').length,3);
    console.log('PASS design system: focus kept while typing and across refresh');
  } finally {await browser.close();app.close();}
}
async function inspector(){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();const sent=[];await page.exposeFunction('__sent',m=>sent.push(m));
    await page.setContent('<!doctype html><style>'+fs.readFileSync(path.join(media,'tokens.css'),'utf8')+fs.readFileSync(path.join(media,'inspector-view.css'),'utf8')+'</style><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:m=>window.__sent(m),getState:()=>null,setState(){}});</script><script>'+fs.readFileSync(path.join(media,'inspector-view.js'),'utf8')+'</script>');
    const data=sel=>({type:'data',data:{sel,el:{tag:'button',id:'',classes:[],text:'Delete',ownText:'Delete'},element:{label:'a.tsx:3',id:0,save:true},components:[],
      rules:[{selector:'.btn',decls:[{p:'color',v:'red'},{p:'padding',v:'4px'}],ctx:[],hits:3,loc:{label:'a.css:1',id:1,save:true},base:false},
             {selector:'.x',decls:[{p:'margin',v:'0'}],ctx:[],hits:1,loc:{label:'b.css (규칙 위치 못 찾음)',id:2,save:false},base:false}],
      states:[],inherited:[],computed:[],vars:[],tokens:[],scales:{weight:[],font:[]},hovered:false,error:''}});
    const post=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
    await post(data(1));
    assert.equal(await page.locator('.rule').first().locator('.note').count(),1,'one note per rule, not per declaration');
    const f=page.locator('.edit input[type=text]');
    await f.nth(0).fill('blue');await f.nth(1).fill('8px');
    await page.keyboard.press('Control+s');await new Promise(r=>setTimeout(r,100));
    const save=sent.filter(m=>m.type==='save');assert.equal(save.length,1,'one save message');assert.equal(save[0].items.length,2);
    assert.ok(save[0].items.every(i=>i.selId===1));
    assert.equal(await page.locator('#save').isDisabled(),true,'button disabled while saving');
    await post({type:'save-result',kind:'warn',message:'1개 저장, 1개는 미리보기만 — x',results:[{key:save[0].items[0].key,ok:true,message:'a.css:1 저장'},{key:save[0].items[1].key,ok:false,message:'x'}]});
    assert.equal(await page.locator('#save').textContent(),'소스에 저장 (1)','failed item stays pending');
    // same tag/text, different pick: pending is not carried over silently
    await post(data(2));
    assert.equal(await page.locator('.stale').count(),1,'banner for unsaved edits of previous element');
    assert.equal(await page.locator('#save').textContent(),'소스에 저장');
    await page.locator('.stale button',{hasText:'저장'}).click();await new Promise(r=>setTimeout(r,100));
    const staleSave=sent.filter(m=>m.type==='save').at(-1);assert.equal(staleSave.items[0].selId,1,'saved against the old selection');
    assert.equal(await page.locator('.stale').count(),0);
    console.log('PASS inspector: batched save, partial failure kept pending, per-pick identity, stale banner');
  } finally {await browser.close();}
}

async function undoUi(){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();const sent=[];await page.exposeFunction('__sent',m=>sent.push(m));
    const stub='window.acquireVsCodeApi=()=>({postMessage:m=>window.__sent(m),getState:()=>null,setState(){}});';
    const html=(css,js)=>'<!doctype html><style>'+fs.readFileSync(path.join(media,'tokens.css'),'utf8')+fs.readFileSync(path.join(media,css),'utf8')+'</style><div id="root"></div><script>'+stub+'</script><script>'+fs.readFileSync(path.join(media,js),'utf8')+'</script>';
    const post=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
    const tick=()=>new Promise(r=>setTimeout(r,80));
    // ---- Inspector: per-field revert, cancel all, undo restores the field
    await page.setContent(html('inspector-view.css','inspector-view.js'));
    await post({type:'data',data:{sel:1,el:{tag:'p',id:'',classes:[],text:'Hi',ownText:'Hi'},element:{label:'a.html:1',id:0,save:true},components:[],
      rules:[{selector:'.c',decls:[{p:'color',v:'red'},{p:'margin',v:'0'}],ctx:[],hits:1,loc:{label:'a.css:1',id:1,save:true},base:false}],
      states:[],inherited:[],computed:[],vars:[],tokens:[],scales:{weight:[],font:[]},hovered:false,error:''}});
    const f=page.locator('.edit input[type=text]');
    assert.equal(await page.locator('.revert:visible').count(),0,'no revert before editing');
    await f.nth(0).fill('blue');await f.nth(1).fill('4px');
    assert.equal(await page.locator('.revert:visible').count(),2);
    await page.locator('.editwrap.dirty .revert').first().click();await tick();
    assert.equal(await f.nth(0).inputValue(),'red','field back to its value');
    let all=sent.filter(m=>m.type==='preview-all').at(-1);assert.deepEqual(all.items.map(i=>i.prop),['margin'],'preview keeps only the other edit');
    await page.locator('#cancel').click();await tick();
    all=sent.filter(m=>m.type==='preview-all').at(-1);assert.equal(all.items.length,0);assert.equal(await page.locator('#save').isDisabled(),true);
    assert.equal(await page.locator('#undo').isDisabled(),true,'nothing to undo yet');
    await f.nth(0).fill('green');await page.locator('#save').click();await tick();
    const key=sent.filter(m=>m.type==='save').at(-1).items[0].key;
    await post({type:'save-result',kind:'saved',message:'a.css:1 저장',results:[{key,ok:true,message:'a.css:1 저장'}],batch:7});
    await post({type:'history',canUndo:true,label:'a.css'});
    assert.equal(await page.locator('#undo').isDisabled(),false);
    await page.locator('#undo').click();await tick();assert.ok(sent.some(m=>m.type==='undo'));
    await post({type:'undone',batch:7,keys:[key]});await post({type:'history',canUndo:false,label:''});
    assert.equal(await page.locator('.edit input[type=text]').first().inputValue(),'red','undone save restores the field');
    console.log('PASS inspector: per-field revert, cancel all, undo');
    // ---- Inspector: 배치 (layout) section
    await page.setContent(html('inspector-view.css','inspector-view.js'));
    sent.length=0;
    await post({type:'data',data:{sel:2,doc:'d1',el:{tag:'div',id:'',classes:['card'],text:'Hi',ownText:'Hi'},element:{label:'a.html:1',id:0,save:true},components:[],
      rules:[{selector:'.card',decls:[{p:'padding',v:'8px'}],ctx:[],hits:3,loc:{label:'a.css:4',id:1,save:true},base:false}],
      states:[],inherited:[],computed:[],vars:[],tokens:[],scales:{weight:[],font:[]},hovered:false,error:'',
      layout:{self:{display:'block',dir:'row',justify:'normal',align:'normal',textAlign:'start',placeX:'stretch',placeY:'start',fullWidth:true},parent:{tag:'main',display:'block',dir:'row'}}}});
    assert.match(await page.locator('.ltarget').textContent(),/\.card.*3개 요소/,'says where layout edits go and what else changes');
    assert.equal(await page.locator('[aria-label="세로 위치"] button').first().isDisabled(),true,'no vertical placement in a block parent');
    await page.locator('.pad button[title="정가운데"]').click();await tick();
    const intent=sent.filter(m=>m.type==='layout-intent').at(-1);
    assert.deepEqual(intent.intent,{type:'align',x:'center',y:'center'});assert.equal(intent.ctx.self.display,'block');
    // The host answers with declarations (core.layoutDecls); they become one pending item previewed on the rule.
    await post({type:'layout-decls',selId:2,ui:intent.ui,decls:[['display','flex'],['justify-content','center'],['align-items','center']],made:true});await tick();
    const pv=sent.filter(m=>m.type==='preview').at(-1);
    assert.equal(pv.mode,'layout');assert.equal(pv.target,'css');assert.equal(pv.id,1);
    assert.deepEqual(pv.css.map(c=>[c.selector,c.prop,c.value]),[['.card','display','flex'],['.card','justify-content','center'],['.card','align-items','center']]);
    assert.equal(await page.locator('.pad button.on').getAttribute('title'),'정가운데','pad shows the chosen position');
    assert.equal(await page.locator('.layout.dirty').count(),1);
    // A second intent adds to the same item; the next one knows the box is now flex.
    await page.locator('[aria-label="방향"] button',{hasText:'세로'}).click();await tick();
    assert.equal(sent.filter(m=>m.type==='layout-intent').at(-1).ctx.self.display,'flex');
    await post({type:'layout-decls',selId:2,ui:{},decls:[['flex-direction','column']]});await tick();
    assert.deepEqual(sent.filter(m=>m.type==='preview').at(-1).decls.map(d=>d[0]),['display','justify-content','align-items','flex-direction']);
    await page.locator('#save').click();await tick();
    const ls=sent.filter(m=>m.type==='save').at(-1).items;assert.equal(ls.length,1);assert.equal(ls[0].key,'layout');assert.equal(ls[0].decls.length,4);
    // ↺ on the section drops all layout edits of this pick.
    await post({type:'save-result',kind:'error',message:'x',results:[{key:'layout',ok:false,message:'x'}]});
    await page.locator('.layout .revert').click();await tick();
    assert.equal(sent.filter(m=>m.type==='preview-all').at(-1).items.length,0);assert.equal(await page.locator('.layout.dirty').count(),0);
    // An error from the host is explained, nothing is queued.
    await post({type:'layout-decls',selId:2,error:'block-y',decls:[]});await tick();
    assert.match(await page.locator('#status').textContent(),/부모 선택/);
    await page.locator('.relnav button',{hasText:'부모'}).click();await tick();
    assert.deepEqual(sent.at(-1),{type:'select-relative',dir:'parent'});
    console.log('PASS inspector: layout pad / direction / revert, parent selection');
    // ---- Inspector: 수정 지도
    await page.setContent(html('inspector-view.css','inspector-view.js'));
    sent.length=0;
    await post({type:'data',data:{sel:3,doc:'d1',el:{tag:'button',id:'',classes:['cta'],text:'Go',ownText:'Go'},element:{label:'a.tsx:3',id:0,save:true},
      components:[{name:'Hero',kind:'usage',props:[],loc:{label:'page.tsx:4',id:5,save:true},def:6,lib:false}],
      rules:[{selector:'.cta',decls:[{p:'background',v:'#0A84FF'},{p:'padding',v:'8px 16px'},{p:'color',v:'var(--ink)'}],ctx:[],hits:2,loc:{label:'a.css:9',id:1,save:true},base:false}],
      states:[],inherited:[],computed:[],vars:[],scales:{weight:[],font:[]},hovered:false,error:'',
      tokens:[{n:'--brand',v:'#0a84ff',c:'#0a84ff',kind:'color',file:'/w/tokens.css'},{n:'--ink',v:'#111',c:'#111111',kind:'color'}],
      alike:{same:1,sameSelector:'.cta',groups:[{label:'.btn.blue',count:2},{label:'style 속성',count:1}]}}});
    const mapText=await page.locator('.map').textContent();
    assert.match(mapText,/화면의 2개 요소/);assert.match(mapText,/따로 만든 요소 3개/);assert.match(mapText,/직접 쓴 값 2개/,'hex background and px padding; var() is not hard-coded');
    await page.locator('.map .mbtn',{hasText:/^보기$/}).first().click();await tick();
    assert.deepEqual(sent.at(-1),{type:'flash',group:0});
    await page.locator('.map .mbtn',{hasText:'사용 위치 찾기'}).click();await tick();
    assert.deepEqual(sent.at(-1),{type:'usage',name:'Hero'});
    await post({type:'usage',name:'Hero',count:3,items:[{label:'a.tsx:1',id:7},{label:'b.tsx:2',id:8},{label:'c.tsx:9',id:9}]});await tick();
    assert.match(await page.locator('.map').textContent(),/프로젝트에서 3곳에서 사용/);
    // Same value as an existing token: switch this declaration to the token (a normal pending edit).
    await page.locator('.map .mbtn',{hasText:'토큰 --brand로 바꾸기'}).click();await tick();
    const tp=sent.filter(m=>m.type==='preview').at(-1);assert.equal(tp.value,'var(--brand)');assert.equal(tp.css[0].value,'var(--brand)');
    assert.equal(await page.locator('#save').isDisabled(),false);
    // Find the other places, then replace them all with a new token.
    await page.locator('.map .mbtn',{hasText:'다른 곳도 찾기'}).last().click();await tick();
    const sc=sent.filter(m=>m.type==='scan-literal').at(-1);assert.deepEqual(sc,{type:'scan-literal',value:'8px',prop:'padding'});
    await post({type:'literal-scan',value:'8px',prop:'padding',count:4,files:2,items:[{label:'a.css:9',id:10}],code:{count:0,items:[]}});await tick();
    assert.equal(await page.locator('.mform input').inputValue(),'--space-8','suggested name');
    await page.locator('.mform .mbtn').click();await tick();
    assert.deepEqual(sent.at(-1),{type:'tokenize',value:'8px',prop:'padding',name:'--space-8',create:true,file:'/w/tokens.css'});
    console.log('PASS inspector: 수정 지도 (shared rule, look-alikes, usage, hard-coded → token)');
    // ---- Design System: per-token revert and cancel
    await page.setContent(html('palette-view.css','palette-view.js'));
    await post({type:'palette',tokens:[{n:'--brand',v:'#ff0000',c:'#ff0000',kind:'color'}],components:[],pending:[{n:'--brand',v:'#00ff00'}]});
    assert.equal(await page.locator('.swatch .revert').isVisible(),true);
    await page.locator('.swatch .revert').click();await tick();assert.deepEqual(sent.filter(m=>m.type==='discard').at(-1),{type:'discard',n:'--brand'});
    await page.locator('#cancel').click();await tick();assert.deepEqual(sent.filter(m=>m.type==='discard').at(-1),{type:'discard'});
    console.log('PASS design system: revert one token, cancel all');
    // ---- Screens: captured screen and link cards, capture from a layer
    await page.setContent(html('screens-view.css','screens-view.js'));
    await post({type:'screens',base:'http://127.0.0.1:1',devices:[{id:'desktop',label:'Desktop',w:1440,h:900}],projects:[],project:'',screens:[
      {id:'cap:x',label:'모달',route:'/',kind:'modal',selector:'#m',doc:'abc'},
      {id:'snap:0123456789abcdef',label:'Hello modal · /',route:'/',kind:'snapshot',src:'about:blank'},
      {id:'link:/#/settings',label:'Settings',route:'/#/settings',pattern:'/#/settings',params:[],kind:'page',origin:'link'}]});
    await page.locator('button',{hasText:'이 상태 담기'}).click();await tick();assert.deepEqual(sent.filter(m=>m.type==='capture').at(-1),{type:'capture',doc:'abc'});
    assert.equal(await page.locator('.kind-snapshot iframe').count(),1);
    await page.locator('.kind-snapshot button',{hasText:'이름 바꾸기'}).click();await tick();assert.equal(sent.at(-1).type,'rename');
    await page.locator('button',{hasText:'빼기'}).click();await tick();assert.deepEqual(sent.at(-1),{type:'remove',id:'link:/#/settings'});
    assert.equal(await page.locator('.tip').isVisible(),true,'tip for single-page apps');
    console.log('PASS screens: snapshot / link cards, capture from layer');
  } finally {await browser.close();}
}
(async()=>{await boards();await inspector();await undoUi();})().catch(e=>{console.error(e);process.exitCode=1;});
