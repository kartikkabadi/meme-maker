# Changelog

## 0.2.0

- Template catalog expanded to 118 templates (103 static images, 15 animated GIFs) with per-template provenance in `assets/templates/CREDITS.md`.
- Generated catalog: `<id>.meta.json` sidecars + `npm run build:manifest` produce `manifest.json`; `npm run build:thumbs` renders webp thumbnails and the contact sheet.
- Font engine swapped to opentype.js with a per-codepoint fallback chain (Anton → Noto Sans → Noto Emoji) and kerning.
- `meme ui`: local web app (Vite + Preact SPA) — template gallery, editor with live preview and slot tuner, render history, and batch rendering; JSON API at `/api/templates`, `/api/measure`, `/api/render`, `/api/history`.
- Core hardening: path confinement (`MEME_INPUT_ROOT`/`MEME_OUTPUT_ROOT`, `MEME_ALLOW_FS`), resource limits (`MEME_MAX_*`, render timeout, concurrency caps), and `--strict` to fail on degraded renders.
- `measureMeme` for text-fit measurement without rendering.

## 0.1.0

Initial release.

- Template catalog: 37 templates (32 static images, 5 animated GIFs) with named text slots, hints, and provenance ([NOTICE](NOTICE)).
- Deterministic text-overlay renderer: auto-fitting Impact-style text, outline, wrapping, and overflow warnings.
- Bases: templates, custom images, blank canvases, and grid layouts; output as PNG, JPEG, WebP, or GIF.
- `meme` CLI: `templates list/show`, `render`, `layout`, `spec render`, `fonts list`; `--json` everywhere for agents.
- `meme-maker-mcp` MCP server (stdio): `list_templates`, `get_template`, `render_meme`, `render_layout`, `preview_template`.
- Convenience `top`/`middle`/`bottom` slots on non-template bases (canvas, image, layout).
