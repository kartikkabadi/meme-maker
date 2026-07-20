# Abuse & Security Review — meme-maker

**Scope:** `kartikkabadi/meme-maker` (CLI, MCP server, renderer, template
catalog). Reviewed against `kartikkabadi/synara` as a representative host that
spawns MCP servers as JSON-RPC-over-stdio subprocesses.

**Review type:** Read-only threat model and abuse analysis. No code was changed.
Findings below are backed by code references and locally reproduced proof-of-concept
runs (see § Attack Simulations).

**Commit reviewed:** `main` @ `cf7118d` (identical `src/` to `origin/devin/polish`).

---

## 1. System model & trust boundaries

meme-maker is "a meme editor for agents": a template catalog + deterministic
text-overlay renderer, exposed three ways — a `meme` CLI, an MCP stdio server
(`meme-maker-mcp`), and a TS library. It runs headless and offline. Rendering is
done with `sharp` (libvips); text is rasterized from a bundled TrueType font into
SVG glyph paths that `sharp` composites.

The critical question for every input is **who controls it and what trust the
process runs with**:

- **CLI** (`src/cli.ts`): args come from whoever invokes `meme`. In an agent
  workflow that is often an LLM assembling a command line from a task prompt, so
  argument values (`--out`, `--image`, `--cell`, `--text`, `--text-file`, spec
  JSON) should be treated as **untrusted / prompt-injectable**, even though the
  process runs with the invoking user's full privileges.
- **MCP server** (`src/mcp.ts`): tool arguments (`render_meme`, `render_layout`,
  `get_template`, etc.) arrive over stdio from an MCP host (Claude, Cursor,
  Devin, synara, …). The host forwards **model-generated** tool calls. The server
  process runs with the host user's privileges and filesystem access. This is the
  highest-risk surface: model output → filesystem read/write with user privileges,
  with no sandbox.
- **Templates/fonts** (`assets/`): bundled and trusted, loaded from a path
  derived from `import.meta.url`. Not user-selectable at runtime today (see
  Finding 7 for the latent risk if that changes).

**Key trust-boundary observation:** the renderer performs **no path
confinement** and **no resource limits**. Every `path` field (`base.path`,
`cells[].image`, `output.path`) is handed straight to `fs`/`sharp`. On the MCP
surface this means a model can drive arbitrary file read (into returned image
bytes) and arbitrary file write anywhere the host user can reach.

---

## 2. Threat-model questions & assumptions

These need explicit answers from the maintainer; the current code implicitly
answers all of them "fully trusted", which is the root of most findings.

1. **Is MCP tool input trusted?** The MCP server exposes `output.path`,
   `base.path`, and `cells[].image` as free-form strings. Should a model-driven
   MCP call be able to read `~/.ssh/id_rsa` or write to `~/.bashrc`? Today it
   can. What is the intended filesystem boundary (e.g. a configured output
   directory, cwd-only, or an explicit allowlist)?
2. **Should rendering ever touch paths at all over MCP?** Would a safer default be
   "MCP returns bytes inline only; no `output.path`, no `base.path` file reads —
   image inputs must be inline/base64 or a template id"? What is the concrete use
   case that requires arbitrary filesystem paths in MCP tool calls?
3. **What is the maximum acceptable render cost?** There is no cap on canvas
   dimensions, layout width, `maxWidth`, GIF frame count, text length, or
   concurrent renders. What per-call CPU/memory/time budget and what output-size
   ceiling are acceptable, given a host may issue many concurrent tool calls?
4. **Are style fields (`color`, `stroke`, `background`) trusted markup?** They are
   interpolated **unescaped** into the overlay SVG. Should they be validated as
   colors, or is arbitrary SVG markup by design? (It is almost certainly not.)
5. **Is `sharp` allowed to load external/remote resources or SVG-referenced
   files?** What `sharp`/libvips build and options are shipped (does it honor
   `<image href>` / external entities in SVG or SVG inputs)? This determines
   whether the SVG-injection and image-parse surfaces escalate to LFI/SSRF.
