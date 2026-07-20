# meme-maker

A meme editor built for **agents**, not humans. Premade image/GIF meme templates plus a deterministic text-overlay engine, driven entirely through a CLI and an MCP server — no GUI required.

Inspired by the SupaBird.io "Meme Maker" tool, re-imagined for autonomous agent workflows.

## What it does

- Ships with a curated library of classic meme templates (images and animated GIFs)
- Lets an agent discover templates, inspect their text slots, and render finished memes (PNG/JPEG/GIF)
- Supports blank canvases, grid layouts (2x1, 2x2, ...), custom images, and free-form text boxes
- Runs fully headless and offline

## Interfaces

| Interface | Use case |
|-----------|----------|
| `meme` CLI | Shell-based agents, scripts, CI |
| MCP server (`meme-maker-mcp`) | MCP-capable agents (Claude, Devin, Cursor, ...) |
| TypeScript library | Programmatic embedding |

See [DESIGN.md](DESIGN.md) for the full design: architecture, CLI spec, MCP tool spec, template strategy, and implementation plan.

## Status

Design phase. Implementation tracked in DESIGN.md § Implementation Plan.
