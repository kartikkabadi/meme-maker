# Scale & Performance Review — meme-maker

Reviewed at `main` (post PR #4, v0.1.0). Focus: what changes under load or growth —
100+ templates, 10MB GIFs, ~100 requests/sec. Review only; no code changes.

Measurements below were taken on the built `dist/` output (Node 20, Linux VM,
sharp 0.34 / libvips prebuilt).

## 1. Architecture summary (performance-relevant)

- **Render path**: `renderMeme` → `buildBase` (sharp decode of template/image/canvas/layout)
  → per-text `renderTextLayer` (pure-TS TrueType parsing + SVG path generation, synchronous)
  → sharp `composite` of SVG overlays → encode (png/jpeg/webp/gif).
- **GIF path**: `renderGif` opens the file with `{ animated: true }` (all frames as one
  vertically-stacked canvas) and pushes one composite op per frame × overlay, then re-encodes
  the whole GIF.
- **Catalog**: single `manifest.json` (~24KB for 37 templates), parsed once and cached
  per process (`cachedTemplates`); list/search is a linear scan.
- **Fonts**: one bundled TTF, parsed once, glyph outlines cached per code point.
- **MCP server**: stdio transport, one process per client; render work happens inside
  libvips worker threads, so the Node event loop stays responsive.
- **Process model**: CLI is one-shot (process startup dominates); MCP server is long-lived.

## 2. Measured load scenarios

### Scenario A — render 50 image memes in a loop (drake template, 2 slots)

| Metric | Result |
|---|---|
| Sequential 50 renders | 3859 ms total, **77 ms/render** |
| Concurrent 20 renders | 1015 ms total, ~51 ms/render effective |
| Max event-loop lag during 20 concurrent renders | **7.4 ms** |
| RSS after 70 renders | 63 MB → **338 MB** |

Throughput is good (~13/s sequential, ~20/s with concurrency) and the event loop stays
healthy — libvips does the work off-thread. The concerning number is RSS growth: libvips
caches operations/buffers aggressively and nothing bounds it (`sharp.cache()` is never
configured). Under sustained load this looks like a leak to any container memory limiter.

### Scenario B — caption a 300-frame, 16.7 MB GIF (300×300)

| Metric | Result |
|---|---|
| Render time | **10.1 s** for one caption |
| Output size | 14.9 MB |
| RSS | 63 MB → 315 MB |
| Event-loop lag | 7 ms (work stays in libvips threads) |

Cost scales linearly with frame count: the same SVG overlay is composited 300 times
(once per frame at each page offset), and the full GIF is decoded to a 300×90,000-px
RGBA canvas (~108 MB raw) before re-encoding. A 10 MB user GIF is a ~10-second,
~300 MB-RSS operation with no timeout, no frame/size limit, and no early rejection.

### Scenario C — concurrent MCP clients

| Metric | Result |
|---|---|
| 1 server, 20 parallel `render_meme` calls | 235 ms total |
| 100 sequential `list_templates` | 49 ms (~0.5 ms/call) |
| 5 server processes × 4 renders in parallel | 1033 ms |
| GIF render returned inline (no `output.path`) | 2.4 s, **3.22 MB image → ~4.3 MB base64 JSON** |

stdio-MCP is one process per client, so "100 req/s" really means "N agent processes ×
renders"; each process independently pays the ~180 MB libvips/RSS baseline. The inline
result path is the sharp edge: when `output.path` is omitted, `mcp.ts` puts the full
base64 into the JSON *text* metadata regardless of size — `MAX_INLINE_BYTES` only gates
the image content block, not `meta.base64`. A GIF render can push multi-MB JSON strings
through stdio and straight into an agent's context window.

### Scenario D — micro-benchmarks (synchronous text engine, catalog scaling)

| Metric | Result |
|---|---|
| `renderTextLayer`, short text | ~0.05 ms |
| `renderTextLayer`, 1600-char text with auto-fit | **8.6 ms** (synchronous, on the event loop) |
| Linear search over a simulated 1000-template manifest | ~0.06 ms/query |
| Test suite (`npm test`, 41 tests incl. real GIF render) | 2.7 s |

Auto-fit binary-searches font size, re-wrapping and re-measuring the whole text at each
step (O(len × log(sizes))). At 8.6 ms for pathological input this is acceptable today but
it is the only meaningful synchronous CPU cost in the render path.

## 3. Bottlenecks (ranked)

1. **Unbounded memory growth under sustained load** (Scenario A/B). No `sharp.cache`
   limits, no concurrency cap, template buffers re-read and re-decoded per render.
2. **Animated GIF cost is linear in frames × overlays with no ceiling** (Scenario B).
   A hostile or careless 10 MB/500-frame input means ~10 s CPU and hundreds of MB RSS
   per request; nothing rejects oversized inputs up front.
3. **Inline base64 bypass of `MAX_INLINE_BYTES`** (`src/mcp.ts:41`): `meta.base64` is
   included for any pathless render, so large outputs inflate MCP JSON payloads ~1.33×
   the binary size.
4. **No caching of decoded template bases**: `buildBase` does `sharp(path).toBuffer()`
   per render — a decode + PNG/JPEG re-encode round-trip of the same 37 static files on
   every call. At 100 req/s this is pure waste.
5. **Full manifest re-serialization on every `list_templates`** — trivial at 37 templates,
   still trivial at 1000 (0.06 ms measured); not a real bottleneck, listed for completeness.
6. **CLI process startup** (~200–300 ms Node + sharp import) dominates one-shot CLI use;
   batch scripting 50 memes via the CLI pays 50× startup, vs. one long-lived MCP process.

## 4. Concrete optimizations

- **Bound libvips**: call `sharp.cache({ memory: 200 })` (or env-configurable) and
  `sharp.concurrency(n)` at startup in `renderer.ts`; document the memory envelope.
- **Input limits**: reject GIFs above a configurable frame count / pixel budget
  (`meta.pages`, `width × pageHeight`) with a clear `INVALID_SPEC`-style error before
  decoding; add an overall render timeout. This is the single most important
  robustness-under-load change.
- **Fix the base64 leak**: apply `MAX_INLINE_BYTES` to `meta.base64` too, and require
  `output.path` (or return a temp-file path) for larger results.
- **Cache decoded template bases**: small LRU of template-id → decoded buffer (37 images
  ≈ a few MB) removes the per-render decode; invalidate on `templatesDir` change.
- **GIF overlay batching**: when an overlay applies to all frames, composite once onto a
  tiled overlay or use libvips' `n=-1` page-aware composite rather than N composite ops;
  alternatively cap output GIF dimensions (e.g. `maxWidth` default for GIFs).
- **Worker threads only if needed**: event-loop lag is already <10 ms since libvips is
  off-thread; the sync text engine at ≤9 ms/box does not justify workers yet. Revisit only
  if auto-fit inputs grow (e.g. >10 KB text) — cheaper fix: cap `text` length in the spec.
- **Manifest at 100+ templates**: keep the single JSON file (parse is ~ms) but add a
  startup-validated index (`Map<id, Template>`) to make `getTemplate` O(1); today it is a
  double linear scan in the error path.
- **Batch CLI mode**: a `meme spec render --many specs.jsonl` (or stdin JSONL) would
  amortize process startup for scripted bulk rendering.

## 5. Notes on the other four dimensions

- **Correctness**: golden-file tests cover the render path; GIF timing/loop metadata is
  preserved. Edge risk: `parseDim` accepts arbitrary strings via `parseFloat` (`"abc"` →
  NaN rects) — NaN propagates into SVG attributes silently.
- **Security**: MCP `render_meme`/`render_layout` accept arbitrary filesystem paths for
  `base.path`, `cells[].image`, and `output.path` — an MCP client can read any
  image-parseable file and write anywhere the process can. Fine for a local single-user
  agent tool; a hard blocker if the server is ever exposed beyond a trusted host.
  Also the decompression asymmetry in bottleneck #2 is a DoS vector.
- **Maintainability**: small, clean module graph (~2,100 LOC); the hand-rolled TTF parser
  is the highest-complexity component but is isolated and cached. Manifest schema is
  Zod-validated at load.
- **Developer experience**: fast tests (2.7 s), deterministic rendering (no fontconfig),
  good error codes. Missing: documented performance envelope and limits.

## 6. Open questions (performance/scalability)

1. **What is the target deployment model at 100 req/s** — many short-lived MCP/stdio
   processes (each paying ~180 MB baseline RSS) or a future shared HTTP service? The
   right caching/concurrency strategy differs completely between the two.
2. **Should oversized GIF inputs be rejected or downscaled?** A 10 MB, 300+ frame GIF
   costs ~10 s and ~300 MB RSS today. Is a hard frame/pixel cap acceptable, or do users
   need automatic downscaling (`maxWidth` for GIFs is currently rejected)?
3. **What memory budget should a single render process guarantee?** Without
   `sharp.cache()` limits RSS grows past 300 MB under load; container OOM-kill is the
   failure mode. What limit should the default configuration target — 256 MB? 512 MB?
4. **Is inline base64 ever needed for GIFs?** The MCP text metadata currently carries
   multi-MB base64 for pathless renders. Could the server always write to a temp file and
   return the path, keeping payloads flat regardless of output size?
5. **At 100+ templates, does the manifest stay a single hand-edited JSON?** Parsing is
   cheap, but asset weight (currently 9 MB for 37 templates) scales the npm package
   linearly — should GIF templates move to on-demand download at some size threshold?
6. **Should concurrent renders within one process be capped?** 20 parallel renders were
   fine (~51 ms each) but each in-flight render holds full decoded buffers; 100 parallel
   10 MB-GIF renders would be catastrophic. A small semaphore (e.g. 4–8) around
   `renderMeme` would bound the worst case cheaply.

## 7. Growth projections

| Growth axis | Today | At target | Verdict |
|---|---|---|---|
| Templates → 100+ | 37, linear scan, 0.5 ms list | ~1000 still <0.1 ms/query | Fine; only package size (9 MB assets) is a concern |
| GIF inputs → 10 MB | 3.6 MB max bundled | 10 s render, ~300 MB RSS, 15 MB output | Needs limits + batched compositing |
| Throughput → 100 req/s | ~20/s per process (images) | Requires ~5 processes or a shared service + caching | Achievable for images; GIFs need a queue |
| MCP clients → many | 1 process/client, ~180 MB each | 10 clients ≈ 1.8 GB baseline | Consider a shared streamable-HTTP MCP endpoint |

## Appendix: method

Load scenarios were run against `dist/` with ad-hoc Node scripts (not committed):
sequential/concurrent `renderMeme` loops with `process.memoryUsage()` sampling and a
10 ms event-loop lag probe; a 300-frame GIF synthesized by concatenating the bundled
`typing-cat.gif` 20× with ImageMagick; MCP concurrency via
`@modelcontextprotocol/sdk` stdio clients against the built `dist/mcp.js`.
