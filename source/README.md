# Point Code

**Click a UI element in your local app → see which component and CSS own it → tweak text, color, weight, and spacing in the sidebar → live preview, then save to source.**

Point Code is a [VS Code](https://code.visualstudio.com/) / [Cursor](https://cursor.com/) extension for **local frontend development**. It runs a tiny reverse proxy next to your `npm run dev` server, injects a picker, and opens an **Element Inspector** so you can edit design tokens and utilities without hunting through files.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/ast2r2sk-coder/point-code/blob/main/LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-0.4.2-informational)](https://github.com/ast2r2sk-coder/point-code/blob/main/CHANGELOG.md)
[![GitHub](https://img.shields.io/badge/github-ast2r2sk--coder%2Fpoint--code-181717?logo=github)](https://github.com/ast2r2sk-coder/point-code)

> **Keywords:** VS Code extension, Cursor extension, element inspector, click to source, CSS cascade viewer, Tailwind class editor, design tokens, React Vue Svelte Next.js, local reverse proxy, live CSS preview

한국어 안내는 아래 [한국어](#한국어) 섹션을 보세요.

---

## Why

Browser DevTools show *computed* styles. Your repo has *authored* styles — often Tailwind classes, CSS modules, or tokens. Point Code bridges that gap for **local** apps:

| Pain | What Point Code does |
| --- | --- |
| “Which file owns this button?” | Resolves React / Vue / Svelte / Next source (exact or approximate) |
| “Why is this blue?” | Shows matched CSS rules in cascade order, with overrides struck through |
| “I just want to nudge the design” | Edit text, color, font weight/family, spacing in the sidebar with **live preview** |
| “Don’t invent random hex / 653” | Pick from design tokens and fixed scales (weights 100–900, font families) |

No cloud AI calls. No telemetry. Traffic stays on `127.0.0.1`.

---

## Features

- **Click-to-inspect** overlay (Alt+Shift+P) with pointer-event blocking so menus don’t open while picking
- **Reverse proxy** injects the picker into HTML without editing your project; WebSocket HMR is tunneled
- **Element Inspector** (activity bar): components & props (ON/OFF, text props), applied rules, `:hover` states, inherited styles, CSS variables
- **Live preview** via SSE while you edit; **Save to source** (Ctrl/Cmd+S) writes the workspace when a file mapping exists
- **Design-system aware:** color / weight / font token pickers; Tailwind utilities update `className` (`font-bold` → `font-medium`)
- **Framework aware:** React 18 `_debugSource`, React 19 `_debugStack` + RSC `_debugInfo`, Vue `__file`, Svelte `__svelte_meta`, optional Babel `data-point-source`

---

## Install

### From VSIX (Cursor / VS Code)

1. Download the latest `point-code-*.vsix` from [Releases](https://github.com/ast2r2sk-coder/point-code/releases) (or build locally — see below).
2. Command Palette → **Extensions: Install from VSIX…** → pick the file.
3. Open your app folder, run the dev server, then **Point Code: Start / Open Preview**.

### From source

```bash
git clone https://github.com/ast2r2sk-coder/point-code.git
cd point-code
# Extension root is ./source
python source/package-vsix.py   # writes point-code-<version>.vsix at repo root
```

Install that VSIX the same way. `source/` is the extension package (`package.json` lives there).

---

## Quick start

1. `npm run dev` (or equivalent) on `http://localhost:5173` (or your port).
2. **Point Code: Start / Open Preview** → enter that URL.
3. Open the proxy URL in Cursor’s browser (clipboard) or use the built-in preview.
4. Click **요소 선택** / **Pick element** in the page → select a node.
5. Use the **Point Code** sidebar: change values (live), then **소스에 저장** / **Save to source**.

Stable **port + token** are stored in workspace state (not in git).

### Optional: script tag (no proxy)

**Point Code: Copy Connection Script** → paste before `</body>` in **dev-only** HTML. Prefer the proxy for Next.js and strict CSP.

### Optional: exact React lines (React 19)

Copy `source/integration/babel.cjs` into your app and wire it through `@vitejs/plugin-react` / `@rolldown/plugin-babel` in serve mode. See comments in that file. Next.js (SWC) does not use this plugin.

---

## Framework support

| Stack | Source location | Notes |
| --- | --- | --- |
| Vite + React ≤18 | Exact (`_debugSource`) | |
| Vite + React 19 | File + refined line (`_debugStack`) | Babel plugin for exact DOM lines |
| Next.js (webpack) | File + refined line | Server components via `_debugInfo` |
| Next.js (Turbopack) | Search / usage find | Stack often points at `.next` chunks |
| Svelte 4/5 | Exact (`__svelte_meta`) | `{#if}` / `{#each}` in the chain |
| Vue 3 | File + refined line | Exact if `data-v-inspector` present |

**Save vs preview-only**

- **Saved:** Vite CSS (`data-vite-dev-id`), Tailwind / utility `className`, visible text, resolvable tokens
- **Preview only:** Bundled stylesheets (e.g. `/_next/static/*.css`) with no workspace mapping — badge **미리보기만**

---

## Commands

| Command | Action |
| --- | --- |
| `Point Code: Start / Open Preview` | Start proxy + session |
| `Point Code: Copy Proxy URL` | Clipboard proxy origin |
| `Point Code: Copy Connection Script` | Clipboard `<script>` tag |
| `Point Code: Find Styles for Selected Element` | Workspace CSS/source QuickPick |
| `Point Code: Stop` | Tear down proxy |

---

## Security & privacy

- Listens on **127.0.0.1** only; rejects unexpected `Host` (DNS rebinding guard)
- Per-workspace random token; Origin checked on select / live channels
- Selection payload: tag, id, classes, short text, source coords, inspector summary — **local only**
- Does not strip `X-Frame-Options` / CSP
- Untrusted / remote / virtual workspaces unsupported (`extensionKind: ui`)
- Writes only when you save, and only inside the workspace (no `node_modules` / `.next`)

---

## Develop & test

```bash
cd source
npm test                          # unit tests (core path / CSS / edits)
HTTP_ONLY=1 node test/browser.cjs # HTTP + mock VS Code host
# Optional Chromium:
#   npm install --no-save playwright && npx playwright install chromium
#   PLAYWRIGHT_PATH=... node test/browser.cjs
```

Design notes: [docs/decisions.md](https://github.com/ast2r2sk-coder/point-code/blob/main/docs/decisions.md). Changelog: [CHANGELOG.md](https://github.com/ast2r2sk-coder/point-code/blob/main/CHANGELOG.md).

---

## Publishing checklist (Marketplace / Open VSX)

Yes — this can ship as a public extension. Before **Visual Studio Marketplace** or **Open VSX**:

1. Create a publisher ID ([VS Marketplace](https://marketplace.visualstudio.com/manage) / [Open VSX](https://open-vsx.org/)) and set `"publisher"` in `source/package.json` (replace `personal-tools`).
2. `repository` / `bugs` / `homepage` already point at [ast2r2sk-coder/point-code](https://github.com/ast2r2sk-coder/point-code).
3. Add a **128×128 PNG** `source/media/icon.png` and `"icon": "media/icon.png"` (SVG is fine for the activity bar; Marketplace prefers PNG).
4. Prefer packaging with [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce): `npx @vscode/vsce package` from `source/` (or keep `package-vsix.py` for local builds).
5. Publish: `npx @vscode/vsce publish` / `ovsx publish`.
6. Cursor installs VS Code-compatible VSIXes; Marketplace listing is optional if you only distribute [Releases](https://github.com/ast2r2sk-coder/point-code/releases).

---

## Limits (honest)

- Local HTTP dev servers only (not HTTPS prod, SSH, WSL-remote as host, or deployed sites)
- No CSS-in-JS / Sass source-map walk; no automatic boolean prop toggles yet
- Computed styles may include `:hover` if the pointer was over the node when picking
- Bundled CSS without a file mapping stays preview-only

---

## Repo layout

```
point-code/
├── README.md           ← you are here
├── CHANGELOG.md
├── docs/decisions.md
├── source/             ← VS Code extension package
│   ├── package.json
│   ├── extension.js
│   ├── core.js
│   ├── inspector.js
│   ├── media/
│   ├── integration/babel.cjs
│   └── test/
└── point-code-*.vsix   ← build artifact (gitignored)
```

---

## License

[MIT](https://github.com/ast2r2sk-coder/point-code/blob/main/LICENSE) © Point Code contributors

---

## 한국어

**로컬 앱 화면에서 요소를 찍으면 → 어떤 컴포넌트·CSS인지 보고 → 사이드바에서 텍스트·색·굵기·간격을 고치고 → 화면에 바로 미리보기한 뒤 소스에 저장합니다.**

Point Code는 [VS Code](https://code.visualstudio.com/) / [Cursor](https://cursor.com/)용 **로컬 프론트엔드** 확장입니다. `npm run dev` 옆에 작은 리버스 프록시를 띄워 피커를 주입하고, **요소 인스펙터**로 디자인 토큰·유틸리티를 파일 찾으며 헤매지 않고 고칠 수 있습니다.

저장소: [github.com/ast2r2sk-coder/point-code](https://github.com/ast2r2sk-coder/point-code)

### 왜 쓰나요

브라우저 DevTools는 *계산된* 스타일을 보여 줍니다. 저장소에는 Tailwind 클래스·CSS Modules·토큰 같은 *작성된* 스타일이 있습니다. Point Code는 그 둘을 **로컬 개발**에서 이어 줍니다.

| 불편한 점 | Point Code |
| --- | --- |
| 이 버튼 소스가 어디지? | React / Vue / Svelte / Next 위치를 엽니다 (정확 또는 추정) |
| 왜 이 색이지? | 적용된 CSS를 우선순위 순으로, 덮어쓴 속성은 취소선 |
| 디자인만 살짝 바꾸고 싶은데 | 사이드바에서 문구·색·굵기·폰트·간격 **실시간 미리보기** |
| 이상한 hex / 653 쓰지 않기 | 디자인 토큰·굵기 단계(100–900)·폰트 목록에서 선택 |

클라우드 AI·텔레메트리 없음. 트래픽은 `127.0.0.1`에만 머뭅니다.

### 설치

1. [Releases](https://github.com/ast2r2sk-coder/point-code/releases)에서 `point-code-*.vsix`를 받거나, 아래처럼 직접 빌드합니다.
2. 명령 팔레트 → **Extensions: Install from VSIX…**
3. 프로젝트 폴더를 연 뒤 개발 서버를 실행하고 **Point Code: Start / Open Preview**

```bash
git clone https://github.com/ast2r2sk-coder/point-code.git
cd point-code
python source/package-vsix.py
```

### 빠른 시작

1. `http://localhost:5173` 등에서 개발 서버 실행
2. **Point Code: Start / Open Preview**에 그 주소 입력
3. 클립보드의 프록시 URL을 Cursor 브라우저에서 열기 (또는 내장 미리보기)
4. 페이지 하단 **요소 선택**으로 노드 선택
5. 왼쪽 **Point Code** 사이드바에서 수정(화면 즉시 반영) → **소스에 저장** (Ctrl/Cmd+S)

포트·토큰은 워크스페이스 상태에 저장되며 git에는 안 들어갑니다.

### 저장 vs 미리보기만

- **저장됨:** Vite CSS, Tailwind/`className` 유틸, 보이는 텍스트, 위치를 아는 토큰
- **미리보기만:** `/_next/static/*.css`처럼 워크스페이스 원본이 없는 번들 스타일 (배지 **미리보기만**)

### 보안 요약

- `127.0.0.1`만 수신, Host 검사, 워크스페이스별 토큰·Origin 확인
- 선택 정보는 로컬로만 전달
- **소스에 저장**을 눌렀을 때만, 워크스페이스 안 파일만 수정 (`node_modules` / `.next` 제외)

### 한계

- 로컬 HTTP 개발 서버 전용 (배포 HTTPS·원격 SSH 호스트 등은 비대상)
- CSS-in-JS / Sass 소스맵 추적 없음, 불리언 prop 자동 토글 없음
- 선택 순간 `:hover`가 계산값에 섞일 수 있음

더 자세한 영문 설명·프레임워크 표·명령 목록은 위 섹션을 참고하세요. 설계 기록은 [docs/decisions.md](https://github.com/ast2r2sk-coder/point-code/blob/main/docs/decisions.md)입니다.
