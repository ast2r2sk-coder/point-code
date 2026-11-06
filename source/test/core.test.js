const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {localUrl,originAliases,sourcePath,safeSource,hasToken,scoreLine,rank,selectorClasses,unhash,locateSelector,nearUsage,
  authoredSelector,setDeclaration,setVariable,swapUtility,replaceClass,replaceText,setInlineStyle}=require('../core');
test('selector classes and CSS Modules names',()=>{
  assert.deepEqual(selectorClasses('.hover\\:bg-blue-500:hover'),['hover:bg-blue-500']);
  assert.deepEqual(selectorClasses('.card > .title[data-v-1a2b]'),['card','title']);
  assert.equal(unhash('_title_1x2y3_12'),'title');assert.equal(unhash('page_title__aB3x9'),'title');assert.equal(unhash('btn-primary'),'btn-primary');
});
test('locate authored CSS rule',()=>{
  const css=['.card {','  padding: 8px;','}','.card .title,','.other { color: red }','h1 { margin: 0 }','.title { font-weight: 700 }'];
  assert.equal(locateSelector(css,'.card .title'),4);
  assert.equal(locateSelector(['.card {','  .title { color: red }','}'],'.card .title'),2,'SCSS nesting falls back to the last class');
  assert.equal(locateSelector(['.title {','}'],'._title_1x2y3_12'),1,'CSS Modules hash');
  assert.equal(locateSelector(css,'h1'),6);
  assert.equal(locateSelector(css,'.missing'),0);
  const list=['code,','.counter {','}','','.counter {','  color: red;','}','a>b{}'];
  assert.equal(locateSelector(list,'.counter'),5,'standalone rule, not the selector list');
  assert.equal(locateSelector(list,'code, .counter'),1,'multi-line selector list');
  assert.equal(locateSelector(list,'a > b'),8,'combinator spacing');
  assert.equal(locateSelector(['.counter {','  color: red;','  &:hover {','  }','}','.other { &:hover {} }'],'.counter:hover','&:hover'),3,'native CSS nesting');
});
test('component usage line',()=>{
  const src=['export function Page() {','  return (','    <Card','      title="Hello world"','    />','    <Card title="Other" />','  );','}'];
  assert.equal(nearUsage(src,'Card',null,3),3);
  assert.equal(nearUsage(src,'Card',{v:'"Hello world"'},6),4,'text prop line wins when close to a usage');
  assert.equal(nearUsage(src,'Missing',null,2),0);
});
test('only local HTTP URLs',()=>{assert.equal(localUrl('http://localhost:5173').port,'5173');for(const u of ['https://example.com','http://evil.test','file:///tmp/a','http://user@localhost'])assert.throws(()=>localUrl(u));});
test('localhost aliases',()=>{assert.deepEqual(originAliases('http://localhost:5173'),['http://localhost:5173','http://127.0.0.1:5173','http://[::1]:5173']);});
test('source path bounds and symlink escape',async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'point-'));const outside=await fs.mkdtemp(path.join(os.tmpdir(),'outside-'));try{await fs.writeFile(path.join(root,'App.tsx'),'<div/>');await fs.writeFile(path.join(outside,'secret.ts'),'private');assert.ok(await safeSource([root],{file:'App.tsx',line:1}));assert.equal(await safeSource([root],{file:path.join(outside,'secret.ts'),line:1}),null);assert.equal(await safeSource([root],{file:'App.tsx',line:0}),null);
  const loose=await safeSource([root],{file:'App.tsx'});assert.equal(loose.approx,true);assert.equal(loose.line,undefined);
  assert.ok(await safeSource([root],{file:'http://localhost:5173/App.tsx?t=123',line:4,approx:true}));
  try{await fs.symlink(path.join(outside,'secret.ts'),path.join(root,'link.ts'));}catch(e){if(e.code==='EPERM')return t.skip('symlink needs Developer Mode on Windows');throw e;}
  assert.equal(await safeSource([root],{file:'link.ts',line:1}),null);}finally{await fs.rm(root,{recursive:true});await fs.rm(outside,{recursive:true});}});
