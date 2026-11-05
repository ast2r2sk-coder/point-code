const {test}=require('node:test');const assert=require('node:assert/strict');
const {routesFromPaths,withHomeFallback,htmlToRoute,fillRoute,paramsOf,pickProject,mergeCaptures}=require('../screen-routes');
const {DEVICES}=require('../devices');
const patterns=r=>r.map(s=>s.pattern);

test('Next app router routes',()=>{
  const r=routesFromPaths(['app/page.tsx','app/settings/page.tsx','app/(marketing)/about/page.tsx','app/users/[id]/page.tsx']);
  assert.deepEqual(patterns(r),['/','/settings','/about','/users/[id]']);
});

test('dynamic routes are patterns, not broken URLs',()=>{
  const r=routesFromPaths(['app/users/[id]/page.tsx','pages/blog/[slug].tsx']);
  for(const s of r){assert.equal(s.route,null,'no iframe URL until params are given');assert.ok(s.params.length);}
  assert.deepEqual(paramsOf('/shop/[...slug]/[[lang]]'),['slug','lang']);
  assert.equal(fillRoute('/users/[id]',{id:'42'}),'/users/42');
  assert.equal(fillRoute('/users/[id]',{}),null);
  assert.equal(fillRoute('/docs/[...slug]',{slug:'a/b c'}),'/docs/a/b%20c');
  assert.equal(fillRoute('/docs/[[...slug]]',{}),'/docs');
  assert.equal(fillRoute('/[[lang]]',{}),'/');
});

test('Pages router skips api and specials',()=>{
  const r=routesFromPaths(['pages/index.tsx','pages/about.tsx','pages/api/hello.ts','pages/_app.tsx','pages/blog/[slug].tsx']);
  assert.deepEqual(patterns(r),['/','/about','/blog/[slug]']);
});

test('src/pages and SvelteKit',()=>{
  const r=routesFromPaths(['src/pages/dashboard/index.tsx','src/routes/+page.svelte','src/routes/account/+page.svelte','src/routes/(app)/inbox/+page.svelte']);
  for(const p of ['/dashboard','/','/account','/inbox'])assert.ok(r.some(s=>s.route===p),p);
});

test('React Router SPA: src/pages components are not routes',()=>{
  const projects=[{dir:'',deps:['react','react-router-dom','vite'],scripts:'vite'}];
  const r=routesFromPaths(['index.html','src/pages/Home/components/Card.tsx','src/pages/Home.tsx'],projects);
  assert.deepEqual(patterns(r),['/']);
});

test('monorepo routes are scoped to their own project',()=>{
  const projects=[{dir:'',deps:[],scripts:''},{dir:'apps/web',deps:['next'],scripts:'next dev -p 3001'},{dir:'apps/admin',deps:['next'],scripts:'next dev -p 3002'}];
  const r=routesFromPaths(['apps/web/app/page.tsx','apps/web/app/pricing/page.tsx','apps/admin/app/page.tsx','apps/admin/src/components/app/page.tsx'],projects);
  assert.deepEqual(r.map(s=>s.project+s.pattern),['apps/web/','apps/web/pricing','apps/admin/']);
  assert.equal(pickProject(projects,r,'3002'),'apps/admin','port in dev script');
  assert.equal(pickProject(projects,r,'9999'),'apps/web','most routes');
});

test('vanilla HTML and public assets',()=>{
  assert.equal(htmlToRoute('index.html'),'/');
  assert.equal(htmlToRoute('src/index.html'),'/');
  assert.equal(htmlToRoute('about.html'),'/about');
  assert.equal(htmlToRoute('public/contact.html'),'/contact');
  assert.equal(htmlToRoute('docs/guide/index.html'),'/docs/guide');
  assert.deepEqual(patterns(routesFromPaths(['index.html','about.html','public/hi.html'])),['/','/about','/hi']);
  const next=[{dir:'',deps:['next'],scripts:''}];
  assert.deepEqual(patterns(routesFromPaths(['coverage-report.html','public/legal.html'],next)),['/legal'],'Next serves only public/ HTML');
});

test('home fallback for empty scan',()=>{
  const r=withHomeFallback([]);
  assert.equal(r.length,1);
  assert.equal(r[0].route,'/');
  assert.equal(withHomeFallback([{id:'x',label:'/about',route:'/about',kind:'page'}])[0].route,'/');
});

test('captures merge per document instead of last writer wins',()=>{
  const byDoc=new Map();
  mergeCaptures(byDoc,'preview',[{id:'modal:#m'}],1000);
  assert.equal(mergeCaptures(byDoc,'other',[],2000).length,1,'an empty report from another page keeps the modal');
  assert.equal(mergeCaptures(byDoc,'preview',[],3000).length,0,'the page that owns it closes it');
  mergeCaptures(byDoc,'gone',[{id:'toast:x'}],0);
  assert.equal(mergeCaptures(byDoc,null,[],20000).length,0,'stale documents expire');
});

test('device presets are CSS viewports',()=>{
  for(const d of DEVICES)assert.ok(d.w<=1440&&d.h<=1440,d.id+' looks like physical pixels');
  assert.ok(DEVICES.some(d=>d.id==='fold-cover'));
  assert.equal(new Set(DEVICES.map(d=>d.id)).size,DEVICES.length);
});
