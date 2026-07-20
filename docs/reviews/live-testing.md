# Live Testing & Scenario Simulation Review

Reviewer: Devin (live-testing session) — 2026-07-20
Branch under test: `devin/polish` (v0.1.0), Node v20.18.1, Linux (Ubuntu), sharp 0.34.x
Method: built and ran the real code — `npm install && npm run build && npm test`, then exercised every CLI command and every MCP tool with valid and invalid inputs. All outputs were visually inspected.

## 1. Setup & Baseline

| Step | Result | Time |
|------|--------|------|
| `npm install` | 250 packages, 0 vulnerabilities | 2.5s |
| `npm run build` (tsc) | clean | ~2s |
| `npm test` (vitest) | 41/41 passed, 6 files | 2.9s |

One `EBADENGINE` warning: `eslint-visitor-keys@5.0.1` wants Node `^20.19.0` while `package.json` engines allow `>=20` (v20.18.1 was used). Harmless today, but the engines field is looser than what devDependencies actually require.

Note: the repo default branch (`devin/design`) contains only docs; the implementation lives on `devin/v1-core` → `devin/template-buildout` → `devin/polish`. A fresh clone + `npm install` on the default branch does nothing — merging to `main` (or repointing default) would remove a real onboarding trap.

## 2. What Was Exercised

CLI: `templates list` (plain/`--json`/`--tag`/`--type`/`--search`), `templates show` (valid + unknown id), `render` (template, custom `--image`, `--canvas`, `--bg`, `--format`, `--quality`, `--max-width`, `--json`, missing `--out`, empty text, overflow text, unicode/emoji, bad slot, 0x0 canvas, `--template`+`--image` conflict), `layout` (2x2 with gutter/width/texts, sparse 3x9, missing cell file), `spec render` (valid, structurally invalid), `fonts list`.

MCP (via `@modelcontextprotocol/sdk` stdio client): `list_templates` (all + `type:"gif"`), `get_template` (valid + unknown), `render_meme` (static PNG, animated GIF, bad slot, negative canvas), `render_layout` (valid + missing file), `preview_template` (image + gif).

Rendered samples (attachments):

- Drake: https://app.devin.ai/attachments/f2ee12f9-4025-4d46-9673-03c62262b63e/drake.png
- Two Buttons via `spec render`: https://app.devin.ai/attachments/f2f54f43-05b0-4180-841d-7266586b23c4/spec.png
- 2x2 layout (shows text-index bug): https://app.devin.ai/attachments/d6726756-c52b-4f6a-ba85-861179aed9f9/grid.png
- Unicode/emoji tofu: https://app.devin.ai/attachments/31d5c9a3-d263-409f-bef1-1adcdc9cfad3/emoji.png
- Animated GIF caption: https://app.devin.ai/attachments/7598bbc8-2b31-4a19-8c13-abceac468e54/mindblown.gif
- Overflow warning case: https://app.devin.ai/attachments/2fd6c974-a282-4921-8240-555ca6062a9b/long.png

## 3. Scenario Simulations

### S1 — Agent renders Drake (golden path)
`meme render --template drake --text "no=Writing memes by hand" --text "yes=Letting agents do it" --out drake.png`
**Result: pass.** 1200x1200 PNG in 0.16s. Text wraps, auto-sizes, and stays inside slot rects. `--json` output gives path/width/height/bytes/warnings — ideal for agents.

### S2 — Agent captions an animated GIF
`meme render --template mind-blown --text "top=When the tests pass first try" --out out.gif`
**Result: pass.** 24 frames, 480x270, frame timing preserved (100ms), caption on every frame. 1.2s for mind-blown; 2.3s for deal-with-it (39 frames, 320x454, 3.2MB out from 3.7MB source).

