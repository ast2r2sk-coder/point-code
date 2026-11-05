# Changelog

All notable changes to this project are documented in this file.

## [0.6.0] — 2026-11-05

### Fixed
- **Save no longer loses work.** Edits are applied to the open document (not the bytes on disk), so unsaved changes in the editor are kept; if the file had unsaved changes, Point Code applies the edit and leaves saving to you. Edits are applied as the smallest changed range.
- **Several edits to the same file in one save all land.** Saves are one request and run one after another (before, a color + padding change in the same rule kept only the last).
- **No more writes into the wrong rule** when a stylesheet was found but the rule's line was not (it used to fall back to line 1, e.g. `:root`).
- **Design tokens defined for light and dark** (`:root` + `.dark`, Tailwind v4 `@theme` + `.dark`, shadcn) can be saved; the rule the page reported is edited, otherwise the base theme.
- **Screens board stopped reloading itself.** Frames are kept and resized in place; captures, zoom, device and selection changes no longer rebuild iframes.
- **Screens board frames no longer exhaust browser connections**: they open no SSE connection, show no picker UI and do not poll; live previews reach them through the board.
- **Captured modals/toasts are tracked per page** instead of being overwritten by whichever page reported last; only visible layers count (no always-present `role=status` regions).
- **Design System inputs keep focus while typing** and the color picker stays open while dragging; a token refresh from the page restores the caret.
- **Picking a new element no longer erases Design System previews** (inspector and Design System have separate preview channels).
- **Picking a look-alike element** (same tag and text) no longer reuses the previous element's pending edits; unsaved edits of the previous element are offered in a banner (save / discard).
- **Flip / Fold presets are CSS viewports** (were physical pixels, which rendered desktop layouts); added Fold cover and Android; one shared device list.
- **Dynamic routes** (`[id]`, `[...slug]`) are no longer opened as broken URLs; the board asks for a sample value.
- Route discovery follows each app's framework (React Router `src/pages` components are not routes) and is scoped per app in monorepos, defaulting to the app whose dev script uses the connected port.
- The picker's capture polling is cleared on cleanup.

### Changed
- **Point Code: Start** reopens the preview of a running session without asking for the URL; new command **Change Dev Server URL**.
- Commands and views are localized (English, 한국어) and grouped under the **Point Code** category.
- Screens board: "batch edit" became **select screens to preview Design System edits on just those**; page cards open the route in the preview; capture cards scroll the preview to the layer.
- Inspector: notes appear once per rule instead of once per declaration; save reports each item and failed items stay pending; token choices are keyboard-focusable buttons.
- Design System and Screens boards follow the VS Code theme (the Screens canvas stays dark).
- Component scan for the Design System board is cached (rescanned on Refresh).
- VSIX packaging reads identity from `package.json` and leaves out the large icon sources.

## [0.5.6] — 2026-11-05

### Fixed
- **Screens board** discovers vanilla / static / Vite `*.html` (and always keeps a Home `/` frame) — empty boards on non-Next projects

## [0.5.5] — 2026-11-05

### Added
- Extension marketplace / install icon (`media/icon.png`) from the Point Code brand mark

## [0.5.4] — 2026-11-05

### Changed
- **디자인 시스템** / **화면 그리드** open as full editor panels (Figma-like), not only the narrow sidebar
- Screens: canvas board with zoom + device frames; Design System: Colors / Typography / Spacing / Components page

## [0.5.3] — 2026-11-05

### Fixed
- **Save to source** now activates for edits even when the rule was labeled preview-only; save will try to locate a unique workspace CSS rule (or fail with a clear message)

## [0.5.2] — 2026-11-05

### Fixed
- Inspector scroll no longer jumps when opening the token/weight/font picker
- Design System panel no longer auto-steals focus on every element select

### Added
- Preview toolbar: **디자인 시스템** / **화면 그리드** buttons, clearer Korean help text, viewport chips (Desktop·Tablet·Mobile·Flip·Fold)
- Commands `Point Code: 디자인 시스템 열기` / `화면 그리드 열기`

## [0.5.1] — 2026-11-05

### Added
- **Screens** viewport presets: Desktop / Laptop / Tablet / Mobile / Flip cover·open / Fold cover·open, plus side-by-side **비교** mode

## [0.5.0] — 2026-11-05

### Added
- **Design System** sidebar: browse/edit CSS custom properties by kind (color, weight, font, size, space); live preview on all connected pages; save to source
- **Screens** grid: discover Next/SvelteKit/`src/pages` routes as iframe thumbnails; capture open modals/toasts/drawers from the live page; multi-select + batch edit via design tokens

## [0.4.2] — 2026-11-05

### Added
- Design-system pickers for font weight and font family (scales + CSS custom properties)
- Explicit **Save to source** control (Ctrl/Cmd+S); preview no longer auto-writes files
- `미리보기만` badge when a rule comes from bundled CSS with no workspace file

### Changed
- Selecting an element no longer opens an editor tab; open via inspector links
- Token collection covers color, weight, font, size, and space kinds

## [0.4.0] — 2026-11-05

### Added
- Live preview over SSE while editing in the inspector
- Persist CSS declarations, design tokens, Tailwind utilities, and visible text
- Inherited-style editing with affected-element outlines

## [0.3.0] — 2026-11-05

### Added
- Sidebar **Element Inspector** (component chain, cascade, states, inheritance)

## [0.2.0] — 2026-11-05

### Added
- Local reverse proxy with HTML injection and HMR WebSocket tunnel
- Stable per-workspace port/token
- Framework source resolution (React 18/19, Vue, Svelte, Next)

## [0.1.0] — 2026-11-05

### Added
- Initial pick → open source flow
