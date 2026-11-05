from pathlib import Path
import json
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr
root=Path(__file__).resolve().parent
pkg=json.loads((root/'package.json').read_text(encoding='utf-8'))
nls=json.loads((root/'package.nls.json').read_text(encoding='utf-8'))
# package.json uses %key% placeholders for localized strings; the gallery manifest needs the default (English) text.
text=lambda v: nls.get(v[1:-1],v) if isinstance(v,str) and v.startswith('%') and v.endswith('%') else v
name,version,publisher=pkg['name'],pkg['version'],pkg['publisher']
engine=pkg['engines']['vscode']
tags=','.join(pkg.get('keywords',[])[:10])
out=root.parent/f'{name}-{version}.vsix'
manifest=f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id={quoteattr(name)} Version={quoteattr(version)} Publisher={quoteattr(publisher)}/><DisplayName>{escape(text(pkg['displayName']))}</DisplayName><Description xml:space="preserve">{escape(text(pkg['description']))}</Description><Tags>{escape(tags)}</Tags><Categories>{escape(','.join(pkg.get('categories',['Other'])))}</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value={quoteattr(engine)}/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/{escape(pkg['icon'])}" Addressable="true"/></Assets></PackageManifest>'''
content='''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="css" ContentType="text/css"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>'''
ET.fromstring(manifest);ET.fromstring(content)
# Source artwork for the README / store page is not needed at runtime.
skip={'package-vsix.py','icon-1024.png','icon-256.png'}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('extension.vsixmanifest',manifest);z.writestr('[Content_Types].xml',content)
 for f in sorted(root.rglob('*')):
  if not f.is_file() or 'node_modules' in f.parts or '.git' in f.parts or '__pycache__' in f.parts: continue
  if f.name in skip or 'test' in f.relative_to(root).parts: continue
  z.write(f,'extension/'+str(f.relative_to(root)).replace('\\','/'))
with zipfile.ZipFile(out) as z: assert z.testzip() is None
print(out)
