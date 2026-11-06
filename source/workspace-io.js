'use strict';
// Reads and writes for "Save to source". Always through the open TextDocument, never the bytes on disk:
// if the user has unsaved edits in that file, the change is applied on top of them instead of replacing them.
const vscode = require('vscode');
const {EXCLUDE,diffRange,setVariableIn,revertEdit,serial} = require('./core');
const decoder = new TextDecoder();
const CSS_GLOB = '**/*.{css,scss,sass,less,styl,vue,svelte}';
// Saves and undos from the inspector and the Design System go through one queue, so they never read the same original text.
const exclusive = serial();

// ---- Save history: each "Save to source" is one entry (all files it touched), undone as a unit.
const history = [], listeners = new Set();
let batch = null, nextId = 1;
const state = () => ({canUndo:history.length>0, label:history.at(-1)?.label||''});
const notify = () => {for(const fn of listeners) try {fn(state());} catch {}};
function onHistory(fn) {listeners.add(fn); return () => listeners.delete(fn);}
function beginBatch(source) {batch = {id:nextId++, source, files:new Map(), undo:[], keys:[], label:''}; return batch;}
// Called while a batch is open: how to restore in-memory state (class names, token values) when the save is undone.
function onUndo(fn) {batch?.undo.push(fn);}
function endBatch() {
  const b = batch; batch = null;
  if(b && b.files.size) {
    b.label = [...b.files.keys()].map(f=>vscode.workspace.asRelativePath(f)).slice(0,3).join(', ');
    history.push(b); if(history.length > 30) history.shift();
    notify();
  }
  return b && b.files.size ? b : null;
}
async function undoLast() {
  const b = history.pop();
  if(!b) return {error:'되돌릴 저장이 없습니다'};
  const done = [], failed = [];
  for(const [file, {before, after}] of b.files) {
    try {
      const next = revertEdit(await readDoc(file), before, after);
      if(next == null) {failed.push(file); continue;}
      await writeDoc(file, next);
      done.push(file);
    } catch {failed.push(file);}
  }
  for(const fn of b.undo) try {fn();} catch {}
  notify();
  const rel = f => vscode.workspace.asRelativePath(f);
  const message = (done.length ? '되돌림: '+done.map(rel).join(', ') : '')+(failed.length ? (done.length?' · ':'')+'저장 뒤 그 부분이 다시 바뀌어 되돌리지 못함: '+failed.map(rel).join(', ') : '');
  return {batch:b, done, failed, message, kind:failed.length ? (done.length?'warn':'error') : 'saved'};
}

async function readDoc(file) {
  return (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
}
// Returns {saved}: false when the document already had unsaved changes — the edit is applied but saving is left to the user,
// so Point Code never writes their half-finished work to disk.
async function writeDoc(file, text) {
  const uri = vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const cur = doc.getText();
  if(cur === text) return {saved:!doc.isDirty};
  const dirty = doc.isDirty, d = diffRange(cur, text);
  if(batch) {const f = batch.files.get(file); if(f) f.after = text; else batch.files.set(file, {before:cur, after:text});}
  const we = new vscode.WorkspaceEdit();
  we.replace(uri, new vscode.Range(doc.positionAt(d.start), doc.positionAt(d.end)), d.text);
  if(!(await vscode.workspace.applyEdit(we))) throw Error('파일에 적용하지 못했습니다');
  if(dirty) return {saved:false};
  await doc.save();
  return {saved:true};
}
const savedNote = w => w.saved ? '' : ' · 편집기에 저장 안 된 변경이 있어 적용만 했습니다 (Ctrl+S로 저장)';

// Token definition: the hinted file first, otherwise the single workspace stylesheet that defines it.
async function persistToken(name, value, {hintFile, selector, resolveFile}) {
  const inFile = async file => {
    const r = setVariableIn(await readDoc(file), name, value, selector);
    if(!r) return null;
    const w = await writeDoc(file, r.text);
    return vscode.workspace.asRelativePath(file)+':'+r.line+(r.selector?' ('+r.selector+')':'')+' · '+name+savedNote(w);
  };
  if(hintFile) {
    const f = await resolveFile(hintFile);
    if(f?.file) {const hit = await inFile(f.file); if(hit) return hit;}
  }
  const hits = [];
  for(const uri of await vscode.workspace.findFiles(CSS_GLOB,EXCLUDE,400)) {
    if(hits.length > 1) break;
    try {
      if((await vscode.workspace.fs.stat(uri)).size > 500000) continue;
      const raw = decoder.decode(await vscode.workspace.fs.readFile(uri));
      if(raw.includes(name) && setVariableIn(raw, name, value, selector)) hits.push(uri.fsPath);
    } catch {}
  }
  return hits.length === 1 ? inFile(hits[0]) : null;
}

module.exports = {readDoc,writeDoc,savedNote,persistToken,CSS_GLOB,exclusive,beginBatch,endBatch,onUndo,undoLast,onHistory,historyState:state};