### S3 — Agent builds a 2x2 layout with captions
`meme layout --grid 2x2 --cell ... x4 --gutter 8 --width 900 --text "0=one" --text "3=four"`
**Result: partial fail.** Grid composites correctly (cover-fit, gutters right), but numeric text keys are silently discarded (see Bug B1): both texts became identical centered free boxes — "one" is hidden underneath "FOUR", and neither is attached to a cell.

### S4 — Agent passes an invalid spec
`meme spec render bad.json` with `{"base":{"kind":"template"},"texts":"nope"}`
**Result: pass.** Exit 1 with `error [INVALID_SPEC]: base.id: Required; texts: Expected array, received string`. Zod-powered messages are precise and agent-parseable; unknown template errors enumerate all 37 valid ids; unknown slot errors enumerate the template's slots. This error surface is a highlight.

### S5 — Agent drives everything over MCP
Connected a real stdio client; all 5 tools discovered and callable.
**Result: pass with caveats.** `list_templates` 7ms, `get_template` 2ms (includes a ready-to-use `example` spec — nice touch), `render_meme` static 86ms / GIF 2.3s, `render_layout` 94ms, `preview_template` 72–400ms. Tool-level errors come back as `isError` JSON with the same codes as the CLI. Caveat: payload sizes (Bug B3/B4).

### S6 — Agent uses blank canvas & custom image
`--canvas 800x400 --bg "#1e1e2e"` and `--image <path>` both work (0.09–0.15s); non-template bases accept `top`/`middle`/`bottom` band slots with a clear error listing them if the slot is wrong.

## 4. Bugs Found (with repro)

**B1 — Numeric `--text N=...` indices are silently dropped.**
`src/cli.ts` `parseTextArgs`: `if (/^\d+$/.test(key)) return { text }` throws away the index. The help text advertises `--text <slotOrIndex=content>`, but `0=one` and `3=four` both become index-less free boxes with identical default geometry — later texts paint over earlier ones. Repro: S3 above; grid.png shows only "FOUR", centered. Either map the index to a cell/position or reject numeric keys loudly.

**B2 — Missing glyphs render as tofu with no warning.**
`meme render --template surprised-pikachu --text "top=Unicode ☕ émojis 🚀 中文 test"` → ☕🚀中文 all render as hollow boxes (Anton has Latin-only coverage; see emoji.png). The renderer emits an overflow warning for long text but nothing for unfindable glyphs. Agents will happily ship broken memes. Suggest: detect non-Latin-1 codepoints and warn, or bundle a fallback font.

**B3 — `preview_template` embeds unbounded base64 in the text payload.**
`src/mcp.ts` `renderTool`: `MAX_INLINE_BYTES` (1MB) gates the `image` content block, but `meta.base64` is always included when there's no output path. `preview_template drake` returned a JSON *text* block containing ~1.6MB of base64 — exactly the context blowup the 1MB cap was meant to prevent. Suggest downscaling previews (e.g. max-width 400) and applying the cap to `meta.base64` too.

**B4 — GIF data written to `.png` path without warning.**
`meme render --template typing-cat --text "top=..." --out out.png` → `wrote out.png (300x300 gif, 739444 bytes)`: GIF bytes under a `.png` extension. The format *is* correctly forced to gif internally (explicit `--format png` on an animated base properly errors with `animated base requires gif output`), but the extension/content mismatch will break MIME-sniffing consumers. At minimum emit a warning; better, rewrite the extension or refuse.

**B5 — Default engines claim vs. reality** (minor): `engines: ">=20"` but transitive deps want `^20.19`; see §1.

## 5. Surprises & Observations