test('dev metadata paths',()=>{
  assert.equal(sourcePath('webpack-internal:///(app-pages-browser)/./app/page.tsx'),'./app/page.tsx');
  assert.equal(sourcePath('http://localhost:5173/src/App.tsx?t=1712'),'src/App.tsx');
  assert.equal(sourcePath('http://localhost:5173/@fs/C:/work/app/src/App.tsx'),'C:/work/app/src/App.tsx');
  assert.equal(sourcePath('http://localhost:5173/@fs/Users/me/app/src/App.tsx'),'/Users/me/app/src/App.tsx');
  assert.equal(sourcePath('src/routes/+page.svelte'),'src/routes/+page.svelte');
});
test('whole-token class matching',()=>{
  assert.ok(hasToken('className="flex p-4"','flex',''));assert.ok(!hasToken('className="inline-flex"','flex',''));
  assert.ok(hasToken('.primary:hover { color:red }','primary','.'));assert.ok(!hasToken('.primary-dark {}','primary','.'));
  assert.ok(hasToken('.md\\:flex { display:flex }','md:flex','.'));
});
test('text and stylesheet ranking',()=>{const el={tag:'button',classes:['primary'],text:'Save changes',id:''};assert.ok(scoreLine('<button>Save changes</button>',el,false)>scoreLine('<button/>',el,false));assert.equal(scoreLine('.primary { color:red }',el,true),3);
  assert.equal(scoreLine('<p>Save changes</p>',{tag:'div',classes:[],text:'Header Save changes',ownText:'Save changes'},false),10);});
