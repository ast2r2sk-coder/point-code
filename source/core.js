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
module.exports = {SOURCE_EXT,EXCLUDE,localUrl,originAliases,sourcePath,safeSource,hasToken,scoreLine,rank,selectorClasses,unhash,locateSelector,nearUsage,
  authoredSelector,setDeclaration,setVariable,swapUtility,replaceClass,replaceText,setInlineStyle,weightUtil,WEIGHT_NAME};
