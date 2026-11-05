from pathlib import Path
import json
import zipfile
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parent
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root.parent/f'point-code-{version}.vsix'
manifest=f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="point-code" Version="{version}" Publisher="personal-tools"/><DisplayName>Point Code</DisplayName><Description xml:space="preserve">Click a local web UI element to inspect components and CSS, live-edit design tokens, and save back to source.</Description><Tags>inspect,css,tailwind,react,vue,svelte,nextjs,cursor,design-tokens</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>'''
content='''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="py" ContentType="text/plain"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>'''
ET.fromstring(manifest);ET.fromstring(content)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('extension.vsixmanifest',manifest);z.writestr('[Content_Types].xml',content)
 skip={'package-vsix.py'}
 for f in root.rglob('*'):
  if not f.is_file() or 'node_modules' in f.parts or '.git' in f.parts: continue
  if f.name in skip or 'test' in f.relative_to(root).parts: continue
  z.write(f,'extension/'+str(f.relative_to(root)).replace('\\','/'))
with zipfile.ZipFile(out) as z: assert z.testzip() is None
print(out)
