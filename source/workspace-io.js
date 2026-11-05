'use strict';
// Reads and writes for "Save to source". Always through the open TextDocument, never the bytes on disk:
// if the user has unsaved edits in that file, the change is applied on top of them instead of replacing them.
const vscode = require('vscode');
const {EXCLUDE,diffRange,setVariableIn} = require('./core');
const decoder = new TextDecoder();
const CSS_GLOB = '**/*.{css,scss,sass,less,styl,vue,svelte}';

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

module.exports = {readDoc,writeDoc,savedNote,persistToken,CSS_GLOB};
