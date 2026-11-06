'use strict';
// Pure route discovery for the Screens board (no vscode dependency, unit-tested).

// Dynamic segments: Next/SvelteKit `[id]`, catch-all `[...slug]`, optional `[[...slug]]` / `[[lang]]`.
const PARAM = /\[\[?(?:\.\.\.)?([^\]]+?)\]\]?/g;
const paramsOf = route => [...String(route).matchAll(PARAM)].map(m => m[1]);

function pushRoute(out, id, label, route, extra = {}) {
  if(!route.startsWith('/')) route = '/'+route;
  route = route.replace(/\/+/g,'/');
  if(route.length > 1) route = route.replace(/\/$/,'');
  const project = extra.project || '';
  if(out.some(s=>s.pattern===route && s.kind==='page' && (s.project||'')===project)) return;
  const params = paramsOf(route);
  out.push({id,label:label||route,route:params.length?null:route,pattern:route,params,kind:'page',project});
}

/** Map a relative HTML path to a URL path (vanilla / static / Vite). */
function htmlToRoute(rel) {
  let p = String(rel).replace(/\\/g,'/').replace(/^\.\//,'');
  if(/node_modules\/|\.git\//.test(p)) return null;
  // Prefer public/static/www/dist as web root when present.
  const rooted = p.match(/(?:^|\/)(?:public|static|www|dist)\/(.+)$/i);
  if(rooted) p = rooted[1];
  else {
    // Vite often keeps index.html under src/ but serves it at /.
    if(/^src\/index\.html?$/i.test(p)) return '/';
    if(/^src\//i.test(p)) p = p.slice(4);
  }
  if(!/\.html?$/i.test(p)) return null;
  p = p.replace(/\.html?$/i,'');
  if(/(^|\/)index$/i.test(p)) p = p.replace(/(^|\/)index$/i,'$1').replace(/\/$/,'');
  if(!p || p==='.') return '/';
  return '/'+p;
}

// Frameworks that turn files under `pages/` into routes. A plain React Router SPA also has `src/pages`, but those are components.
const FILE_PAGES = ['next','vite-plugin-pages','unplugin-vue-router','astro','nuxt','@solidjs/start','@tanstack/router-plugin'];
const has = (p, names) => names.some(n => p.deps.includes(n));
/** Deepest project (package.json directory) that contains `rel`. */
function projectFor(projects, rel) {
  let best = null;
  for(const p of projects||[]) if(!p.dir || rel.startsWith(p.dir+'/')) if(!best || p.dir.length > best.dir.length) best = p;
  return best;
}

/**
 * Routes from relative posix paths. With `projects` ({dir, deps}[] from package.json files) each file is matched relative to
 * its own project and only by the routing convention that project actually uses; without it every convention is tried.
 */
function routesFromPaths(rels, projects) {
  const out = [];
  for(const rel of rels) {
    const p = String(rel).replace(/\\/g,'/');
    const proj = projects ? projectFor(projects, p) : null;
    if(projects && !proj) continue;
    const local = proj && proj.dir ? p.slice(proj.dir.length+1) : p;
    const pre = proj ? '^(?:src\\/)?' : '(?:^|\\/)';
    const extra = {project:proj?.dir || ''};
    const next = !proj || has(proj,['next']), kit = !proj || has(proj,['@sveltejs/kit']), filePages = !proj || has(proj,FILE_PAGES);
    let m = local.match(new RegExp(pre+'app\\/(?:(.+)\\/)?page\\.[jt]sx?$'));
    if(m) {
      if(!next) continue;
      const segs = (m[1]||'').split('/').filter(seg=>seg && !seg.startsWith('(') && !seg.startsWith('@'));
      const route = '/'+segs.join('/');
      pushRoute(out,'fs:'+p, route==='/'?'Home':route, route, extra);
      continue;
    }
    m = local.match(new RegExp(pre+'pages\\/(.+)\\.([jt]sx?|vue|svelte)$'));
    if(m) {
      if(!filePages) continue;
      if(/^(?:api\/|_app$|_document$|_error$|404$|500$)/.test(m[1]) || /(^|\/)_[^/]*$/.test(m[1])) continue;
      if(/\.(?:test|spec|stories)$/.test(m[1])) continue;
      const route = '/'+m[1].replace(/(^|\/)index$/,'$1').replace(/\/$/,'');
      pushRoute(out,'fs:'+p, route==='/'?'Home':route, route, extra);
      continue;
    }
    m = local.match(new RegExp((proj?'^src\\/':'(?:^|\\/)')+'routes\\/(?:(.+)\\/)?\\+page\\.'));
    if(m) {
      if(!kit) continue;
      const route = '/'+(m[1]||'').split('/').filter(seg=>seg && !seg.startsWith('(')).join('/');
      pushRoute(out,'fs:'+p, route==='/'?'Home':route, route, extra);
      continue;
    }
    // Vanilla / static HTML. In a Next / SvelteKit app only files under public/ or static/ are served as pages.
    if(/\.html?$/i.test(p)) {
      if(proj && (has(proj,['next']) || has(proj,['@sveltejs/kit'])) && !/^(?:public|static)\//.test(local)) continue;
      const route = htmlToRoute(local);
      if(route) pushRoute(out,'fs:'+p, route==='/'?'Home':route, route, extra);
    }
  }
  return out.slice(0,80);
}

/** Guarantee a Home frame per project when no route resolves to `/`. */
function withHomeFallback(screens, project = '') {
  const list = Array.isArray(screens) ? screens.slice() : [];
  if(!list.some(s=>s.kind==='page' && s.route==='/' && (s.project||'')===project))
    list.unshift({id:'fallback:home:'+project,label:'Home',route:'/',pattern:'/',params:[],kind:'page',project});
  return list;
}

/** Concrete URL path for a dynamic pattern. Optional segments may stay empty; catch-alls may contain `/`. Null if a required value is missing. */
function fillRoute(pattern, values = {}) {
  let missing = false;
  const path = String(pattern).split('/').map(seg => {
    const m = seg.match(/^\[(\[)?(\.\.\.)?([^\]]+?)\]\]?$/);
    if(!m) return seg.replace(PARAM, (_, n) => { const v = String(values[n]||'').trim(); if(!v) missing = true; return encodeURIComponent(v); });
    const v = String(values[m[3]]||'').trim();
    if(!v) { if(!m[1]) missing = true; return null; }
    return m[2] ? v.split('/').filter(Boolean).map(encodeURIComponent).join('/') : encodeURIComponent(v);
  }).filter(seg => seg !== null).join('/');
  return missing ? null : (path.replace(/\/+/g,'/').replace(/(.)\/$/,'$1') || '/');
}

/**
 * Which project the dev server most likely serves: the one whose scripts name the port, then the framework default port,
 * then the one with the most routes.
 */
function pickProject(projects, routes, port) {
  const dirs = [...new Set(routes.map(r=>r.project||''))];
  if(dirs.length <= 1) return dirs[0] || '';
  const byDir = new Map((projects||[]).map(p=>[p.dir,p]));
  if(port) {
    const re = new RegExp('(?:--port[= ]|-p[= ]?|PORT=)'+port+'\\b');
    const hit = dirs.find(d => re.test(byDir.get(d)?.scripts||''));
    if(hit != null) return hit;
    const def = {3000:['next','nuxt','@solidjs/start'],5173:['vite','@sveltejs/kit','astro'],4321:['astro']}[port];
    const fw = def && dirs.filter(d => byDir.get(d) && has(byDir.get(d), def));
    if(fw?.length === 1) return fw[0];
  }
  const count = d => routes.filter(r=>(r.project||'')===d).length;
  return dirs.sort((a,b)=>count(b)-count(a))[0];
}

/**
 * Captured layers per document. Each document replaces only its own entry; entries not refreshed within `ttl` are dropped,
 * so one page's empty report never erases another page's open modal.
 */
function mergeCaptures(byDoc, doc, layers, now = Date.now(), ttl = 12000) {
  if(doc) {
    if(layers.length) byDoc.set(doc,{layers,at:now});
    else byDoc.delete(doc);
  }
  for(const [k,v] of byDoc) if(now-v.at > ttl) byDoc.delete(k);
  return [...byDoc.values()].flatMap(v=>v.layers).slice(0,40);
}

// ---- Screens found at runtime: links on the page (vanilla JS / SPA apps that have one index.html).
const ASSET = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|gz|css|m?js|json|xml|txt|csv|mp4|webm|mp3|wav|woff2?|ttf|otf|map)$/i;
/** Sanitize links reported by a page: same-origin paths only, hash kept only when it is a hash route (`#/x`, `#!/x`). */
function cleanLinks(list, prefix = '/__point_code__/') {
  const out = [], seen = new Set();
  for(const l of Array.isArray(list) ? list.slice(0,100) : []) {
    let route = typeof l?.route === 'string' ? l.route.trim().slice(0,300) : '';
    if(!route.startsWith('/') || route.startsWith('//') || route.startsWith(prefix) || /[\s<>"]/.test(route)) continue;
    const h = route.indexOf('#');
    if(h >= 0 && !/^#!?\//.test(route.slice(h))) route = route.slice(0,h);
    if(ASSET.test(route.replace(/[?#].*$/,''))) continue;
    if(seen.has(route)) continue;
    seen.add(route);
    const label = typeof l?.label === 'string' ? l.label.replace(/\s+/g,' ').trim().slice(0,60) : '';
    out.push({route, label:label || route});
  }
  return out;
}
/** Add newly seen links to the remembered list (oldest first, capped). Returns null when nothing changed. */
function mergeLinks(known, incoming, cap = 60) {
  const have = new Set(known.map(l=>l.route)), add = incoming.filter(l=>!have.has(l.route));
  if(!add.length) return null;
  return [...known, ...add].slice(0, cap);
}

module.exports = {cleanLinks,mergeLinks,routesFromPaths,pushRoute,htmlToRoute,withHomeFallback,fillRoute,paramsOf,pickProject,projectFor,mergeCaptures};
