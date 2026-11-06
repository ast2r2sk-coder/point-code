'use strict';
const path = require('path');
const fs = require('fs/promises');
const {fileURLToPath} = require('url');
const SOURCE_EXT = /\.(tsx?|jsx?|vue|svelte|html?|css|scss|sass|less|mdx)$/;
const EXCLUDE = '**/{node_modules,.git,dist,build,out,coverage,.next,.nuxt,.output,.svelte-kit,.turbo,.vercel,.cache,storybook-static}/**';
function localUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.username || u.password) throw Error('로컬 HTTP 개발 서버 주소를 입력하세요. 예: http://localhost:5173');
  return u;
}
// The same dev server is often opened as localhost in one place and 127.0.0.1 in another.
function originAliases(origin) {
  const u = new URL(origin);
  return ['localhost','127.0.0.1','[::1]'].map(h => 'http://'+h+(u.port ? ':'+u.port : ''));
}
// Accepts paths from Babel, React stacks (Vite URLs, webpack-internal), Svelte/Vue dev metadata and file URLs.
function sourcePath(name) {
  let p = name.trim();
  if (p.startsWith('webpack-internal:///')) p = p.slice(20).replace(/^\([^)]*\)\//, '');
  else if (/^https?:\/\//.test(p)) { p = decodeURIComponent(new URL(p).pathname); p = p.startsWith('/@fs/') ? p.slice(4) : p.replace(/^\/+/, ''); }
  else if (p.startsWith('file://')) { try { p = fileURLToPath(p); } catch { return ''; } }
  p = p.replace(/[?#].*$/, '');
  return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p;
}
async function safeSource(roots, source) {
  if (!source || typeof source.file !== 'string') return null;
  if (source.line != null && (!Number.isInteger(source.line) || source.line < 1)) return null;
  const name = sourcePath(source.file);
  if (!name) return null;
  for (const root of roots) {
    const candidate = path.isAbsolute(name) ? name : path.resolve(root, name);
    try {
      const [base, real] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
      const rel = path.relative(base, real);
      if (!rel || rel === '..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel)) continue;
      // Build output and dependencies are never where the user edits (Next.js server chunks live in .next).
      if (rel.split(path.sep).some(s => s === 'node_modules' || s === '.next')) continue;
      if (!SOURCE_EXT.test(real)) continue;
      if (!(await fs.stat(real)).isFile()) continue;
      return {file:real,line:source.line,column:Number.isInteger(source.column) ? Math.max(1,source.column) : 1,approx:!source.line || source.approx === true};
    } catch {}
  }
  return null;
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-token match so `flex` does not hit `inline-flex`; stylesheet mode expects `.cls` / `#id` selectors.
function hasToken(line, token, prefix) {
  if (prefix) return new RegExp(escapeRe(prefix+token.replace(/[^\w-]/g, c => '\\'+c))+'(?![\\w-])').test(line);
  return new RegExp('(?:^|[\\s"\'`{(,])'+escapeRe(token)+'(?=$|[\\s"\'`}),])').test(line);
}
function matchedClasses(line, el, styles) {
  return (el.classes || []).slice(0,16).filter(c => c.length > 2 && hasToken(line, c, styles ? '.' : ''));
}
// `common` holds classes that hit many lines (Tailwind utilities); they count for little.
function scoreLine(line, el, styles, common) {
  let score = 0;
  if (el.id && hasToken(line, el.id, styles ? '#' : '')) score += 9;
  for (const c of matchedClasses(line, el, styles)) score += common && common.has(c) ? 1 : 3;
  if (!styles && el.text && el.text.length > 3 && line.includes(el.text)) score += 12;
  else if (!styles && el.ownText && el.ownText.length > 3 && line.includes(el.ownText)) score += 10;
  if (!styles && el.tag && line.includes('<'+el.tag)) score += 1;
  return score;
}
function rank(entries, el, styles, limit = 60) {
  const hits = entries.filter(e => scoreLine(e.text, el, styles) >= 3);
  const freq = new Map();
  for (const e of hits) for (const c of matchedClasses(e.text, el, styles)) freq.set(c, (freq.get(c) || 0) + 1);
  const common = new Set([...freq].filter(([, n]) => n > 8).map(([c]) => c));
  return hits.map(e => ({...e, score:scoreLine(e.text, el, styles, common)}))
    .filter(e => e.score >= 3).sort((a, b) => b.score - a.score).slice(0, limit);
}
// Class names in a selector, unescaped (`.hover\:bg-x` -> `hover:bg-x`).
function selectorClasses(selector) {
  return [...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
}
// CSS Modules hash class names in dev (Vite `_title_1x2y3_12`, Next/webpack `page_title__aB3x9`); recover the authored name.
function unhash(c) {
  return c.match(/^_([A-Za-z][\w-]*?)_[\w-]{5,6}(?:_\d+)?$/)?.[1] || c.match(/^[A-Za-z][\w-]*?_([A-Za-z][\w-]*?)__[\w-]{5}$/)?.[1] || c;
}
// Line (1-based, 0 if none) where a matched rule is authored: exact selector, then its classes (SCSS nesting, CSS Modules), then a bare type selector.
// `nest` is the innermost authored selector of a nested rule (`&:hover`); it is searched below the parent's line.
function locateSelector(lines, selector, nest) {
  const norm = s => s.replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
  const base = locateBase(lines, selector, norm);
  if (!base || !nest) return base;
  const inner = norm(nest);
  for (let j = base; j < Math.min(lines.length, base+120); j++) if (norm(lines[j]).includes(inner)) return j+1;
  return base;
}
function locateBase(lines, selector, norm) {
  const sel = norm(selector);
  // A rule header may span lines (`code,\n.counter {`); an exact header beats a selector that merely appears in a list.
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim(), prev = i ? lines[i-1].trim() : '';
    if (!cur || cur.startsWith('/*') || cur.startsWith('//') || (prev && !/[{};]$|\*\/$/.test(prev))) continue;
    let text = '';
    for (let j = i; j < Math.min(lines.length, i+8); j++) { text += ' '+lines[j]; if (lines[j].includes('{')) break; }
    text = text.replace(/\/\*.*?\*\//g, '');
    const k = text.indexOf('{');
    if (k >= 0 && norm(text.slice(0, k)) === sel) return i+1;
  }
  let i = lines.findIndex(l => norm(l).includes(sel));
  if (i >= 0) return i+1;
  for (const c of selectorClasses(selector).reverse().map(unhash)) {
    const hits = lines.map((l, j) => hasToken(l, c, '.') ? j : -1).filter(j => j >= 0);
    const head = hits.find(j => /[{,]\s*$/.test(lines[j]) || /[{,]/.test(lines[j+1]?.trim()[0] || ''));
    if (hits.length) return (head ?? hits[0])+1;
  }
  if (/^[a-z][\w-]*$/.test(sel)) {
    i = lines.findIndex(l => new RegExp('(?:^|[\\s,}])'+sel+'\\s*[{,]').test(l));
    if (i >= 0) return i+1;
  }
  return 0;
}
// JSX usage of a component near the stack line; a string prop that is the visible text wins when close by.
function nearUsage(lines, name, textProp, near) {
  const dist = i => near ? Math.abs(i+1-near) : i;
  const closest = test => lines.map((l,i)=>test(l)?i:-1).filter(i=>i>=0).sort((a,b)=>dist(a)-dist(b))[0];
  const tag = new RegExp('<'+escapeRe(name)+'(?=[\\s/>]|$)');
  const t = closest(l=>tag.test(l));
  if (textProp) {
    let v = textProp.v; try { v = JSON.parse(v); } catch {}
    v = String(v).replace(/…$/, '');
    const s = v.length > 2 ? closest(l=>l.includes(v)) : undefined;
    if (s !== undefined && (t === undefined || Math.abs(s-t) <= 20)) return s+1;
  }
  return t !== undefined ? t+1 : 0;
}
// ---- Source edits from the inspector. All take and return whole file text; null means "not found here".

// Dev-time selector decorations that are not in the authored source: Svelte/Vue scoping hashes, CSS Modules hashes.
function authoredSelector(sel) {
  return sel.replace(/:where\(\.svelte-[\w-]+\)/g, '').replace(/\.svelte-[\w-]+/g, '').replace(/\[data-v-[\da-f]+\]/g, '')
    .replace(/\.((?:\\.|[\w-])+)/g, (m, c) => { const raw = c.replace(/\\(.)/g, '$1'), u = unhash(raw); return u === raw ? m : '.'+u; }).trim();
}
// Comments and strings blanked to spaces (same length) so structure can be scanned on the copy and edits made on the original.
const mask = t => t.replace(/\/\*[\s\S]*?\*\/|(?<![:\w])\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));
const lineStart = (text, line) => { let i = 0; for (let n = 1; n < line; n++) { i = text.indexOf('\n', i); if (i < 0) return -1; i++; } return i; };
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
// Top-level declarations ([start, end) per segment) of the rule block whose header starts on `line`; nested blocks are skipped.
function ruleBlock(text, line, m = mask(text)) {
  const i = lineStart(m, line); if (i < 0) return null;
  const open = m.indexOf('{', i); if (open < 0 || /[;}]/.test(m.slice(i, open))) return null;
  const decls = []; let depth = 0, paren = 0, seg = open+1;
  for (let j = open; j < m.length; j++) {
    const ch = m[j];
    if (ch === '(') paren++; else if (ch === ')') paren--;
    else if (ch === '{') { if (depth === 1) seg = -1; depth++; }
    else if (ch === '}') { depth--; if (!depth) { if (seg >= 0 && m.slice(seg, j).trim()) decls.push([seg, j]); return {open, close:j, decls}; } if (depth === 1) seg = j+1; }
    else if (ch === ';' && depth === 1 && !paren && seg >= 0) { if (m.slice(seg, j).trim()) decls.push([seg, j]); seg = j+1; }
  }
  return null;
}
function declValue(text, m, [a, e]) {
  const head = m.slice(a, e).match(/^\s*([-\w]+)\s*:\s*/); if (!head) return null;
  let end = e; while (end > a+head[0].length && /\s/.test(text[end-1])) end--;
  return {prop:head[1].toLowerCase(), start:a+head[0].length, end};
}
// Set `prop: value` in the rule at `line`: the last existing declaration is replaced (keeping !important), otherwise one is added after the last declaration.
function setDeclaration(text, line, prop, value) {
  const m = mask(text), b = ruleBlock(text, line, m); if (!b) return null;
  const found = b.decls.map(d => declValue(text, m, d)).filter(d => d && d.prop === prop.toLowerCase()).at(-1);
  if (found) {
    const imp = /!\s*important\s*$/i.test(text.slice(found.start, found.end)) && !/!important/i.test(value) ? ' !important' : '';
    return text.slice(0, found.start)+value+imp+text.slice(found.end);
  }
  const last = b.decls.at(-1), multi = text.slice(b.open, b.close).includes('\n');
  const hdr = text.slice(lineStart(text, line)).match(/^[ \t]*/)[0];
  let at = b.open+1, semi = '', indent = hdr+'  ';
  if (last) {
    const d = declValue(text, m, last) || {end:last[1]};
    const startOfDecl = last[0]+m.slice(last[0], last[1]).search(/\S/);
    indent = text.slice(text.lastIndexOf('\n', startOfDecl-1)+1, startOfDecl).match(/^[ \t]*/)[0] || indent;
    if (text[last[1]] === ';') at = last[1]+1; else { at = d.end; semi = ';'; }
  }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  return text.slice(0, at)+semi+(multi ? nl+indent : ' ')+prop+': '+value+';'+text.slice(at);
}
// Value of a custom property definition. With `line`, only inside that rule block; otherwise the definition must be unique.
function setVariable(text, name, value, line) {
  const m = mask(text), re = new RegExp('(^|[{;\\s])('+escapeRe(name)+')\\s*:\\s*', 'g');
  let hits = [...m.matchAll(re)].map(x => {
    let j = x.index+x[0].length, paren = 0;
    for (; j < m.length; j++) { const ch = m[j]; if (ch === '(') paren++; else if (ch === ')') paren--; else if (!paren && (ch === ';' || ch === '}')) break; }
    let end = j; while (end > x.index+x[0].length && /\s/.test(text[end-1])) end--;
    return {start:x.index+x[0].length, end};
  });
  if (line) { const b = ruleBlock(text, line, m); hits = b ? hits.filter(h => h.start > b.open && h.end <= b.close) : []; }
  else if (hits.length !== 1) return null;
  const h = hits.at(-1); if (!h) return null;
  return {text:text.slice(0, h.start)+value+text.slice(h.end), line:lineAt(text, h.start)};
}
// Token definition to edit when a theme defines it more than once (`:root` + `.dark`, `@theme` + `.dark`).
// `selector` is the rule the page reported (compiled CSS, e.g. `:root, :host` for Tailwind v4 `@theme`); otherwise the base theme wins.
function setVariableIn(text, name, value, selector) {
  const lines = text.split(/\r?\n/);
  const inRule = sel => { const n = sel && locateSelector(lines, sel); const r = n && setVariable(text, name, value, n); return r ? {...r, selector:sel} : null; };
  if (selector) {
    const authored = authoredSelector(selector);
    for (const sel of [authored, ...authored.split(',').map(s => s.trim()).filter(Boolean)]) { const r = inRule(sel); if (r) return r; }
  }
  const unique = setVariable(text, name, value);
  if (unique) return {...unique, selector:null};
  for (const sel of [':root', '@theme', 'html']) { const r = inRule(sel); if (r) return r; }
  return null;
}
// Smallest single replacement turning `a` into `b`, so an edit keeps the cursor, folding and undo history of the rest of the file.
function diffRange(a, b) {
  const max = Math.min(a.length, b.length);
  let s = 0; while (s < max && a[s] === b[s]) s++;
  let e = 0; while (e < max-s && a[a.length-1-e] === b[b.length-1-e]) e++;
  return {start:s, end:a.length-e, text:b.slice(s, b.length-e)};
}
// Undo one saved change (`before` -> `after`) in `current`. Works even if the file was edited elsewhere since:
// the changed span with as much surrounding context as still matches must occur exactly once (longest context tried first,
// so nearby edits only shorten the context). Null when the span itself changed or its position is ambiguous.
function revertEdit(current, before, after) {
  if (current === after) return before;
  if (before === after) return current;
  const d = diffRange(before, after), afterEnd = after.length-(before.length-d.end), span = after.slice(d.start, afterEnd);
  for (const [a, b] of [[40,40],[40,0],[0,40],[16,16],[16,0],[0,16],[4,4]]) {
    const pre = after.slice(Math.max(0, d.start-a), d.start), post = after.slice(afterEnd, afterEnd+b);
    const needle = pre+span+post;
    if (!needle) continue;
    const i = current.indexOf(needle);
    if (i < 0) continue;
    if (current.indexOf(needle, i+1) >= 0) return null;
    const s = i+pre.length;
    return current.slice(0, s)+before.slice(d.start, d.end)+current.slice(s+span.length);
  }
  return null;
}
// Runs async jobs one after another (saves that touch the same file must not read the same original text).
function serial() {
  let tail = Promise.resolve();
  return fn => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
}
// Named Tailwind font-weight utilities and numeric aliases used by design systems.
const WEIGHT_NAME = {100:'thin',200:'extralight',300:'light',400:'normal',500:'medium',600:'semibold',700:'bold',800:'extrabold',900:'black'};
const WEIGHT_FROM = Object.fromEntries(Object.entries(WEIGHT_NAME).flatMap(([n, name]) => [[name, name], [n, name], ['w'+n, name]]));
function weightUtil(value) {
  const s = String(value).trim(), v = s.match(/var\(\s*--(?:font-)?weight-([\w-]+)\s*\)/i)?.[1] || s.match(/^var\(\s*--font-weight-([\w-]+)\s*\)$/)?.[1] || s;
  return WEIGHT_FROM[v.toLowerCase()] || WEIGHT_FROM[String(parseInt(v, 10))] || null;
}
// Tailwind: map an edited value back to a class. Theme utilities reference their token (`text-blue-700` -> `var(--color-blue-700)`),
// so a token of the same namespace becomes a sibling class; anything else becomes an arbitrary value (`text-[#f00]`).
function swapUtility(cls, oldValue, newValue, prop) {
  let k = -1, depth = 0;
  for (let i = 0; i < cls.length; i++) { const ch = cls[i]; if (ch === '[' || ch === '(') depth++; else if (ch === ']' || ch === ')') depth--; else if (ch === ':' && !depth) k = i; }
  const variant = cls.slice(0, k+1), base = cls.slice(k+1), neg = base.startsWith('-') ? '-' : '', body = base.slice(neg.length);
  const ov = String(oldValue).match(/var\(\s*--([\w-]+)/)?.[1], nv = String(newValue).trim().match(/^var\(\s*--([\w-]+)\s*\)$/)?.[1];
  // font-bold / font-medium and font-sans / font-mono are named stems, not `font-<number>`.
  if (prop === 'font-weight' && /^font-/.test(body)) {
    const name = weightUtil(newValue); if (name) return variant+'font-'+name;
  }
  if (prop === 'font-family' && /^font-/.test(body)) {
    if (nv?.startsWith('font-')) return variant+'font-'+nv.slice(5);
    const named = String(newValue).trim().match(/^(sans|serif|mono|[\w-]+)$/);
    if (named && !/^\d/.test(named[1])) return variant+'font-'+named[1];
  }
  let stem = null;
  if (ov) for (let j = ov.indexOf('-'); j > 0 && !stem; j = ov.indexOf('-', j+1)) {
    const ns = ov.slice(0, j), suf = ov.slice(j+1);
    if (!body.endsWith('-'+suf)) continue;
    stem = body.slice(0, -suf.length-1);
    if (nv?.startsWith(ns+'-')) return variant+neg+stem+'-'+nv.slice(ns.length+1);
  }
  stem ||= body.match(/^([a-z][a-z-]*?)-(?:\d+(?:\.\d+)?|px|full|auto|screen|none|\d*xs|sm|md|lg|\d*xl|\[.*\]|\(.*\))$/)?.[1];
  if (!stem && prop === 'font-weight' && /^font-/.test(body)) stem = 'font';
  if (!stem) return null;
  const hint = nv && /color|background|border|fill|stroke|outline|decoration|caret|accent/.test(prop) ? 'color:' : '';
  return variant+neg+stem+'-['+hint+String(newValue).trim().replace(/\s+/g, '_')+']';
}
const nearest = (hits, line) => line ? hits.sort((a, b) => Math.abs(a.line-line)-Math.abs(b.line-line))[0] : hits.length === 1 ? hits[0] : null;
// Replace one class token in markup (className, class, cn(...), template literals), nearest to `line`.
function replaceClass(text, line, oldCls, newCls) {
  const re = new RegExp('(^|[\\s"\'`{])'+escapeRe(oldCls)+'(?=$|[\\s"\'`}])');
  const lines = text.split('\n');
  const hit = nearest(lines.map((l, i) => re.test(l) ? {line:i+1} : null).filter(Boolean), line || 0);
  if (!hit) return null;
  lines[hit.line-1] = lines[hit.line-1].replace(re, (_, p) => p+newCls);
  return {text:lines.join('\n'), line:hit.line};
}
// Replace visible text in a template or string literal. Whitespace may differ (JSX/HTML wrap text across lines).
// Characters that would change the meaning of the surrounding syntax are refused instead of escaped.
function replaceText(text, line, oldText, newText, file = '') {
  const words = oldText.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!words.length) return null;
  const hits = [...text.matchAll(new RegExp(words.join('\\s+'), 'g'))].map(x => ({index:x.index, len:x[0].length, line:lineAt(text, x.index)}));
  const hit = nearest(hits, line);
  if (!hit) return hits.length ? {error:'같은 문구가 여러 곳에 있어 위치를 정할 수 없습니다'} : null;
  const prefix = text.slice(text.lastIndexOf('\n', hit.index-1)+1, hit.index);
  const quote = ['"', "'", '`'].find(q => (prefix.split(q).length-1) % 2 === 1);
  if (/\n/.test(newText)) return {error:'줄바꿈은 지원하지 않습니다'};
  if (quote && newText.includes(quote)) return {error:quote+' 문자는 이 위치에 넣을 수 없습니다'};
  if (quote === '`' && newText.includes('${')) return {error:'${ 는 넣을 수 없습니다'};
  if (!quote && /\.[jt]sx$/.test(file) && /[{}<>]/.test(newText)) return {error:'{ } < > 문자는 JSX 텍스트에 직접 넣을 수 없습니다'};
  if (!quote && /\.(vue|svelte|html?|mdx?)$/.test(file) && /[<{]/.test(newText)) return {error:'< { 문자는 템플릿 텍스트에 직접 넣을 수 없습니다'};
  return {text:text.slice(0, hit.index)+newText+text.slice(hit.index+hit.len), line:hit.line};
}
const camel = p => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
// Inline style near the element: JSX `style={{ color: 'red' }}` or markup `style="color: red"`; only literal values are replaced.
function setInlineStyle(text, line, prop, value, file = '') {
  const jsx = /\.[jt]sx?$/.test(file);
  const key = jsx ? escapeRe(camel(prop))+'|[\'"]'+escapeRe(prop)+'[\'"]' : escapeRe(prop);
  const re = new RegExp('(^|[\\s{,;"\'])('+key+')(\\s*:\\s*)(\'[^\'\\n]*\'|"[^"\\n]*"|-?\\d+(?:\\.\\d+)?(?![\\w%])|[^;,"\'}\\n]+)');
  const lines = text.split('\n');
  const hit = nearest(lines.map((l, i) => Math.abs(i+1-line) <= 15 && re.test(l) ? {line:i+1} : null).filter(Boolean), line);
  if (!hit) return null;
  let bad = false;
  lines[hit.line-1] = lines[hit.line-1].replace(re, (_, p, k, sep, old) => {
    if (!jsx) return p+k+sep+value.trim();
    const q = /^['"]/.test(old) ? old[0] : '', num = /^-?\d+(\.\d+)?$/;
    // Expressions (`color: theme.primary`) are code, not a literal to overwrite.
    if (!q && !num.test(old)) bad = true;
    if (q && value.includes(q)) bad = true;
    return p+k+sep+(!q && num.test(value) ? value : (q || "'")+value+(q || "'"));
  });
  return bad ? null : {text:lines.join('\n'), line:hit.line};
}
// ---- Layout: plain intents ("center this", "stack vertically") → CSS declarations, from the computed layout of the element and its parent.
// ctx.self / ctx.parent: {display, dir} computed values; ctx.self.fullWidth: the element spans its parent's content box.
const isFlex = d => /flex/.test(d || ''), isGrid = d => /grid/.test(d || '');
const FLEX_POS = {start:'flex-start', center:'center', end:'flex-end', stretch:'stretch'};
const GRID_POS = {start:'start', center:'center', end:'end', stretch:'stretch'};
function layoutDecls(intent, ctx = {}) {
  const self = ctx.self || {}, parent = ctx.parent || {}, out = [], add = (p, v) => out.push([p, v]);
  const grid = isGrid(self.display);
  // Content alignment needs a flex box; a plain block becomes one (inline stays inline).
  const box = () => { if (isFlex(self.display) || grid) return false; add('display', /^inline/.test(self.display || '') ? 'inline-flex' : 'flex'); return true; };
  const v = intent.value;
  switch (intent.type) {
    case 'flow': {
      if (grid) return {decls:[], error:'grid-flow'};
      const made = box(); add('flex-direction', v === 'column' ? 'column' : 'row');
      return {decls:out, made};
    }
    case 'align': {
      if (!GRID_POS[intent.x] || !GRID_POS[intent.y]) return {decls:[], error:'value'};
      if (grid) { add('justify-items', GRID_POS[intent.x]); add('align-items', GRID_POS[intent.y]); return {decls:out}; }
      const made = box(), column = !made && /column/.test(self.dir || '');
      add('justify-content', FLEX_POS[column ? intent.y : intent.x]);
      add('align-items', FLEX_POS[column ? intent.x : intent.y]);
      return {decls:out, made};
    }
    case 'distribute': {
      const map = grid ? {pack:'start', between:'space-between', evenly:'space-evenly'} : {pack:'flex-start', between:'space-between', evenly:'space-evenly'};
      if (!map[v]) return {decls:[], error:'value'};
      const made = box(); add('justify-content', map[v]);
      return {decls:out, made};
    }
    case 'gap': {
      const made = box(); add('gap', String(v));
      return {decls:out, made};
    }
    case 'self': {
      if (!GRID_POS[v]) return {decls:[], error:'value'};
      const x = intent.axis !== 'y', pf = isFlex(parent.display), pg = isGrid(parent.display);
      if (pg) { add(x ? 'justify-self' : 'align-self', GRID_POS[v]); return {decls:out}; }
      if (pf) {
        const main = x !== /column/.test(parent.dir || '');
        if (!main) { add('align-self', FLEX_POS[v]); return {decls:out}; }
        // Main axis of a flex row/column: auto margins push the item; stretch = take the free space.
        if (v === 'stretch') { add('flex-grow', '1'); return {decls:out}; }
        const [a, b] = x ? ['margin-left', 'margin-right'] : ['margin-top', 'margin-bottom'];
        add(a, v === 'start' ? '0' : 'auto'); add(b, v === 'end' ? '0' : 'auto');
        return {decls:out};
      }
      // Normal flow: only horizontal placement exists, and only for block boxes.
      if (!x) return {decls:[], error:'block-y'};
      if (/^inline/.test(self.display || '')) return {decls:[], error:'inline'};
      if (v === 'stretch') { add('width', 'auto'); add('margin-left', '0'); add('margin-right', '0'); return {decls:out}; }
      if (self.fullWidth) add('width', 'fit-content');
      add('margin-left', v === 'start' ? '0' : 'auto'); add('margin-right', v === 'end' ? '0' : 'auto');
      return {decls:out};
    }
    case 'text': {
      if (!/^(left|center|right|justify)$/.test(v)) return {decls:[], error:'value'};
      add('text-align', v); return {decls:out};
    }
  }
  return {decls:[], error:'intent'};
}

// The same declarations as Tailwind utilities: which classes to add, and which existing ones they replace.
// Only base utilities (no `md:` / `hover:` variant) are replaced; variants are the author's responsive intent.
const TW_GROUP = {
  'display':/^(flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|table)$/,
  'flex-direction':/^flex-(row|col)(-reverse)?$/,
  'justify-content':/^justify-(start|center|end|between|around|evenly|stretch|normal)$/,
  'align-items':/^items-/,
  'justify-items':/^justify-items-/,
  'align-self':/^self-/,
  'justify-self':/^justify-self-/,
  'text-align':/^text-(left|center|right|justify|start|end)$/,
  'gap':/^gap-(?![xy]-)/,
  'flex-grow':/^(flex-)?grow(-0)?$/,
  'margin-x':/^(mx|ml|mr)-(auto|0)$/,
  'margin-y':/^(my|mt|mb)-(auto|0)$/,
  'width':/^w-(fit|auto)$/
};
const TW_VALUE = {
  'display':{flex:'flex','inline-flex':'inline-flex',grid:'grid'},
  'flex-direction':{row:'flex-row',column:'flex-col'},
  'justify-content':{'flex-start':'justify-start',start:'justify-start',center:'justify-center','flex-end':'justify-end',end:'justify-end','space-between':'justify-between','space-evenly':'justify-evenly'},
  'align-items':{'flex-start':'items-start',start:'items-start',center:'items-center','flex-end':'items-end',end:'items-end',stretch:'items-stretch'},
  'justify-items':{start:'justify-items-start',center:'justify-items-center',end:'justify-items-end',stretch:'justify-items-stretch'},
  'align-self':{'flex-start':'self-start',start:'self-start',center:'self-center','flex-end':'self-end',end:'self-end',stretch:'self-stretch'},
  'justify-self':{start:'justify-self-start',center:'justify-self-center',end:'justify-self-end',stretch:'justify-self-stretch'},
  'text-align':{left:'text-left',center:'text-center',right:'text-right',justify:'text-justify'},
  'flex-grow':{'1':'grow'},
  'width':{'fit-content':'w-fit',auto:'w-auto'}
};
function gapUtil(v) {
  const s = String(v).trim(), px = s.match(/^(\d+(?:\.\d+)?)px$/), tok = s.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (s === '0' || s === '0px') return 'gap-0';
  if (px && (+px[1]) % 2 === 0) return 'gap-'+(+px[1]/4);
  if (tok) return 'gap-[var('+tok[1]+')]';
  return /^[\w.%()-]+$/.test(s) ? 'gap-['+s+']' : null;
}
// decls [[prop, value]] → {add, groups} or null when a declaration has no utility equivalent.
function layoutUtilities(decls) {
  const map = new Map(decls), add = [], groups = new Set();
  for (const axis of [['margin-left', 'margin-right', 'margin-x', 'mx', 'ml', 'mr'], ['margin-top', 'margin-bottom', 'margin-y', 'my', 'mt', 'mb']]) {
    const [a, b, group, both, first, second] = axis;
    if (!map.has(a) && !map.has(b)) continue;
    const va = map.get(a), vb = map.get(b); map.delete(a); map.delete(b); groups.add(group);
    if (va === 'auto' && vb === 'auto') add.push(both+'-auto');
    else if (va === 'auto' && vb === '0') add.push(first+'-auto');
    else if (va === '0' && vb === 'auto') add.push(second+'-auto');
    else if (va === '0' && vb === '0') add.push(both+'-0');
    else return null;
  }
  for (const [p, v] of map) {
    const cls = p === 'gap' ? gapUtil(v) : TW_VALUE[p]?.[v];
    if (!cls || !TW_GROUP[p]) return null;
    add.push(cls); groups.add(p);
  }
  return {add, groups:[...groups]};
}
// Apply {add, groups} to a class list string: drop base utilities of those groups, append the new ones.
function setUtilityGroup(classes, change) {
  const toks = String(classes).split(/\s+/).filter(Boolean);
  const kept = toks.filter(t => t.includes(':') || !change.groups.some(g => TW_GROUP[g]?.test(t)));
  for (const c of change.add) if (!kept.includes(c)) kept.push(c);
  return kept.join(' ');
}
// Rewrite the string literal (class="…", className="…", cn('…'), template text) that holds `anchor`, nearest to `line`.
function rewriteClassLiteral(text, line, anchor, fn) {
  const lines = text.split('\n'), hits = [];
  const re = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
  for (let i = Math.max(0, (line || 1)-16); i < Math.min(lines.length, (line || 1)+15); i++) {
    for (const m of lines[i].matchAll(re)) {
      if (m[1] === '`' && m[2].includes('${')) continue;
      if (m[2].split(/\s+/).includes(anchor)) hits.push({line:i+1, start:m.index+1, value:m[2]});
    }
  }
  const hit = nearest(hits, line || 0); if (!hit) return null;
  const next = fn(hit.value); if (next == null || next === hit.value) return next === hit.value ? {text, line:hit.line, before:hit.value, after:next} : null;
  const l = lines[hit.line-1];
  lines[hit.line-1] = l.slice(0, hit.start)+next+l.slice(hit.start+hit.value.length);
  return {text:lines.join('\n'), line:hit.line, before:hit.value, after:next};
}

// ---- Hard-coded values: find the same literal (a color or a length) wherever it is written directly, to turn it into a token.
// Colors match across spellings (#abc, #aabbcc, rgb(170 187 204)); lengths match exactly and only in the same family of
// properties (an 8px padding is not the same decision as an 8px font size). Custom property definitions are skipped:
// `--brand: #0a84ff` is where the token lives, not a hard-coded use.
const HEX = h => h.length <= 5 ? '#'+[...h.slice(1)].map(c => c+c).join('') : h;
function literalKey(v) {
  const s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(s)) { const x = HEX(s); return x.length === 9 && x.endsWith('ff') ? x.slice(0, 7) : x; }
  const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4])/100 : +m[4];
    const hex = '#'+[m[1], m[2], m[3]].map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
    return a >= 1 ? hex : hex+Math.round(a*255).toString(16).padStart(2, '0');
  }
  return s.replace(/\s+/g, ' ');
}
const isColorLiteral = v => /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(String(v).trim());
const FAMILY = [/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/, /radius/, /^(width|height|min-width|max-width|min-height|max-height|flex-basis)$/, /^font-size$/, /^(letter-spacing|line-height)$/, /^(border|outline)(-\w+)*-width$|^(border|outline)$/];
const familyOf = prop => FAMILY.find(re => re.test(prop)) || null;
// Every place `value` is written as a literal inside a declaration: [{start, end, line, prop}].
function findLiterals(text, value, {prop} = {}) {
  const key = literalKey(value), color = isColorLiteral(value), fam = !color && prop ? familyOf(prop) : null;
  if (!color && !/^-?\d*\.?\d+(px|rem|em)$/.test(String(value).trim())) return [];
  const m = mask(text), out = [];
  const decl = /(^|[{;])(\s*)(-{0,2}[A-Za-z][\w-]*)\s*:([^;{}]*)/g;
  const tok = color ? /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g : /(?<![\w.#-])-?\d*\.?\d+(?:px|rem|em)\b/g;
  for (const d of m.matchAll(decl)) {
    const p = d[3].toLowerCase();
    if (p.startsWith('--')) continue;
    if (fam && !fam.test(p)) continue;
    if (!color && !fam && prop && p !== prop) continue;
    const vStart = d.index+d[0].length-d[4].length;
    for (const t of d[4].matchAll(tok)) {
      if (literalKey(t[0]) !== key) continue;
      const start = vStart+t.index;
      out.push({start, end:start+t[0].length, line:lineAt(text, start), prop:p, text:text.slice(start, start+t[0].length)});
    }
  }
  return out;
}
function replaceLiterals(text, value, replacement, opts = {}) {
  const hits = findLiterals(text, value, opts);
  let out = text;
  for (const h of [...hits].reverse()) out = out.slice(0, h.start)+replacement+out.slice(h.end);
  return {text:out, count:hits.length, lines:[...new Set(hits.map(h => h.line))]};
}
// Define a new custom property: in :root (or @theme / html) when the file has one, else in a new :root block at the top.
function addVariable(text, name, value) {
  const m = mask(text);
  if (new RegExp('(^|[{;\\s])'+escapeRe(name)+'\\s*:').test(m)) return {error:'exists'};
  const lines = text.split(/\r?\n/);
  for (const sel of [':root', '@theme', 'html']) {
    const n = locateSelector(lines, sel);
    const next = n && setDeclaration(text, n, name, value);
    if (next) return {text:next, line:n, selector:sel};
  }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  return {text:':root {'+nl+'  '+name+': '+value+';'+nl+'}'+nl+nl+text, line:1, selector:':root', created:true};
}

module.exports = {SOURCE_EXT,EXCLUDE,localUrl,originAliases,sourcePath,safeSource,hasToken,scoreLine,rank,selectorClasses,unhash,locateSelector,nearUsage,
  authoredSelector,setDeclaration,setVariable,setVariableIn,diffRange,revertEdit,serial,swapUtility,replaceClass,replaceText,setInlineStyle,weightUtil,WEIGHT_NAME,
  layoutDecls,layoutUtilities,setUtilityGroup,rewriteClassLiteral,
  literalKey,isColorLiteral,findLiterals,replaceLiterals,addVariable};
