// Add to @vitejs/plugin-react's babel.plugins. Development only.
module.exports = function pointCodeBabel({types:t}) {
  return {name:'point-code-source',visitor:{JSXOpeningElement(p,state){
    if(process.env.NODE_ENV==='production') return;
    const name=p.node.name;
    if(name.type!=='JSXIdentifier'||!/^[a-z]/.test(name.name)||!p.node.loc) return;
    if(p.node.attributes.some(a=>a.type==='JSXAttribute'&&a.name.name==='data-point-source'))return;
    const value=JSON.stringify({file:state.filename,line:p.node.loc.start.line,column:p.node.loc.start.column+1});
    p.pushContainer('attributes',t.jsxAttribute(t.jsxIdentifier('data-point-source'),t.stringLiteral(value)));
  }}};
};
