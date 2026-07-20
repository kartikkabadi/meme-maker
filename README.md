# meme-maker

A meme editor built for **agents**, not humans. Premade image/GIF meme templates plus a deterministic text-overlay engine, driven entirely through a CLI and an MCP server — no GUI required.

Inspired by the SupaBird.io "Meme Maker" tool, re-imagined for autonomous agent workflows.

## What it does

- Ships with a curated library of classic meme templates (images and animated GIFs)
- Lets an agent discover templates, inspect their text slots, and render finished memes (PNG/JPEG/GIF/WebP)
- Supports blank canvases, grid layouts (2x1, 2x2, ...), custom images, and free-form text boxes
- Runs fully headless and offline; identical input produces identical output

## Quick start

```sh
git clone https://github.com/kartikkabadi/meme-maker.git && cd meme-maker
npm install && npm run build
node dist/cli.js render --template drake \
  --text no="MANUAL MEME EDITORS" --text yes="A CLI FOR AGENTS" -o drake.png
```

That's it — `drake.png` is a finished meme. (Once published: `npm i -g agent-meme-maker` gives you the `meme` and `meme-maker-mcp` binaries.)

## Templates

118 templates ship in the catalog: 103 static images (drake, distracted-boyfriend, expanding-brain, woman-yelling-at-cat, afraid-to-ask-andy, doge, red-pill-blue-pill, scroll-of-truth, ...) and 15 animated GIFs (mind-blown, deal-with-it, crab-rave, confused-travolta, shrek-running, ...). Provenance for every template is tracked in [assets/templates/CREDITS.md](assets/templates/CREDITS.md).

![Template catalog contact sheet](docs/contact-sheet.webp)

The manifest is generated: each template's metadata lives in a `<id>.meta.json` sidecar next to its media file, and `npm run build:manifest` scans `assets/templates/**`, derives file paths and dimensions, validates against the schema, and emits `manifest.json`. `npm run build:thumbs` renders ~320 px webp previews into `assets/templates/thumbs/` plus the contact sheet above.

```sh
node dist/cli.js templates list --json          # full catalog with slots & tags
node dist/cli.js templates show drake --json    # slot rects + hints for one template
```

Each template declares named text slots (e.g. drake has `no` and `yes`) with hints describing what goes where. Non-template bases (canvas, image, layout) accept the convenience slots `top`, `middle`, and `bottom`.

## CLI

```sh
# browse the catalog
node dist/cli.js templates list --json
node dist/cli.js templates show drake

# classic meme in one line
node dist/cli.js render --template drake \
  --text no="MANUAL MEME EDITORS" --text yes="A CLI FOR AGENTS" \
  -o drake.png --json

# blank canvas / custom image / grid layout
node dist/cli.js render --canvas 800x600 --bg '#1e3a5f' --text "HELLO AGENTS" -o hello.png
node dist/cli.js render --image photo.jpg --text "CAPTION" -o captioned.png
node dist/cli.js layout --grid 2x2 --cell a.jpg --cell b.jpg --cell c.jpg --cell d.jpg -o grid.png

# full MemeSpec for advanced styling
node dist/cli.js spec render examples/drake.json

node dist/cli.js fonts list
```

All commands accept `--json` for machine-readable output; errors are emitted as `{ "error": { "code", "message" } }` with exit code 1.

## MCP server

Stdio transport, five tools: `list_templates`, `get_template`, `render_meme`, `render_layout`, `preview_template`.

```json
{
  "mcpServers": {
    "meme-maker": {
      "command": "node",
      "args": ["/path/to/meme-maker/dist/mcp.js"]
    }
  }
}
```

`render_meme` takes a full `MemeSpec` and returns the rendered image inline (≤ 1 MB) plus the file path when `output.path` is given.

## MemeSpec for agents

Everything renders from one declarative JSON spec — ideal for programmatic generation (see [examples/](examples/)):

```json
{
  "base": { "kind": "template", "id": "drake" },
  "texts": [
    { "slot": "no", "text": "MANUAL MEME EDITORS" },
    { "slot": "yes", "text": "A CLI FOR AGENTS" }
  ],
  "output": { "path": "drake.png", "format": "png" }
}
```

Render it with `meme spec render examples/drake.json` or pass the same shape to the `render_meme` MCP tool.

## Library

```ts
import { listTemplates, getTemplate, renderMeme } from 'agent-meme-maker';

const out = await renderMeme({
  base: { kind: 'template', id: 'drake' },
  texts: [
    { slot: 'no', text: 'MANUAL EDITORS' },
    { slot: 'yes', text: 'AGENT CLIS' },
  ],
  output: { path: 'out.png' },
});
```

## Development

```sh
npm run build   # tsc
npm test        # vitest (unit + golden-image + MCP integration)
npm run lint    # eslint + prettier
```

See [DESIGN.md](DESIGN.md) for the full design: architecture, CLI spec, MCP tool spec, template strategy, and implementation plan. Template provenance is documented per-entry in `assets/templates/manifest.json` and in [NOTICE](NOTICE).

## Fonts

Text is rendered with a per-codepoint fallback chain via [opentype.js](https://github.com/opentypejs/opentype.js): [Anton](https://fonts.google.com/specimen/Anton) (display) → [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) → [Noto Emoji](https://fonts.google.com/noto/specimen/Noto+Emoji) (monochrome). All bundled fonts are licensed under the SIL Open Font License 1.1 (see `assets/fonts/OFL-*.txt` and [NOTICE](NOTICE)).