- Missing `--out` writes `meme-drake-98a9b6a8.png` into the CWD — deterministic-hash naming is nice, but agents in a repo checkout will litter the worktree. Consider defaulting to a temp dir or requiring `--out`.
- `layout --grid 3x9 --cell <one image>` happily renders a 1200x3581 canvas that is 96% background. Fewer cells than grid slots is allowed (only *more* is an error) — probably intended, but worth documenting.
- Empty text (`--text "no="`) renders successfully with no text and no warning — arguably fine, but a warning would help agents catch templating mistakes.
- `spec render` human output omits the byte count (`wrote spec.png (600x908 png)`) while `render` includes it — trivial inconsistency.
- CLI/MCP error-code parity is excellent: `TEMPLATE_NOT_FOUND`, `SLOT_NOT_FOUND`, `INVALID_SPEC`, `IO_ERROR` are identical across both surfaces.
- MCP input-schema violations (e.g. negative canvas width) surface as protocol-level `-32602` errors rather than the tool's JSON error envelope — agents need to handle both shapes.
- `fonts list` returns exactly one font (`anton`); there is no `--font` flag on any command, so the subcommand is currently informational only.

## 6. Performance

| Operation | Time |
|-----------|------|
| Static template render (PNG, up to 1200x1200) | 0.09–0.22s |
| Custom image / canvas / layout | 0.07–0.22s |
| GIF render (15–24 frames) | 1.0–1.3s |
| GIF render (39 frames, deal-with-it) | 2.3s |
| All 37 templates rendered serially | 9.2s total |
| MCP list/get | 1–7ms |
| MCP render (static / gif) | 86ms / 2.3s |

Fully offline, no network calls observed. CPU-bound on GIF re-encode (sharp/gifsicle path); fine for interactive agent use. Output sizes: PNGs of photo templates are large (1.2–1.3MB for drake because PNG-encoding a JPEG source); agents that care should pass `--format jpeg --quality 60 --max-width 600` (31KB for the same meme).

## 7. Five Dimensions Summary

1. **Correctness** — Core rendering is solid across all 37 templates (zero failures in a full sweep); text engine wraps/auto-sizes/outlines correctly. B1 and B2 are the correctness gaps.
2. **API & error design** — Best-in-class error messages for an agent consumer; consistent codes across CLI and MCP; `get_template.example` is a great affordance. B3 payload sizing is the main API wart.
3. **Performance** — Excellent for static, acceptable for GIF; no pathological cases found.
4. **Robustness** — Invalid specs, missing files, bad slots, 0x0 canvases, conflicting base flags all fail fast and clearly. Silent-degradation cases (B1, B2, B4, empty text) are the residual risk: the tool prefers to succeed quietly instead of warning.
5. **Agent ergonomics** — `--json` everywhere, deterministic outputs, hints on every slot, offline operation. Main friction: default-branch confusion (§1) and inline-payload sizes over MCP.

## 8. Questions for the Author

1. **B1:** What is `--text <slotOrIndex=content>`'s numeric index *supposed* to do — position text in layout cell N, or order free boxes? The parser currently drops it; the help text promises something it doesn't deliver.
2. **B3:** Is `preview_template` meant to return the full-resolution render? A 1200px preview costs ~1.6MB of base64 in an agent's context; would a capped-width thumbnail (with the full render available via `output.path`) be acceptable?
3. **B2:** Is non-Latin text (emoji, CJK, Cyrillic) in scope for v1? If yes a fallback font (e.g. Noto) is needed; if no, should the renderer warn or reject when glyphs are missing?
4. **B4:** Should output extension be authoritative? Today `--out x.png` on a GIF template silently writes GIF bytes; an agent reporting `image/png` upstream will be wrong.
5. **Branching:** When does `devin/polish` merge to `main`? The default branch has no code, which breaks `npx`-style trial installs and first-clone `npm install` expectations.
6. **Fonts:** `fonts list` exists but no command accepts a font choice — is a `--font` flag planned, or should the subcommand be dropped until then?

## 9. Verdict

v0.1.0 is genuinely usable by an agent today: the golden paths (S1, S2, S4, S5, S6) all work end-to-end with fast, deterministic, well-reported results. The issues found are edge-of-path (B1, B4), payload hygiene (B3), and i18n (B2) — none block the core use case, but B1 and B3 are cheap fixes with high agent-facing value.
