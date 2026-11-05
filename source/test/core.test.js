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