6. **What does an attacker gain from error messages?** `IO_ERROR` messages embed
   absolute paths and underlying `sharp`/`fs` errors and are returned to the
   caller. Is filesystem-path disclosure acceptable?
7. **Is the template manifest ever loaded from an untrusted location?**
   `loadManifest(templatesDir)` and `templateImagePath` join `template.file`
   under the templates dir with no traversal check. Will `templatesDir` ever be
   user/agent-configurable (env var, flag, plugin templates)?
8. **What is the npm publish threat model?** Are releases published with 2FA +
   provenance, a committed lockfile, and pinned/`^`-bounded, ≥7-day-old
   dependency versions? A compromised publish would ship a native-`sharp`
   dependent binary to every consuming agent.

---

## 3. Findings (vulnerabilities & mitigations)

Severity is relative to the "agent-driven, model-controlled input" model above.

### F1 — Arbitrary file write / path traversal via `output.path` (`--out`) — **High**

`renderMeme` writes output with zero path validation:

```ts
// src/render/renderer.ts:195
if (spec.output.path) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(spec.output.path, out);   // attacker-controlled path
}
```

`output.path` is set from the CLI `--out` and from the MCP `render_meme` /
`render_layout` `output` object (`OutputSchema.path` is just `z.string()`).
Absolute paths, `../` traversal, and symlink targets are all accepted. An agent
(or a prompt-injected agent) can overwrite any file the user can write —
`~/.bashrc`, `~/.ssh/authorized_keys`, `.git/hooks/pre-commit`, CI configs,
crontab entries — with bytes it substantially controls (it chooses format and
overlay text; a PNG/GIF/JPEG payload is enough to clobber/corrupt a target file
or plant an executable-in-disguise). Reproduced in § Attack 1.

**Mitigations:**
- Confine writes to a configured output root; resolve with `path.resolve` and
  reject anything whose resolved path escapes the root (`!resolved.startsWith(root + sep)`).
- Reject absolute paths and `..` segments in `output.path` for the MCP surface;
  prefer returning bytes inline and letting the host decide where to persist.
- `O_NOFOLLOW` / `lstat` the target to refuse writing through symlinks.
- Refuse to overwrite existing files by default (opt-in `--force`), and never
  write outside cwd unless an explicit `--allow-outside`/root is configured.

### F2 — Arbitrary file read + exfiltration via `base.path` / `cells[].image` — **High**

`buildBase` and `renderLayoutBase` pass caller paths straight to `sharp`:

```ts
// src/render/renderer.ts:103 / :120  (image base)
meta = await sharp(base.path).metadata();
buffer = await sharp(base.path).toBuffer();
// src/render/layout.ts:46            (layout cell)
resized = await sharp(cell.image).resize(...).toBuffer();
```

Any file `sharp` can decode (PNG/JPEG/GIF/WebP/TIFF/SVG/…) at any path is read
and rendered into the output image. On the **MCP surface the rendered bytes are
returned inline as base64** (`src/mcp.ts:44-50`, `renderTool`), so a model can
turn "render this image" into **read-and-exfiltrate** of any image-parseable file
on the host (private screenshots, exported credential PNGs/QR codes, cached
images, SVGs containing text). Combined with SVG handling this widens
considerably (see F3/F5). Reproduced in § Attack 4.

**Mitigations:**
- Same path-confinement as F1 for all input paths (resolve + root check, no
  symlink following, no absolute/`..`).
- On MCP, strongly prefer inline/base64 image inputs or template ids only; drop
  filesystem `base.path`/`cells[].image` unless an explicit input root is
  configured.
- Set `sharp` `{ limitInputPixels }` and disable SVG input for untrusted images
  (treat SVG bases specially — see F5).

### F3 — SVG markup injection via unescaped style fields — **High**