test('authored selector strips scoping hashes',()=>{
  assert.equal(authoredSelector(':where(.svelte-abc12) .counter'),'.counter');
  assert.equal(authoredSelector('.title[data-v-1a2b3c4d]'),'.title');
  assert.equal(authoredSelector('._title_1x2y3_12'),'.title');
});
test('set CSS declaration in a rule',()=>{
  const css='.badge {\n  color: red;\n  padding: 4px;\n}\n';
  assert.equal(setDeclaration(css,1,'color','blue'),'.badge {\n  color: blue;\n  padding: 4px;\n}\n');
  assert.equal(setDeclaration('.badge { color: red }',1,'color','blue'),'.badge { color: blue }');
  assert.match(setDeclaration('.badge { color: red }',1,'border-radius','8px'),/border-radius: 8px;/);
  const nest='.badge {\n  color: red;\n  &:hover {\n    color: blue;\n  }\n}\n';
  assert.equal(setDeclaration(nest,3,'color','green'),'.badge {\n  color: red;\n  &:hover {\n    color: green;\n  }\n}\n');
  assert.equal(setDeclaration(css,1,'color','#fff !important'),'.badge {\n  color: #fff !important;\n  padding: 4px;\n}\n');
  assert.equal(setDeclaration('/* { } */\n.badge { color: red; }',2,'color','blue'),'/* { } */\n.badge { color: blue; }');
});
test('set CSS variable definition',()=>{
  const t=':root { --brand: #00f; --space: 8px; }\n';
  assert.equal(setVariable(t,'--brand','#0f0').text,':root { --brand: #0f0; --space: 8px; }\n');
  assert.equal(setVariable('.a { --brand: 1 } .b { --brand: 2 }','--brand','x'),null,'ambiguous without a line');
  assert.equal(setVariable('.a { --brand: 1 } .b { --brand: 2 }','--brand','x',1).text,'.a { --brand: x } .b { --brand: 2 }');
});
test('swap Tailwind utility class',()=>{
  assert.equal(swapUtility('text-blue-700','var(--color-blue-700)','var(--color-red-500)','color'),'text-red-500');
  assert.equal(swapUtility('hover:text-blue-700','var(--color-blue-700)','var(--color-red-500)','color'),'hover:text-red-500');
  assert.equal(swapUtility('text-blue-700','var(--color-blue-700)','#ff0000','color'),'text-[#ff0000]');
  assert.equal(swapUtility('px-3','0.75rem','1rem','padding-inline'),'px-[1rem]');
  assert.equal(swapUtility('font-bold','700','500','font-weight'),'font-medium');
  assert.equal(swapUtility('font-bold','700','var(--font-weight-semibold)','font-weight'),'font-semibold');
  assert.equal(swapUtility('font-sans','sans-serif','var(--font-mono)','font-family'),'font-mono');
});
test('replace class and text in source',()=>{
  assert.equal(replaceClass('return <span className="rounded-md text-blue-700">Hi</span>',1,'text-blue-700','text-red-500').text,
    'return <span className="rounded-md text-red-500">Hi</span>');
  assert.equal(replaceText('return <span>Hello notice</span>','1','Hello notice','Hello world','a.tsx').text,'return <span>Hello world</span>');
  assert.equal(replaceText('return <span>{"Hello"}</span>',1,'Hello','Hi','a.tsx').text,'return <span>{"Hi"}</span>');
  assert.equal(replaceText('<p>Hello</p>',1,'Hello','<b>','.vue').error,'< { 문자는 템플릿 텍스트에 직접 넣을 수 없습니다');
  assert.equal(setInlineStyle("style={{ color: 'red', padding: 4 }}",1,'color','blue','a.tsx').text,"style={{ color: 'blue', padding: 4 }}");
  assert.equal(setInlineStyle('<div style="color: red">',1,'color','blue','a.html').text,'<div style="color: blue">');
});
test('common utility classes are demoted',()=>{
  const el={tag:'div',classes:['flex','items-center','card-header'],text:'',id:''};
  const lines=Array.from({length:20},(_,i)=>({text:'<div className="flex items-center">',line:i+1})).concat({text:'<div className="flex card-header">',line:99});
  const ranked=rank(lines,el,false);assert.equal(ranked[0].line,99);assert.ok(ranked.every(e=>e.line===99||e.score<ranked[0].score));
});
const {setVariableIn,diffRange,serial}=require('../core');
test('token save picks the theme rule (light/dark duplicates)',()=>{
  const css=':root {\n  --primary: #111;\n}\n.dark {\n  --primary: #eee;\n}\n';
  assert.equal(setVariable(css,'--primary','#f00'),null,'ambiguous by itself');
  const base=setVariableIn(css,'--primary','#f00');
  assert.equal(base.text,':root {\n  --primary: #f00;\n}\n.dark {\n  --primary: #eee;\n}\n');assert.equal(base.selector,':root');assert.equal(base.line,2);
  assert.equal(setVariableIn(css,'--primary','#0f0','.dark').text,':root {\n  --primary: #111;\n}\n.dark {\n  --primary: #0f0;\n}\n');
  const tw='@theme inline {\n  --color-brand: red;\n}\n.dark { --color-brand: blue; }\n';
  assert.equal(setVariableIn(tw,'--color-brand','green',':root, :host').text,'@theme inline {\n  --color-brand: green;\n}\n.dark { --color-brand: blue; }\n','Tailwind v4 compiled selector maps to @theme');
  assert.equal(setVariableIn('.a{--x:1}.b{--x:2}','--x','3'),null,'still refuses to guess between unrelated rules');
});
test('minimal edit range',()=>{
  assert.deepEqual(diffRange('a { color: red; }','a { color: blue; }'),{start:11,end:14,text:'blue'});
  assert.deepEqual(diffRange('same','same'),{start:4,end:4,text:''});
  const a='x\n.btn{padding:1px}\n',b='x\n.btn{padding:1px;color:red}\n',d=diffRange(a,b);
  assert.equal(a.slice(0,d.start)+d.text+a.slice(d.end),b);
});
test('serial saves do not overwrite each other',async()=>{
  let file='.a{}';const run=serial();const read=async()=>{await new Promise(r=>setTimeout(r,5));return file;};
  const edit=add=>run(async()=>{const t=await read();await new Promise(r=>setTimeout(r,5));file=t.replace('}',add+'}');});
  await Promise.all([edit('color:red;'),edit('padding:0;'),run(async()=>{throw Error('x');}).catch(()=>{}),edit('margin:0;')]);
  assert.equal(file,'.a{color:red;padding:0;margin:0;}');
});
const {revertEdit}=require('../core');
test('undo a saved edit, even after other edits in the file',()=>{
  const before='.a { color: red; }\n.b { margin: 0; }\n',after='.a { color: blue; }\n.b { margin: 0; }\n';
  assert.equal(revertEdit(after,before,after),before,'file unchanged since save');
  const edited='/* new */\n'+after.replace('margin: 0','margin: 4px');
  assert.equal(revertEdit(edited,before,after),'/* new */\n'+before.replace('margin: 0','margin: 4px'),'other edits are kept');
  assert.equal(revertEdit('.a { color: green; }\n',before,after),null,'the saved span itself was changed: refuse');
  assert.equal(revertEdit(after+after,before,after),null,'ambiguous: refuse');
  assert.equal(revertEdit('x',before,before),'x');
});

