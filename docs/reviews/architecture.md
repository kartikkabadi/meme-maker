# Architecture & Trade-offs Review — meme-maker

Reviewed at `main` (v0.1.0, post-#4). Scope: stack choices, module architecture, asset strategy, and design robustness for a fully built-out app. Code was read end to end (~1,600 LOC in `src/`, tests, CI, `DESIGN.md`).

## 1. Summary Assessment

The implementation matches DESIGN.md unusually closely, and the overall shape is right: one declarative `MemeSpec` (zod) at the center, a pure core (`catalog` + `render/*`), and two thin adapters (CLI, stdio MCP) with no duplicated logic. For an offline, deterministic, agent-facing tool, this is close to the simplest robust design already. The main tensions are (a) a hand-rolled TrueType parser as the price of determinism, (b) 9 MB of bundled assets inside an npm package, and (c) a memory-heavy GIF pipeline. None are wrong for v1; all constrain v2.

## 2. Stack Evaluation vs. Alternatives

| Dimension | Chosen | Main alternatives | Verdict |
|---|---|---|---|
| Language/runtime | TypeScript / Node ≥20 | Python (Pillow), Rust | **Right.** The MCP reference SDK is TS-first; one language covers library + CLI + MCP. Python/Pillow would simplify raster work but make MCP second-class; Rust would buy startup speed and a single static binary at a large iteration cost unjustified for an I/O-light tool. |
| Compositing | `sharp` (libvips) | node-canvas (Cairo), Jimp, ImageMagick shell-out | **Right.** sharp is the only option that is fast, headless, prebuilt for all majors, and reads/writes **animated GIF** natively. node-canvas drags in Pango/fontconfig (non-deterministic text across platforms); Jimp is pure-JS but slow and GIF-poor; ImageMagick means a system dependency. |
| Text rendering | Hand-rolled TTF parser (`font.ts`, 287 LOC) → SVG glyph paths | SVG `<text>` via librsvg, `opentype.js`, Pango/canvas | **Defensible but the highest-risk choice.** SVG `<text>` through sharp resolves fonts via system fontconfig — output would differ per machine, killing golden tests and the determinism guarantee. Outlines-as-paths is the correct idea. But writing the parser in-house (cmap 4/12, composite glyphs, quadratic contours) instead of using `opentype.js` (~0 deps, battle-tested) is NIH; it works for Anton but silently constrains v2 fonts (no CFF/OTF, no kerning pairs — `measureText` ignores `kern`/GPOS, no shaping, effectively Latin-only). |
| MCP transport | stdio | SSE/HTTP (Streamable HTTP) | **Right for v1.** Every current MCP client launches stdio servers; the server is stateless so nothing about the core precludes adding an HTTP transport later as a third thin adapter. Adding HTTP now would only add auth/lifecycle surface with no consumer. |
| CLI | commander | yargs, citty, hand-rolled | Fine; commander is small and the CLI layer is genuinely thin (299 LOC, all parsing). |
| Validation | zod, one schema set shared CLI/MCP/library | JSON Schema, TypeBox | **Right.** Single source of truth in `spec.ts`; MCP tool inputs reuse the same sub-schemas. Note zod stays a runtime dep of the published package (fine; MCP SDK needs it anyway). |
| Font | Bundled Anton (OFL) | System Impact, fetch-on-install | **Right.** Impact is non-free and absent on Linux; system fonts break determinism and offline-first. Bundling one OFL Impact-alike plus license file is the clean answer. (DESIGN.md promises a Noto Sans fallback that was never shipped — `BUILTIN_FONTS` has only `anton`; docs and code disagree.) |
| Templates | Bundled in-repo/package (~9 MB) | Fetch-on-demand from CDN, separate assets package | Bundling is correct for offline-first and determinism, but 9 MB in `files` makes every `npx agent-meme-maker` pull 9 MB+, and template growth linearly bloats the package. Acceptable at 37 templates; a problem at 200. |
| Tests | vitest + golden images with pixel tolerance | pure unit tests | **Right.** Golden tests are the only honest way to test a renderer; tolerance absorbs libvips version drift. Note this makes "byte-identical output" (Success Criteria) aspirational across sharp/libvips upgrades — determinism holds for a fixed dependency set, and the docs should say so. |

## 3. Architecture

```
CLI (cli.ts) ─┐
              ├─ MemeSpec (spec.ts, zod) ─→ renderMeme (renderer.ts)
MCP (mcp.ts) ─┘                              ├─ catalog.ts (manifest)
                                             ├─ text.ts ← font.ts
                                             ├─ gif.ts
                                             └─ layout.ts
```

**Monolith-with-modules is the right call.** A single package with internal module boundaries (adapters never touch `render/*` internals; everything funnels through `renderMeme(spec)`) gives the modularity benefits without workspace/monorepo overhead. Splitting into `@meme/core` + `@meme/cli` + `@meme/mcp` packages would add release coordination for zero consumer benefit at this size.

Concrete observations from the code:

- **Adapters are genuinely thin.** `mcp.ts` (137 LOC) and `cli.ts` (299 LOC) contain only I/O shaping; every render path converges on `renderMeme`. `render_layout` is even implemented as sugar over `render_meme` (`mcp.ts:125-126`). This is the property to protect as the app grows.
- **Error taxonomy is small and enforced** (`MemeErrorCode`: 4 codes), surfaced identically in CLI JSON mode and MCP `isError` results. Good agent ergonomics (`SLOT_NOT_FOUND` lists valid slots; `TEMPLATE_NOT_FOUND` lists all ids).
- **Global mutable caches** (`cachedTemplates`/`cachedDir` in `catalog.ts`, `fontCache` in `font.ts`) are fine for a process-per-render CLI/stdio server, but are the first thing to refactor into an injected context if a long-lived HTTP server or plugin template dirs land.
- **`--templates-dir` escape hatch from DESIGN.md §2 was never wired into the CLI/MCP** — `catalog.ts` takes a `templatesDir` param but no adapter exposes it. Either ship it or delete the plumbing.
- **GIF pipeline is memory-bound**: sharp represents an animated GIF as one tall stacked canvas; `gif.ts` composites one SVG overlay *per frame per text box* (`frames × overlays` composite ops on a `width × height×frames` buffer). Fine at ≤5 MB/≤100-frame templates; will not survive user-supplied long GIFs or video.
- **Downstream fit (synara):** synara injects stdio MCP servers into provider sessions (`apps/server/src/agentGateway/mcpInjection.ts`), so `meme-maker-mcp` as a stateless stdio binary with a small tool surface plugs in with zero glue. The ≤1 MB inline-image cap in `mcp.ts` is the right default for chat-context budgets.

## 4. Questions for the Author (architectural)

1. **Why hand-roll the TrueType parser instead of using `opentype.js`?** It's ~150 KB, zero-dep, handles CFF/kerning/more cmap formats, and would delete the riskiest 287 lines in the repo while keeping the same glyph-outline→SVG-path strategy (and determinism). Was the goal zero deps beyond sharp, or was it not evaluated?
2. **Is byte-identical determinism actually a contract, or is pixel-tolerance determinism enough?** Success Criteria promises "identical spec → byte-identical output", but PNG/GIF encoding is owned by libvips and can change bytes across sharp upgrades. If consumers (e.g. caching layers keyed on output hash) rely on it, the sharp version must be pinned exactly, not `^0.34`.
3. **What is the template-growth plan?** At ~9 MB/37 templates the npm package is already chunky. Is the intent to cap the curated set, split assets into an optional `agent-meme-maker-templates` package, or add fetch-on-demand packs? This decision gates the plugin-template design (scenario B).
4. **Why is `strokeWidth: 'auto'` representable internally (`ResolvedStyle`) but not in the public zod schema** (`TextStyleSchema.strokeWidth: z.number().min(0)`)? Same question for the missing Noto Sans fallback font promised in DESIGN.md §3 — are these intentional cuts or drift? Both are doc/spec mismatches an agent consumer will trip on.
5. **Should the MCP server expose the blank-canvas/`top|middle|bottom` band convention?** `resolveRect` supports band slots on non-template bases, and the README documents it, but nothing in the MCP tool descriptions or `list_templates` output teaches an agent this — discoverability today requires reading the README, which defeats the "hints teach agents without seeing the image" principle.
6. **Is the single-render-per-process model a commitment?** Global caches, `process.exit(1)` in the CLI, and no concurrency guards are all fine now; if an HTTP mode (DESIGN v2) is real, does the core commit to being re-entrant, or will HTTP mode fork a process per request?

## 5. Design-Choice Scenarios

### A. Adding a web UI (template gallery + live preview)

- **What holds:** the core needs zero changes — `renderMeme(spec)` already returns a buffer, and `MemeSpec` is exactly the state a canvas-editor UI would serialize. The manifest (rects, hints) doubles as gallery metadata.
- **What strains:** stdio-only transport. A web UI needs an HTTP endpoint (`POST /render` accepting MemeSpec, plus static template previews). The right move is a third thin adapter (`src/http.ts`, ~100 LOC with `node:http` or hono), not converting the MCP server to SSE. Live preview also wants sub-100 ms renders; per-request font/manifest parsing is already cached, but the SVG→raster composite in sharp dominates and would push toward client-side preview (render the same SVG string in the browser — the SVG generator in `text.ts` is pure and could ship to the browser as-is, a hidden benefit of the outlines-as-SVG choice).
- **Verdict:** architecture passes this test well; the only real cost is transport.

### B. Plugin/user-supplied template packs

- **What holds:** `loadManifest(templatesDir)` and `ManifestSchema` already validate arbitrary directories; the manifest format is a clean pack format as-is.
- **What strains:** (1) the single global `cachedTemplates` assumes one directory — packs need catalog merging with id-collision rules (namespace prefixes, e.g. `pack:id`); (2) `templateImagePath` joins paths from the manifest without normalization — a hostile pack manifest with `"file": "../../..."` reads outside the pack dir (path-traversal; matters the moment packs are third-party); (3) fonts are not extensible at all (`BUILTIN_FONTS` hard-map), and packs will want fonts.
- **Verdict:** ~1 day of core work (catalog merge + path sanitization + font registration), no restructuring. Ship the already-plumbed `--templates-dir` first as the 80% solution.

### C. Supporting video (MP4) output

- **What strains:** everything below `renderer.ts`. sharp cannot decode/encode video; the stacked-pages GIF trick doesn't extend. Real answer is ffmpeg (`ffmpeg -i in.mp4 -i overlay.png -filter_complex overlay` or drawtext), which breaks the "no system dependencies, npm-install-and-go" property — `@ffmpeg/ffmpeg` (wasm) keeps hermeticity but is slow and ~30 MB; `ffmpeg-static` bundles ~70 MB of binaries per platform.
- **What holds:** `MemeSpec` extends naturally (`base.kind: "video"`, `frames` already exists on TextBox), and the SVG overlay per text box is exactly what you'd feed ffmpeg's overlay filter.
- **Verdict:** correctly deferred. If it ever lands, make it an optional peer (`agent-meme-maker-video` that requires ffmpeg on PATH) rather than polluting the core install. The current architecture isolates the blast radius to a new `render/video.ts` — a good sign.

## 6. Architectural Risks (ranked)

1. **Hand-rolled font parser** — single-font, Latin-only, no kerning/shaping, CJK/emoji/RTL input renders as `.notdef` boxes silently (agents *will* send emoji). Mitigate: swap to `opentype.js` or at minimum add an explicit unsupported-codepoint warning in `warnings[]`.
2. **Determinism overpromise** — byte-identical output is only true per pinned sharp/libvips build. Mitigate: pin sharp exactly + document "deterministic for a given version" or hash goldens with tolerance only.
3. **Package weight trajectory** — assets grow linearly with catalog; npm has no partial download. Mitigate: cap curated set, or split assets package before 20 MB.
4. **GIF memory ceiling** — `frames × overlays` composites on a full stacked buffer; a user-supplied 500-frame GIF via `base.kind:"image"` can exhaust memory. Mitigate: frame-count/size guard with a typed error.
5. **Path traversal in manifests** (latent, pre-plugin) — `templateImagePath` trusts `file` fields. Harmless while manifests are first-party; fix before packs.
6. **Spec/doc drift** — Noto fallback, `--templates-dir`, `strokeWidth:'auto'`, band-slot discoverability in MCP. Each is small; together they erode the "agent can operate from metadata alone" promise.

## 7. Recommendation: Simplest Robust Design

Keep the current shape — it is already near-minimal for the requirements. Specifically:

- **Keep:** single package, TS/Node, sharp, zod, one `MemeSpec`, stdio MCP + CLI as thin adapters, bundled Anton + templates, golden tests. Do **not** split packages, do not add HTTP/SSE, do not add a config system.
- **Change (highest leverage, small):**
  1. Replace `font.ts` with `opentype.js` (delete ~287 LOC of parser, gain kerning + OTF + robustness; keep the same SVG-path output so goldens barely move).
  2. Pin `sharp` exactly and restate determinism as version-scoped.
  3. Wire up `--templates-dir` (CLI flag + `MEME_TEMPLATES_DIR` env for MCP) with manifest path sanitization — this is the whole v1 plugin story.
  4. Close the doc/spec drift (Noto claim, `strokeWidth` schema, band slots in MCP tool descriptions).
- **Defer:** HTTP adapter until a web UI exists (then add it as a third ~100-LOC adapter); video entirely, or as a separate ffmpeg-dependent package; multi-font support beyond a registration hook.

The strategic insight worth preserving: the project's one non-obvious asset is the *deterministic SVG text layer*. It is what makes golden tests, offline rendering, browser-side preview reuse, and ffmpeg overlays all fall out for free. Every future choice should protect that layer's purity (no fontconfig, no platform text stacks) — the rest of the system is straightforward plumbing around it.