`renderTextLayer` interpolates `style.color`, `style.stroke`, and
`style.background` directly into SVG attribute values with **no escaping**:

```ts
// src/render/text.ts:271-284
const background = style.background
  ? `<rect ... fill="${style.background}"/>` : '';
const strokeLayer = `<path d="${d}" fill="${style.stroke}" stroke="${style.stroke}" .../>`;
const fillLayer   = `<path d="${d}" fill="${style.color}" .../>`;
const svg = `<svg ...><g opacity="${style.opacity}"${transform}>${background}${strokeLayer}${fillLayer}...</g></svg>`;
```

`TextStyleSchema` types these as bare `z.string().optional()` — no color
validation. A value such as

```
#000"/><image href="/etc/hostname" x="0" y="0" width="400" height="200"/><rect fill="#000
```

breaks out of the `fill="..."` attribute and injects **arbitrary SVG nodes** into
the layer that `sharp` then rasterizes. Confirmed: the injected node is emitted
verbatim into the SVG and the render succeeds without error (§ Attack 2).

Impact depends on the shipped libvips/SVG backend (Finding-question 5): at
minimum it is output-integrity tampering; if the SVG loader honors `<image href>`
to local files or URLs, it escalates to **local file inclusion / SSRF** rendered
into the output image (which MCP returns inline). The `text` content itself is
safe — it is converted to glyph outline paths, not raw SVG text — so the exposure
is specifically the style fields (and any other unescaped interpolation).

**Mitigations:**
- Validate `color`/`stroke`/`background` against a strict pattern (`#rgb`,
  `#rrggbb`, `#rrggbbaa`, `rg(b)a(...)`, named-color allowlist) at the schema
  level; reject anything else.
- Additionally XML-escape every interpolated attribute value (`"`,`&`,`<`,`>`)
  as defense-in-depth before building SVG strings.
- Configure the SVG rasterizer to disallow external/remote references and
  `<image>` loading; pin to a backend (e.g. resvg) with resource loading off.

### F4 — DoS / resource exhaustion (unbounded dimensions, frames, text, concurrency) — **High**

No upper bounds anywhere in the size-controlling inputs:

- **Canvas**: `width`/`height` are only `z.number().int().positive()`
  (`src/spec.ts:44-45`). `renderCanvasBase` allocates `w*h*4` bytes. A
  `50000x50000` canvas (~10 GB RGBA) hangs/ooms the process — reproduced,
  timed out at 30 s with no output (§ Attack 3).
- **Layout**: `width` and `grid` are unbounded positive ints; `cellHeight =
  cellWidth` so total height scales too (`src/render/layout.ts:33-37`).
- **`maxWidth`**: unbounded positive int (`src/spec.ts:66`) — upscaling target.
- **GIF**: an animated base with many pages × many overlays builds a
  `composites` array of size `frames × overlays` and composites per frame
  (`src/render/gif.ts:28-34`) — memory blows up with frame count.
- **Text**: `text` is unbounded; `wrapText`/`measureText`/`glyphPath` are linear
  in length and the produced SVG path string grows with it — a multi-megabyte
  caption is CPU + memory heavy.
- **Input images**: no `sharp` `limitInputPixels` is set, so a small
  **decompression-bomb** image via `base.path`/`cells[].image` can decode to a
  huge raster (F2 amplifier).
- **Concurrency**: the MCP server runs each tool call with no queue, timeout, or
  in-flight cap. A host that issues many concurrent `render_meme` calls (or one
  slow malicious render) can exhaust CPU/memory with no backpressure.

**Mitigations:**
- Clamp/validate max canvas & layout dimensions and total output pixels
  (e.g. ≤ 4096×4096, ≤ ~16 MP) and max `maxWidth`; reject over-limit specs with
  `INVALID_SPEC`.