const {layoutDecls,layoutUtilities,setUtilityGroup,rewriteClassLiteral}=require('../core');
test('layout intents follow the element and its parent', () => {
  const block={self:{display:'block'},parent:{display:'block'}};
  // Aligning the content of a plain block turns it into a flex box first.
  assert.deepEqual(layoutDecls({type:'align',x:'center',y:'center'},block),{decls:[['display','flex'],['justify-content','center'],['align-items','center']],made:true});
  // A column flex box swaps the axes.
  assert.deepEqual(layoutDecls({type:'align',x:'end',y:'start'},{self:{display:'flex',dir:'column'}}).decls,[['justify-content','flex-start'],['align-items','flex-end']]);
  assert.deepEqual(layoutDecls({type:'align',x:'start',y:'end'},{self:{display:'grid'}}).decls,[['justify-items','start'],['align-items','end']]);
  assert.equal(layoutDecls({type:'flow',value:'column'},{self:{display:'grid'}}).error,'grid-flow');
  assert.deepEqual(layoutDecls({type:'flow',value:'column'},{self:{display:'inline'}}).decls,[['display','inline-flex'],['flex-direction','column']]);
  assert.deepEqual(layoutDecls({type:'distribute',value:'between'},{self:{display:'flex'}}).decls,[['justify-content','space-between']]);
  assert.deepEqual(layoutDecls({type:'gap',value:'12px'},{self:{display:'flex'}}).decls,[['gap','12px']]);
  // Placing the element itself: block parent = auto margins (and fit-content when it spans the row); no vertical placement.
  assert.deepEqual(layoutDecls({type:'self',axis:'x',value:'center'},{self:{display:'block',fullWidth:true},parent:{display:'block'}}).decls,[['width','fit-content'],['margin-left','auto'],['margin-right','auto']]);
  assert.deepEqual(layoutDecls({type:'self',axis:'x',value:'end'},block).decls,[['margin-left','auto'],['margin-right','0']]);
  assert.equal(layoutDecls({type:'self',axis:'y',value:'center'},block).error,'block-y');
  assert.equal(layoutDecls({type:'self',axis:'x',value:'center'},{self:{display:'inline-block'},parent:{display:'block'}}).error,'inline');
  // Flex parent: cross axis = align-self, main axis = auto margins / grow.
  assert.deepEqual(layoutDecls({type:'self',axis:'y',value:'center'},{self:{},parent:{display:'flex',dir:'row'}}).decls,[['align-self','center']]);
  assert.deepEqual(layoutDecls({type:'self',axis:'x',value:'end'},{self:{},parent:{display:'flex',dir:'row'}}).decls,[['margin-left','auto'],['margin-right','0']]);
  assert.deepEqual(layoutDecls({type:'self',axis:'y',value:'stretch'},{self:{},parent:{display:'flex',dir:'column'}}).decls,[['flex-grow','1']]);
  assert.deepEqual(layoutDecls({type:'self',axis:'x',value:'center'},{self:{},parent:{display:'grid'}}).decls,[['justify-self','center']]);
  assert.deepEqual(layoutDecls({type:'text',value:'center'},block).decls,[['text-align','center']]);
  assert.equal(layoutDecls({type:'text',value:'x;y'},block).error,'value');
});
test('layout as Tailwind utilities replaces only the same group', () => {
  const ch=layoutUtilities([['display','flex'],['justify-content','center'],['align-items','center'],['gap','12px']]);
  assert.deepEqual(ch,{add:['flex','justify-center','items-center','gap-3'],groups:['display','justify-content','align-items','gap']});
  assert.equal(setUtilityGroup('block items-start md:items-end gap-2 px-4 text-sm',ch),'md:items-end px-4 text-sm flex justify-center items-center gap-3');
  assert.deepEqual(layoutUtilities([['width','fit-content'],['margin-left','auto'],['margin-right','auto']]).add,['mx-auto','w-fit']);
  assert.deepEqual(layoutUtilities([['margin-left','auto'],['margin-right','0']]).add,['ml-auto']);
  assert.equal(setUtilityGroup('mx-auto mt-4',layoutUtilities([['margin-left','auto'],['margin-right','0']])),'mt-4 ml-auto');
  assert.deepEqual(layoutUtilities([['gap','var(--space-3)']]).add,['gap-[var(--space-3)]']);
  assert.equal(layoutUtilities([['margin-left','4px'],['margin-right','auto']]),null,'no utility for an arbitrary margin pair');
});
test('class literal rewrite finds the string that holds the element classes', () => {
  const src='export function Card(){\n  return <div className="card p-4 items-start">\n    <b className={cn("title", active && "on")}>Hi</b>\n  </div>;\n}';
  const r=rewriteClassLiteral(src,2,'card',v=>setUtilityGroup(v,layoutUtilities([['display','flex'],['align-items','center']])));
  assert.equal(r.line,2);assert.equal(r.after,'card p-4 flex items-center');
  assert.match(r.text,/className="card p-4 flex items-center"/);assert.match(r.text,/cn\("title", active && "on"\)/);
  assert.equal(rewriteClassLiteral(src,2,'missing',v=>v+' x'),null);
  // Template literals with expressions are code, not a class list.
  assert.equal(rewriteClassLiteral('<a className={`btn ${size}`}>',1,'btn',v=>v+' flex'),null);
});

