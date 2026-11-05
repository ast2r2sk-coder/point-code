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
    const html=(css,js)=>'<!doctype html><style>'+fs.readFileSync(path.join(media,css),'utf8')+'</style><div id="root"></div><script>'+stub+'</script><script>'+fs.readFileSync(path.join(media,js),'utf8')+'</script>';
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
    await page.setContent('<!doctype html><style>'+fs.readFileSync(path.join(media,'inspector-view.css'),'utf8')+'</style><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:m=>window.__sent(m),getState:()=>null,setState(){}});</script><script>'+fs.readFileSync(path.join(media,'inspector-view.js'),'utf8')+'</script>');
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
(async()=>{await boards();await inspector();})().catch(e=>{console.error(e);process.exitCode=1;});