- Cap GIF frame count and total `frames × overlays` work.
- Enforce a max `text` length (per box and aggregate).
- Set `sharp` `{ limitInputPixels: <cap> }` and a max input file size.
- Wrap each render in a hard timeout; add a small concurrency limiter/queue on
  the MCP server and reject when saturated.

### F5 — Untrusted image/SVG parsing as sandbox-escape surface — **Medium**

All base/cell/GIF inputs flow through native libvips codecs (`sharp`). Historic
CVEs exist across libvips and its underlying decoders (libwebp, giflib, TIFF,
librsvg). Feeding attacker-chosen files (F2) into native parsers is the classic
memory-safety attack surface, and SVG inputs specifically can pull in external
resources. There is no allowlist of accepted input formats and SVG is not
disabled.

**Mitigations:**
- Keep `sharp`/libvips patched; pin and monitor for CVEs.
- Restrict accepted input formats to a raster allowlist (png/jpeg/gif/webp) and
  **reject SVG inputs** on untrusted surfaces; set `limitInputPixels` and size
  caps.
- Consider running renders in a locked-down worker/subprocess (seccomp, no net,
  read-only fs except output dir) for the MCP surface — least privilege.

### F6 — Filesystem path / error disclosure — **Low**

`IO_ERROR` messages embed absolute paths and raw underlying errors and are
returned to the caller (`renderer.ts:107,202`, `catalog.ts:21`, `layout.ts:53`,
`gif.ts:22`), and `errorResult`/`fail` propagate `err.message`
(`mcp.ts:18-24`, `cli.ts:17-23`). This leaks directory structure and existence of
paths to a remote MCP caller.

**Mitigations:** return generic error codes to the MCP caller; log detailed
paths server-side only. Avoid echoing the offending path back.

### F7 — Latent template-manifest path traversal — **Low (latent)**

`templateImagePath` does `join(templatesDir, template.file)`
(`catalog.ts:65-69`) and the manifest `file`/`source` fields are unconstrained
strings (`TemplateSchema`, `spec.ts:95-107`). `loadManifest(templatesDir)` and
`listTemplates`/`getTemplate` accept a `templatesDir` argument. Today only the
bundled trusted manifest/dir is used, so this is not currently exploitable — but
if `templatesDir` ever becomes agent/env-configurable, or a plugin/third-party
manifest is loaded, a `file: "../../../../etc/passwd"` yields arbitrary read via
the render path.

**Mitigations:** validate `template.file` is a relative path with no `..`, and
confirm the resolved path stays under `templatesDir`; keep `templatesDir`
non-configurable from untrusted input.

### F8 — npm publish / supply-chain hardening — **Info**

`package.json` correctly restricts published contents via `files: ["dist",
"assets"]` and declares `bin` entries (`meme`, `meme-maker-mcp`). Residual risks
for a package that ships to agent runtimes with native deps: ensure publishes use
**2FA + `npm publish --provenance`**, a committed lockfile is used in CI, and
dependencies stay pinned/`^`-bounded to versions ≥7 days old (avoid `latest`/`*`).
Given `sharp` is a native/binary dependency, a compromised release is high-blast-radius.

**Mitigations:** enable provenance + 2FA on the publish workflow; add `npm
audit`/lockfile-lint to CI; document a dependency-update policy that prefers
aged, pinned versions.

### Non-findings (verified safe)

- **Font selection is not path-traversable.** `loadFont` only accepts keys in
  `BUILTIN_FONTS` and joins a fixed filename under `FONTS_DIR`
  (`font.ts:273-286`) — arbitrary `--text` slot/font strings cannot load
  external font files.
- **No command execution / shell interpolation.** Text, slot names, and template
  ids are never passed to a shell; there is no `child_process`/`exec`/`eval`.
  Slot/template ids are used only for object lookups and string interpolation
  into SVG glyph paths or error text, not command lines.
- **Text content is not an SVG-injection vector.** Captions are converted to
  glyph outline `<path d>` data, not emitted as raw SVG text nodes (the injection
  in F3 is via *style* fields, not `text`).