const {literalKey,findLiterals,replaceLiterals,addVariable}=require('../core');
test('hard-coded literals are found across spellings, never in token definitions', () => {
  assert.equal(literalKey('#0A84FF'),literalKey('rgb(10, 132, 255)'));
  assert.equal(literalKey('#abc'),'#aabbcc');assert.equal(literalKey('rgb(0 0 0 / 50%)'),'#00000080');
  const css=':root{--brand:#0a84ff}\n.a{color:#0A84FF;border:1px solid rgb(10 132 255)}\n/* #0a84ff */\n.b{background:url("#0a84ff");padding:8px 16px;font-size:8px}\n.c{margin:8px}\n';
  const hits=findLiterals(css,'#0a84ff');
  assert.deepEqual(hits.map(h=>[h.line,h.prop,h.text]),[[2,'color','#0A84FF'],[2,'border','rgb(10 132 255)']],'comments, strings and --brand itself are skipped');
  assert.deepEqual(findLiterals(css,'8px',{prop:'padding'}).map(h=>[h.line,h.prop]),[[4,'padding'],[5,'margin']],'same family only (not font-size)');
  const r=replaceLiterals(css,'#0a84ff','var(--brand)');
  assert.equal(r.count,2);assert.match(r.text,/\.a\{color:var\(--brand\);border:1px solid var\(--brand\)\}/);assert.match(r.text,/--brand:#0a84ff/);
  assert.deepEqual(findLiterals('a:hover{color:red}','#0a84ff'),[]);
  assert.deepEqual(findLiterals(css,'center'),[],'only colors and lengths');
});
test('a new token goes into :root, or a new :root block', () => {
  const a=addVariable(':root{\n  --ink: #111;\n}\n.a{color:red}\n','--brand','#0a84ff');
  assert.equal(a.selector,':root');assert.match(a.text,/--ink: #111;\n  --brand: #0a84ff;\n\}/);
  const b=addVariable('.a{color:red}\n','--brand','#0a84ff');
  assert.equal(b.created,true);assert.match(b.text,/^:root \{\n  --brand: #0a84ff;\n\}\n\n\.a/);
  assert.equal(addVariable(':root{--brand:#000}','--brand','#fff').error,'exists');
});
