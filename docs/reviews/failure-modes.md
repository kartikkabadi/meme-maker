# Review: Failure Modes & Edge Cases

**Scope:** `kartikkabadi/meme-maker` @ `main` (v0.1.0 — post PR #4). Review only; no code changes.
**Method:** Full read of `src/` (spec, catalog, cli, mcp, render/*), plus ~25 live edge-case simulations against the built CLI. Error-handling conventions compared against `kartikkabadi/synara` (Effect `Data.TaggedError` / `Schema.TaggedErrorClass` typed-error style).

---

## 1. Summary Across the Five Dimensions

| Dimension | Assessment |
|---|---|
| **Correctness** | Core paths solid; several silent-failure paths (frames out of range, `maxWidth` on GIFs, index-style `--text N=`, buffer-only spec renders) produce wrong-but-successful results. |
| **Robustness** | Good typed-error coverage at boundaries (`MemeError` with 4 codes), but raw `SyntaxError`/sharp errors leak through some paths; error codes are sometimes wrong (`IO_ERROR` for spec problems). |
| **API/UX** | Excellent error *messages* (unknown template lists all IDs; unknown slot lists valid slots). Exit code is always `1`; JSON error shape is consistent but goes to stdout while human errors go to stderr. |
| **Security** | Paths are used as given (no traversal guard) — acceptable for a local agent tool, but MCP exposes arbitrary local file reads via `base.kind:"image"` / layout `cells[].image` and arbitrary writes via `output.path`. |
| **Performance** | Animated GIF pipeline composites every overlay per frame in one sharp pass — fast for bundled templates (~1s), but unbounded for user-supplied GIFs (50MB/500-frame inputs: memory = full decoded frame stack; no size/frame cap). |

---

## 2. Error Handling: What Exists Today

- `MemeError` (`src/spec.ts:117`) with `code ∈ {TEMPLATE_NOT_FOUND, SLOT_NOT_FOUND, INVALID_SPEC, IO_ERROR}`.
- CLI `fail()` (`src/cli.ts:17`): maps non-`MemeError` to `IO_ERROR`, prints `{"error":{code,message}}` in `--json` mode (stdout) or `error [CODE]: msg` (stderr), exits `1`.
- MCP `errorResult()` (`src/mcp.ts:18`): same shape inside a `text` content block with `isError: true`.
- Zod validation is centralized in `parseMemeSpec` → `INVALID_SPEC` with joined issue paths.
- sharp read failures are wrapped with context (`cannot read image "…"`) in `buildBase` (image kind), `renderGif`, and `renderLayoutBase`; write failures wrapped in `renderMeme`.

This is a good baseline. The gaps below are where errors are missing, mis-coded, or silently swallowed.

---

## 3. Simulated Edge-Case Scenarios (observed behavior)

All run against the built CLI (`node dist/cli.js`).

| # | Scenario | Result | Verdict |
|---|---|---|---|
| S1 | Unknown slot (`--text nope=hi` on `drake`) | `SLOT_NOT_FOUND`, lists valid slots (`no, yes`) | ✅ ideal |
| S2 | Unknown template | `TEMPLATE_NOT_FOUND`, lists all 37 IDs | ✅ (list is getting long; consider truncating + suggesting nearest match) |
| S3 | **0-byte image** (`touch empty.png`) | `IO_ERROR: … unsupported image format` | ✅ caught, but message is raw libvips text |
| S4 | **Invalid JSON** spec file (`{bad json`) | `IO_ERROR: Expected property name or '}' in JSON at position 1` | ⚠️ wrong code — this is a spec problem (`INVALID_SPEC` or a new `INVALID_JSON`), and the message lacks the filename |
| S5 | **Path with spaces** (`-o 'my meme out.png'`) | Written correctly | ✅ |
| S6 | Empty string text (`--text no=`) | Renders silently with blank slot | ⚠️ probably fine, but agents may want a warning |
| S7 | Truncated/corrupt JPEG (first 1000 bytes of drake.jpg) | `IO_ERROR: VipsJpeg: premature end of JPEG image` | ✅ caught; raw libvips message |
| S8 | Animated base + `--format png` | `INVALID_SPEC: animated base requires gif output` | ✅ explicit |
| S9 | `--quality abc` | `INVALID_SPEC: output.quality: Expected number, received nan` | ⚠️ caught by zod by luck (`parseInt` → `NaN`); message says "nan" instead of "got \"abc\"" |
| S10 | Output to nonexistent dir (`-o /nope/x.png`) | `IO_ERROR` **after** full render | ⚠️ correct but wasteful — no upfront writability check, no `mkdir -p` |
| S11 | Directory passed as `--image` | `IO_ERROR: unsupported image format` | ✅ (message could say "is a directory") |
| S12 | Missing `--text-file` | Raw `ENOENT` mapped to `IO_ERROR` | ⚠️ unwrapped — no "cannot read text file" context (`runRender` has no try around `readFileSync`; the outer catch saves it) |
| S13 | **Emoji / unmapped glyphs** (`🔥`) | Renders "success" — glyphs silently drop to `.notdef` (empty outline) | ❌ silent data loss; no warning |
| S14 | **`frames: [100, 200]`** on a 30-frame GIF | Success; text appears on **zero** frames | ❌ silent no-op; also `frames: [5, 2]` (reversed) silently disables the overlay |
| S15 | `maxWidth` on an animated GIF | Silently ignored (resize branch is static-only, `renderer.ts:170`) | ❌ silent no-op |
| S16 | Unknown font | `INVALID_SPEC`, lists available fonts | ✅ |
| S17 | Extreme text overflow (200 words in 100×50) | Success + warning in `warnings[]` | ✅ good pattern |
| S18 | Unknown CLI flag | Commander error on stderr, exit 1 — **plain text even with `--json`** | ⚠️ agents parsing stdout JSON get nothing |
| S19 | Invalid CSS color (`--bg notacolor`) | `IO_ERROR: Unable to parse color from string` | ⚠️ wrong code — spec problem, not I/O; color strings are unvalidated in the schema |
| S20 | Layout: more cells than grid | `INVALID_SPEC` with counts | ✅ (message wording is backwards: "grid 1x1 has 1 cells but 2 images given" reads oddly) |
| S21 | **Index-style text** (`--text 0=first --text 1=second`) | Both boxes rendered at the *same default centered rect*, overlapping | ❌ the documented `slotOrIndex` syntax discards the index (`cli.ts:31`) instead of mapping to the Nth slot |
| S22 | **Negative width/x** in a text box | Success (+overflow warning); schema allows any number for dimensions | ⚠️ `dimension` should be non-negative |
| S23 | `spec render` with no `output.path` | "Success", JSON output has **no `path`** and no bytes are written anywhere reachable from the CLI | ❌ result is discarded; CLI should default a filename like `render` does |
| S24 | `--text 'E=mc2'` on canvas | `SLOT_NOT_FOUND` (parsed `E` as a slot) | ⚠️ documented footgun of the `k=v` syntax; no escape mechanism |
| S25 | `150%` dimension / stdin `-` spec | Both work | ✅ |

---

## 4. Error-Handling Gaps (by severity)

### High — silent wrong results (worst failure mode for agents)
1. **`spec render` without `output.path` discards the image** (S23). `renderMeme` returns a buffer, the CLI prints metadata, and nothing is written. `cli.ts` should apply `defaultOutputName` like `runRender` does.
2. **Index-style `--text N=` is a lie** (S21): `parseTextArgs` matches `/^\d+$/` and drops the key, so `0=`/`1=` become identical centered free boxes. Either map index → `template.slots[N]` or reject with `INVALID_SPEC`.
3. **`frames` ranges are never validated against the GIF's frame count** (S14): out-of-range or reversed ranges silently render no text. Should be `INVALID_SPEC` (or at minimum a warning).
4. **Unmapped glyphs render as nothing** (S13): `Font.glyphIndex` returns `0` (`font.ts:133`) and `.notdef` in Anton has an empty outline. Any non-Latin text, emoji, or curly quotes silently vanish. Should push a warning (`unsupported characters: …`) like the overflow path.
5. **`output.maxWidth` silently ignored for GIFs** (S15).

### Medium — wrong error codes / leaky abstractions
6. **JSON parse failures are `IO_ERROR`** in three places: `spec render` (`cli.ts:264`), `--text-file` (`cli.ts:53`), and manifest load (`catalog.ts:23` — `JSON.parse(raw)` is *outside* the try, so a corrupt bundled manifest throws a raw `SyntaxError` that only becomes `IO_ERROR` by the CLI's fallback).
7. **Invalid colors surface as `IO_ERROR` from libvips** (S19). `color`/`stroke`/`background`/`bg` are unvalidated strings; invalid SVG colors in text styles may silently render black instead of erroring.
8. **Template asset reads are unwrapped**: `buildBase` template branch (`renderer.ts:94`) calls `sharp(path).toBuffer()` bare — a manifest entry pointing at a missing/corrupt file produces a raw sharp message with no template context (unlike the `image` branch, which wraps).
9. **Raw libvips messages leak** (`VipsJpeg: premature end…`, `Unable to parse color…`) — fine as detail, but should be nested under a stable message + code.
10. **CLI argument errors bypass the JSON contract** (S18): commander's own errors (unknown flag, missing required option) print plain text; an agent invoking `--json` cannot distinguish them from crashes. Consider `program.configureOutput` / `exitOverride`.

### Low — hardening
11. Exit code is always `1`; distinct exit codes (or at least documenting "parse stdout JSON `error.code`") would help shell agents branch on failure type.
12. No upfront check or `mkdir -p` for `output.path` (S10); no atomic write (partial file on crash mid-write).
13. No input-size/frame-count guardrails: a 50MB, 500-frame user GIF is fully decoded into one vertically-stacked buffer; composites array grows `frames × overlays`. A cap (e.g. `MAX_FRAMES`, `MAX_INPUT_BYTES`) with a clear error beats an OOM kill (which surfaces as a bare non-zero exit, unparseable by agents).
14. **MCP: unbounded base64 in the text block** — `MAX_INLINE_BYTES` guards only the `image` content block (`mcp.ts:44`); when no `output.path` is given, `meta.base64` (`mcp.ts:41`) embeds the *full* image regardless of size, and small results duplicate the bytes (base64 in text + image block).
15. MCP tool-input validation errors are produced by the SDK from raw zod, so their shape differs from `errorResult`'s `{error:{code,message}}` — two error dialects in one server.
16. Manifest/template cache (`catalog.ts:12`) never revalidates; fine for a CLI process, but a long-lived MCP server won't see catalog changes without restart (acceptable, worth documenting).
17. `dimension` schema permits negative numbers (S22); `rotation` and `frames` bounds are similarly unconstrained.

---

## 5. Recommended Typed, Machine-Readable Error Model

The current `MemeError` is the right idea; extend it rather than replace it. Synara's `Schema.TaggedErrorClass` pattern (e.g. `packages/effect-acp/src/errors.ts`) is the shape to emulate: one tag per failure family, structured fields, serializable.

```ts
type MemeErrorCode =
  | 'TEMPLATE_NOT_FOUND'   // + { id, available: string[] }
  | 'SLOT_NOT_FOUND'       // + { template, slot, available: string[] }
  | 'INVALID_SPEC'         // + { issues: { path: string; message: string }[] }
  | 'INVALID_JSON'         // + { file?: string, position?: number }   (new: split from IO_ERROR)
  | 'UNREADABLE_IMAGE'     // + { path, detail }                       (new: split from IO_ERROR)
  | 'UNSUPPORTED_OUTPUT'   // + { format, reason }  e.g. png for animated base, maxWidth on gif
  | 'RENDER_ERROR'         // + { detail }          sharp/libvips composite/encode failures
  | 'WRITE_FAILED'         // + { path, detail }
  | 'IO_ERROR';            // true catch-all only

class MemeError extends Error {
  code: MemeErrorCode;
  details?: Record<string, unknown>;  // structured, JSON-safe
}
```

- CLI JSON failure shape becomes `{"error":{"code","message","details"}}`; keep exit 1 (or map families to exit codes 2–7).
- Surface `warnings[]` for *degraded* success (unsupported glyphs, ignored frames, empty text) — the overflow warning already establishes this pattern; extend it.
- MCP: emit the same `{error:{…}}` JSON in the text block (already done) and add `code` to make `isError` results branchable; align SDK zod-rejection shape via a custom error handler if the SDK allows.
- Wrap every `JSON.parse` and every bare `sharp()` call at the boundary where filename/template context is known.

---

## 6. Open Questions on Desired Failure Behavior

1. **Silent-degrade vs. hard-fail:** When text contains glyphs the font can't render (emoji, non-Latin), should the render fail with a typed error, succeed with a `warnings[]` entry (recommended), or transliterate/strip? Same question for `frames` ranges that select zero frames.
2. **`spec render` without `output.path`:** should the CLI auto-name the file (matching `render`'s `defaultOutputName` behavior), error with `INVALID_SPEC`, or stream bytes to stdout for piping? Today the render is silently discarded.
3. **Resource limits:** what are acceptable caps for user-supplied inputs via MCP — max input bytes, max GIF frames, max canvas/layout dimensions (e.g. `canvas 50000x50000` will attempt a 10GB buffer)? And should exceeding them be `INVALID_SPEC` or a new `RESOURCE_LIMIT` code?
4. **MCP filesystem exposure:** `render_meme` accepts arbitrary `base.path`/`cells[].image` reads and `output.path` writes on the host. Is that intended (local trusted agent), or should there be an allowlist/root-dir option (`--assets-root`) with a `PATH_DENIED` error?
5. **Exit-code contract:** is a single exit code `1` + JSON `error.code` on stdout the intended contract for shell agents, or should error families map to distinct exit codes? Relatedly, should commander's own argument errors be forced into the `--json` shape?
6. **Overflow policy:** text overflow currently succeeds with a warning at `MIN_SIZE` 8px (often unreadable). Should there be a strict mode (`--strict` / `"onOverflow":"error"`) where overflow, empty text, and unknown glyphs are hard failures for fully-deterministic agent pipelines?

---

## 7. Suggested Follow-up PRs (smallest first)

1. Fix `spec render` default output path (one-liner in `cli.ts`).
2. Validate `frames` against GIF frame count; error on reversed/out-of-range.
3. Split `INVALID_JSON` / `UNREADABLE_IMAGE` / `WRITE_FAILED` out of `IO_ERROR`; wrap `catalog.ts` `JSON.parse` and the template branch of `buildBase`.
4. Warn on unmapped glyphs; validate colors in the zod schema (`z.string().regex` for hex + named-color list, or pre-flight via sharp).
5. Implement or reject index-style `--text N=`; reject `maxWidth` for GIF output with `UNSUPPORTED_OUTPUT`.
6. Cap `meta.base64` in MCP by `MAX_INLINE_BYTES`; add resource limits for user-supplied images/GIFs.
