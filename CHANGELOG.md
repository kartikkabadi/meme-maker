# Changelog

## 0.1.0

Initial release.

- Template catalog: 37 templates (32 static images, 5 animated GIFs) with named text slots, hints, and provenance ([NOTICE](NOTICE)).
- Deterministic text-overlay renderer: auto-fitting Impact-style text, outline, wrapping, and overflow warnings.
- Bases: templates, custom images, blank canvases, and grid layouts; output as PNG, JPEG, WebP, or GIF.
- `meme` CLI: `templates list/show`, `render`, `layout`, `spec render`, `fonts list`; `--json` everywhere for agents.
- `meme-maker-mcp` MCP server (stdio): `list_templates`, `get_template`, `render_meme`, `render_layout`, `preview_template`.
- Convenience `top`/`middle`/`bottom` slots on non-template bases (canvas, image, layout).
