# Changelog

All notable changes to this project are documented in this file.

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