- **MCP inline-size guard exists.** Inline image bytes are gated at
  `MAX_INLINE_BYTES = 1_000_000` (`mcp.ts:9,44`), limiting base64 response bloat
  (though it does not bound the *render* cost — see F4).

---

## 4. Attack simulations (reproduced locally)

All run against the built `dist/` on `main`.

### Attack 1 — Arbitrary write / traversal (F1)

```
$ node dist/cli.js render --canvas 100x50 --text "hi" \
    --out /tmp/atk/../atk_escape.png --json
{ "path": "/tmp/atk/../atk_escape.png", ... }
$ ls -la /tmp/atk_escape.png
-rw-r--r-- 1 ubuntu ubuntu 394 ... /tmp/atk_escape.png   # escaped the intended dir
```

The write lands outside the "intended" directory; an absolute path
(`--out /home/user/.bashrc`) would clobber it directly.

### Attack 2 — SVG markup injection via `style.color` (F3)

Spec with a crafted `style.color` breaking out of `fill="..."` and injecting an
`<image>`/`<rect>` node:

```
$ node dist/cli.js spec render inject.json --json
{ "path": ".../inject_out.png", "bytes": 1086, "warnings": [] }   # accepted, no error
```

Confirmed the injected node reaches the SVG (via `renderTextLayer`):

```
color = '#000"/><rect x="0" y="0" width="400" height="200" fill="#ff0000"/><rect fill="#000'
=> emitted SVG contains  <rect ... fill="#ff0000"/>   → "INJECTED-NODE-PRESENT"
```

An attacker controls arbitrary SVG nodes in the rasterized layer; impact escalates
to LFI/SSRF if the SVG backend loads `<image href>` (Finding-question 5).

### Attack 3 — DoS via unbounded canvas (F4)

```
$ timeout 30 node dist/cli.js render --canvas 50000x50000 --out huge.png
# no output; killed at 30s. 50000*50000*4 ≈ 10 GB RGBA allocation.
```

A single small tool call ties up CPU/memory indefinitely; many concurrent MCP
calls have no backpressure.

### Attack 4 — Arbitrary file read into output (F2)

```
$ node dist/cli.js render --image <any-path>.jpg --text read --out read_out.png --json
{ "path": "read_out.png", "width": 1200, "height": 1200, ... }
```

Any `sharp`-decodable file at any path is read and rendered; over MCP the bytes
are returned inline as base64 → read-and-exfiltrate primitive.

---

## 5. Prioritized remediation summary

| # | Issue | Severity | Core mitigation |
|---|-------|----------|-----------------|
| F1 | Arbitrary write via `output.path` | High | Path confinement to output root; no abs/`..`/symlink; no-overwrite default |
| F2 | Arbitrary read via `base.path`/cells | High | Path confinement; inline-only inputs on MCP; `limitInputPixels` |
| F3 | SVG injection via style fields | High | Validate colors; XML-escape attrs; disable external SVG refs |
| F4 | DoS: unbounded size/frames/text/concurrency | High | Dimension/pixel/frame/text caps; per-render timeout; MCP concurrency limit |
| F5 | Native image/SVG parse surface | Medium | Patch libvips; raster-only allowlist; reject SVG; sandbox worker |
| F6 | Path/error disclosure | Low | Generic MCP errors; log detail server-side |
| F7 | Latent manifest `file` traversal | Low | Validate relative-only `file` under templates dir |
| F8 | npm publish hardening | Info | 2FA + provenance; pinned aged deps; `npm audit` in CI |

**Cross-cutting recommendation:** treat CLI args and MCP tool arguments as
untrusted, and adopt two defaults for the MCP surface — (a) a single configured
output/input root with strict path confinement, and (b) hard resource limits +
per-call timeout + concurrency cap. These two changes neutralize the majority of
the high-severity findings.
