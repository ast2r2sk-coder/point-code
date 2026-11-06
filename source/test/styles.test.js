// Design values live in media/tokens.css only. View stylesheets refer to its roles, so a theme or spacing change is one edit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const media = path.join(__dirname, '..', 'media');
const VIEWS = ['inspector-view.css', 'palette-view.css', 'screens-view.css', 'preview.css'];
const read = f => fs.readFileSync(path.join(media, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('tokens.css');
const defined = new Set([...tokens.matchAll(/(--pc-[\w-]+)\s*:/g)].map(m => m[1]));

test('view stylesheets use no raw colors', () => {
  for (const f of VIEWS) {
    const css = read(f);
    assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b/gi) || [], [], f + ': hex color, use a token');
    assert.deepEqual(css.match(/\b(?:rgba?|hsla?|oklch)\(/gi) || [], [], f + ': color function, use a token');
    assert.deepEqual(css.match(/var\(--vscode-/g) || [], [], f + ': VS Code variable, map it to a --pc- role in tokens.css');
  }
});

test('every --pc- token a view uses is defined in tokens.css', () => {
  for (const f of [...VIEWS, 'tokens.css']) {
    const used = [...read(f).matchAll(/var\((--pc-[\w-]+)/g)].map(m => m[1]);
    const missing = [...new Set(used.filter(n => !defined.has(n)))];
    assert.deepEqual(missing, [], f + ': undefined tokens');
  }
});

test('every webview loads tokens.css before its own stylesheet', () => {
  const root = path.join(__dirname, '..');
  for (const [file, css] of [['inspector.js', 'inspector-view.css'], ['palette.js', 'palette-view.css'], ['screens.js', 'screens-view.css'], ['extension.js', 'preview.css']]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const t = src.indexOf("('tokens.css')"), v = src.indexOf("('" + css + "')");
    assert.ok(t > 0 && v > t, file + ' links tokens.css then ' + css);
  }
});
