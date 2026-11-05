# Point Code

<p align="center">
  <img src="source/media/icon-256.png" width="128" height="128" alt="Point Code icon">
</p>

**Click a UI element in your local app → inspect components & CSS → edit in the sidebar or Design System board → live preview across screens → save to source.**

Point Code is a [VS Code](https://code.visualstudio.com/) / [Cursor](https://cursor.com/) extension for **local frontend development**. It runs a tiny reverse proxy next to your `npm run dev` server, injects a picker, and gives you an **Element Inspector**, a **Design System** board, and a Figma-like **Screens** board.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-0.6.0-informational)](./CHANGELOG.md)
[![GitHub](https://img.shields.io/badge/github-ast2r2sk--coder%2Fpoint--code-181717?logo=github)](https://github.com/ast2r2sk-coder/point-code)

> **Keywords:** VS Code extension, Cursor extension, element inspector, click to source, design tokens, design system, screen board, Tailwind, React Vue Svelte Next.js, live CSS preview

한국어는 아래 [한국어](#한국어) 섹션을 보세요.

---

## Why

Browser DevTools show *computed* styles. Your repo has *authored* styles — Tailwind classes, CSS modules, tokens. Point Code bridges that gap for **local** apps:

| Pain | What Point Code does |
| --- | --- |
| “Which file owns this button?” | Resolves React / Vue / Svelte / Next source (exact or approximate) |
| “Why is this blue?” | Shows matched CSS in cascade order, with overrides struck through |
| “I just want to nudge the design” | Edit text, color, weight, font, spacing with **live preview** |
| “Change once, see every screen” | Design System tokens + Screens board (Desktop → Flip / Fold) |
| “Don’t invent random hex / 653” | Pick from design tokens and fixed scales |

No cloud AI. No telemetry. Traffic stays on `127.0.0.1`.

---

## Features

- **Click-to-inspect** (Alt+Shift+P) — pointer blocking while picking
- **Reverse proxy** injects the picker without editing your project; WebSocket HMR is tunneled
- **Element Inspector** (activity bar) — components & props, cascade, `:hover`, inheritance, CSS variables
- **Design System** — full editor panel: Colors / Typography / Spacing / Components; edit tokens once → every connected preview updates; save to source
- **Screens board** — Figma-like canvas of routes (vanilla `*.html`, Next app/pages, SvelteKit, file-based `src/pages`; per app in monorepos; dynamic routes ask for a sample value) + captured modals/toasts/drawers; zoom; Desktop · Laptop · iPad · iPhone · Android · Flip · Fold (CSS viewports); select screens to preview Design System edits on just those
- **Preview toolbar** — **디자인 시스템** / **화면 그리드** buttons, viewport chips, plain-language help
- **Live preview** (SSE) · **Save to source** (Ctrl/Cmd+S); bundled CSS still tries a unique workspace match on save
- **Tailwind-aware** — utilities update `className` (`font-bold` → `font-medium`)
- **Framework-aware** — React 18/19 + RSC, Vue, Svelte, optional Babel `data-point-source`

---

## Install

### From VSIX (Cursor / VS Code)

1. Grab the latest `point-code-*.vsix` from [Releases](https://github.com/ast2r2sk-coder/point-code/releases) (or build below).
2. Command Palette → **Extensions: Install from VSIX…**
3. Open your app folder, run the dev server, then **Point Code: Start / Open Preview** (한국어 UI: **시작 / 미리보기 열기**).

### From source

```bash
git clone https://github.com/ast2r2sk-coder/point-code.git
cd point-code
python source/package-vsix.py   # → point-code-<version>.vsix at repo root
```

Extension package root is `./source` (`package.json`, `icon`, etc.).

---

## Quick start

1. Start your app (`npm run dev`) on e.g. `http://localhost:5173`.
2. **Point Code: Start / Open Preview** → paste that URL.
3. Use the built-in preview (or open the proxy URL from the clipboard).
4. On the page: **요소 선택** / Alt+Shift+P → click a node.
5. Edit in the **요소 인스펙터** sidebar, or open:
   - **디자인 시스템** — token + component board (editor panel)
   - **화면 그리드** — all screens on a canvas (editor panel)
6. **소스에 저장** / Ctrl·Cmd+S when ready.

Port + session token are stored in workspace state (not git).

### Optional: script tag (no proxy)

**Point Code: Copy Connection Script** → paste before `</body>` in **dev-only** HTML. Prefer the proxy for Next.js / strict CSP.

### Optional: exact React lines (React 19)

Copy `source/integration/babel.cjs` into your app and wire it via `@vitejs/plugin-react` / `@rolldown/plugin-babel` in serve mode. Next.js (SWC) does not use this plugin.

---

## Framework support

| Stack | Source location | Notes |
| --- | --- | --- |
| Vite + React ≤18 | Exact (`_debugSource`) | |
| Vite + React 19 | File + refined line (`_debugStack`) | Babel plugin for exact DOM lines |
| Next.js (webpack) | File + refined line | Server components via `_debugInfo` |
| Next.js (Turbopack) | Search / usage find | Stack often points at `.next` |
| Svelte 4/5 | Exact (`__svelte_meta`) | `{#if}` / `{#each}` in the chain |
| Vue 3 | File + refined line | Exact if `data-v-inspector` present |

**Save vs preview**

- **Usually saved:** Vite CSS (`data-vite-dev-id`), Tailwind / utility `className`, visible text, resolvable tokens, unique workspace CSS after search
- **May stay preview-only:** Bundled sheets (e.g. `/_next/static/*.css`) with no single workspace match — badge **미리보기만**; Save still attempts a unique-file lookup

---

## Commands

| Command (English UI) | 한국어 UI | Action |
| --- | --- | --- |
| `Point Code: Start / Open Preview` | `시작 / 미리보기 열기` | Start proxy + preview; if already running, just reopen the preview |
| `Point Code: Change Dev Server URL` | `개발 서버 주소 바꾸기` | Reconnect to another dev server URL |
| `Point Code: Open Design System` | `디자인 시스템 열기` | Design System board (editor panel) |
| `Point Code: Open Screens Board` | `화면 그리드 열기` | Screens board (editor panel) |
| `Point Code: Copy Proxy URL` | `프록시 주소 복사` | Copy proxy origin |
| `Point Code: Copy Connection Script` | `연결 스크립트 복사` | Copy `<script>` tag |
| `Point Code: Find Styles for Selected Element` | `선택한 요소의 스타일 찾기` | Workspace CSS QuickPick |
| `Point Code: Refresh Design System` | `디자인 시스템 새로고침` | Re-scan tokens / components |
| `Point Code: Refresh Screens` | `화면 그리드 새로고침` | Re-scan routes + layer captures |
| `Point Code: Stop` | `중지` | Tear down proxy |

---

## Security & privacy

- Listens on **127.0.0.1** only; unexpected `Host` rejected
- Per-workspace token; Origin checked on select / live / palette / screens channels
- Selection payload stays local
- Does **not** strip `X-Frame-Options` / CSP (some apps won’t iframe in the Screens board)
- Untrusted / remote / virtual workspaces unsupported (`extensionKind: ui`)
- Writes only on **Save**, only inside the workspace (no `node_modules` / `.next`)

---

## Develop & test

```bash
cd source
npm test                      # unit tests (pure logic)
HTTP_ONLY=1 node test/browser.cjs   # proxy + mocked VS Code host
node test/browser.cjs         # + Chromium (needs Playwright; PLAYWRIGHT_PATH to point at it)
node test/webviews.cjs        # Screens / Design System / Inspector webviews in Chromium
python package-vsix.py
```

Design notes: [`docs/decisions.md`](./docs/decisions.md) · Changelog: [`CHANGELOG.md`](./CHANGELOG.md)

---

## Publishing checklist (Marketplace / Open VSX)

1. Set your publisher ID in `source/package.json` (replace `personal-tools`).
2. Repo URLs already point at [ast2r2sk-coder/point-code](https://github.com/ast2r2sk-coder/point-code).
3. Brand icon is ready: `source/media/icon.png` (128×128) + `"icon": "media/icon.png"`; activity bar uses `media/icon.svg`.
4. Package: `python source/package-vsix.py` or `npx @vscode/vsce package` from `source/`.
5. Publish: `npx @vscode/vsce publish` / `ovsx publish`, or distribute via [Releases](https://github.com/ast2r2sk-coder/point-code/releases).

---

## Limits

- Local HTTP dev servers only (not HTTPS prod, SSH/WSL-remote host, or deployed sites)
- No CSS-in-JS / Sass source-map walk; no automatic boolean prop toggles
- `:hover` can leak into computed values if the pointer was over the node when picking
- Apps that block framing show empty thumbnails on the Screens board (URL cards still work)
- Flip sizes on the Screens board are approximate CSS viewports (physical size ÷ DPR)
- Captured modals/toasts can only be revisited while they are still open in the preview

---

## Repo layout

```
point-code/
├── README.md
├── CHANGELOG.md
├── docs/decisions.md
├── source/                 ← extension package
│   ├── package.json        ← icon, views, commands
│   ├── extension.js
│   ├── core.js
│   ├── inspector.js
│   ├── palette.js
│   ├── screens.js
│   ├── screen-routes.js
│   ├── media/              ← icon.png, icon.svg, webviews, picker.js
│   ├── integration/babel.cjs
│   └── test/
└── point-code-*.vsix       ← gitignored build artifact
```

---

## License

[MIT](./LICENSE) © Point Code contributors

---

## 한국어

<p align="center">
  <img src="source/media/icon-256.png" width="96" height="96" alt="Point Code">
</p>

**로컬 앱에서 요소를 찍으면 → 컴포넌트·CSS를 보고 → 인스펙터·디자인 시스템에서 고치고 → 화면 보드까지 미리보기한 뒤 → 소스에 저장합니다.**

Point Code는 [VS Code](https://code.visualstudio.com/) / [Cursor](https://cursor.com/)용 **로컬 프론트엔드** 확장입니다. 개발 서버 앞에 리버스 프록시를 두고 피커를 주입합니다.

저장소: [github.com/ast2r2sk-coder/point-code](https://github.com/ast2r2sk-coder/point-code)

### 왜 쓰나요

| 불편한 점 | Point Code |
| --- | --- |
| 이 버튼 소스가 어디지? | React / Vue / Svelte / Next 위치를 엽니다 |
| 왜 이 색이지? | 적용 CSS를 우선순위 순으로 (덮어쓴 값은 취소선) |
| 디자인만 살짝 | 문구·색·굵기·폰트·간격 **실시간 미리보기** |
| 여러 화면 한눈에 | **화면 그리드** 보드 (데탑·태블릿·모바일·플립·폴드) |
| 토큰·컴포넌트 모아보기 | **디자인 시스템** 보드 (Colors / Typography / Spacing / Components) |

클라우드·텔레메트리 없음. 트래픽은 `127.0.0.1`만.

### 설치

1. [Releases](https://github.com/ast2r2sk-coder/point-code/releases)의 `point-code-*.vsix` 또는 `python source/package-vsix.py`
2. **Extensions: Install from VSIX…**
3. 개발 서버 실행 후 **Point Code: 시작 / 미리보기 열기**

### 빠른 시작

1. 개발 서버 주소 입력 (예: `http://localhost:5173`)
2. 미리보기 창이 열림 — 위 안내는 “이 창은 미리보기이며, 실제 앱을 연결해 보여 준다”는 뜻입니다
3. 페이지 하단 **요소 선택** (또는 Alt+Shift+P)
4. 왼쪽 **요소 인스펙터**에서 수정 → **소스에 저장**
5. 미리보기 상단 **디자인 시스템** / **화면 그리드** 버튼으로 큰 보드 패널 열기  
   (명령 팔레트: `Point Code: 디자인 시스템 열기` / `화면 그리드 열기`)

### 저장

- 값을 바꾸면 **소스에 저장**이 켜집니다. 원본을 아직 모를 때도 저장을 누르면 워크스페이스에서 규칙을 찾아 봅니다.
- 번들 CSS만 있고 원본이 하나로 안 정해지면 미리보기만 유지되고 안내가 뜹니다.

### 보안 · 한계

- `127.0.0.1`만 수신, 저장 시에만 워크스페이스 파일 수정
- 로컬 HTTP 개발 서버 전용 · CSS-in-JS/Sass 소스맵 없음 · iframe을 막는 사이트는 화면 보드 썸네일이 비어 있을 수 있음

설계 기록: [`docs/decisions.md`](./docs/decisions.md) · 변경 이력: [`CHANGELOG.md`](./CHANGELOG.md)
