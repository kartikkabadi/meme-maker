# UI/UX & Visual Design Review — meme-maker

**Reviewer focus:** UI/UX and visual pleasantness
**Scope:** `kartikkabadi/meme-maker` (branch `devin/polish`, v0.1.0 — CLI + MCP + library, 37 templates) with `kartikkabadi/synara` as the reference host environment for agent-driven flows.
**Status:** Review only — no implementation.

---

## 1. Executive summary

meme-maker is a deliberately headless product: the "UI" today is `--text no="..." --text yes="..."` and five MCP tools. As an agent tool it is excellent — deterministic, offline, machine-readable errors, slot `hint`s that teach agents template semantics without seeing pixels. But the moment a *human* is in the loop (reviewing an agent's meme, tweaking a caption, browsing 37 templates, or making a meme themselves), the experience collapses to "open a PNG in your file browser and re-run a command." The DESIGN.md explicitly derives from a GUI product (SupaBird's Meme Maker) and re-encodes every GUI affordance as flags — this review proposes re-adding the human layer on top of the same core, without compromising the agent-first architecture.

**Headline recommendation:** ship a small local web UI (`meme ui`) served by the existing Node core — a template gallery + live-preview editor that reads/writes the exact same `MemeSpec` JSON the CLI and MCP consume. MemeSpec becomes the single document format shared by humans and agents; the UI is a MemeSpec editor with pictures.

---

## 2. Five-dimension analysis

### 2.1 UI/UX & visual design (primary focus)

**What exists**

- No GUI. Human-facing surface is CLI help text, `--json` output, and README examples.
- `templates show <id> --preview <path>` writes a blank template to disk — the only "preview" affordance, and it requires a separate image viewer.
- MCP `preview_template` / inline image blocks give *agents* (and chat UIs that render MCP images) a visual, but there is no human-controllable equivalent.
- Default output naming (`meme-<template>-<hash>.png`) is agent-friendly but human-hostile: no way to find "the one I just made" among ten renders.

**Gaps (severity-ordered)**

| # | Gap | Impact |
|---|-----|--------|
| G1 | No way to visually browse the 37-template catalog. Humans choose memes by *seeing* them; `templates list --json` returns names and tags only. | High |
| G2 | No live preview / iterate loop. Every caption tweak = re-run CLI + reopen file. Meme-making is inherently iterative (fit, line breaks, tone). | High |
| G3 | Slot placement is invisible. `rect: [620, 30, 560, 540]` is meaningless to a human; there's no rendered overlay showing where `no`/`yes` land. | High |
| G4 | No gallery/history of rendered memes. Outputs scatter into the CWD with hash names. | Medium |
| G5 | Text overflow is a silent `warnings` array entry, not a visual signal. A human would never notice their caption was shrunk to 9px. | Medium |
| G6 | No branding or visual identity: no logo, no color, no personality — notable for a *meme* tool. | Medium |
| G7 | No drag/nudge affordance for free-placement text (`x/y/width/height` in px or `%` strings must be hand-computed). | Medium |
| G8 | GIF templates can't be previewed in motion anywhere in the toolchain. | Low |
| G9 | No dark/light theming question even arises yet — but the future UI must ship both (agents' hosts, e.g. Synara, are dark-first). | Low |

**Verdict:** the core rendering engine has strong "output aesthetics" (Anton/Impact classic styling, auto-fit, stroke+fill) but the *product* currently has zero human UX. That's acceptable for v1's stated scope; it is the single biggest opportunity for v2.

### 2.2 Functionality & completeness

- Feature set matches DESIGN.md v1 fully: templates, GIFs, canvas, layouts, custom images, spec files, MCP, library API.
- The `top`/`middle`/`bottom` convenience slots on non-template bases are a great low-friction affordance and should be the backbone of any beginner UI mode.
- Missing for a UI: no `render --dry-run`/measure endpoint (returns layout boxes without rasterizing) that a UI could use for instant overlay feedback; no thumbnail assets (UI would need to derive them).

### 2.3 Architecture & extensibility

- Clean layering (CLI/MCP as thin adapters over `renderMeme(spec)` + zod `MemeSpec`) is *ideal* for adding a UI: a local HTTP/WS server can reuse the exact same entry point. No refactor needed.
- Determinism means the UI can cache previews keyed by spec hash — cheap live preview.
- Risk: `manifest.json` slot rects are hand-tuned; a visual slot-editor UI would double as a maintainer tool for tuning them (currently trial-and-error).

### 2.4 Code & docs quality

- README and DESIGN.md are clear and honest about scope. Examples directory is good.
- For a UI effort: no screenshots/rendered examples in the README — even a headless tool should *show* its output. A "template contact sheet" image in the README is a 30-minute win.

### 2.5 Agent-integration ergonomics

- MCP tool set is well-shaped; inline image ≤1MB is the right call for chat surfaces.
- `preview_template` returning the blank template lets agents "see before captioning" — the human UI should mirror this exact flow.
- Missing: an MCP tool/URI that returns a *shareable local URL* to an editor pre-loaded with a spec (`open_in_editor(spec) → http://localhost:PORT/edit#<spec>`), which is the key handoff primitive for agent→human flows (see §6).

---

## 3. Concrete UX questions (for the maintainer)

1. **Who is the human user?** Is the UI primarily (a) a *review surface* for memes agents already made, (b) a standalone meme editor competing with imgflip, or (c) a maintainer tool for tuning template slot rects? The answer changes the default screen (gallery vs. editor vs. inspector). Recommendation: (a) first — it matches the agent-first thesis.
2. **Web or desktop?** A local web UI (`meme ui` → localhost) reuses the Node core with zero packaging cost and embeds trivially in Synara via iframe/webview. Is there any requirement (offline file pickers, OS share sheets) that justifies Electron/Tauri instead?
3. **Should the UI write MemeSpec files as its save format?** i.e., "Save" produces `my-meme.json` (+ rendered PNG), so any human-made meme is instantly reproducible/editable by an agent. Strongly recommended — it makes the spec the collaboration contract.
4. **Drag-and-drop vs. declarative-first editing?** Do we let users freely drag text boxes (then serialize to `x/y/width/height`), or keep editing slot-based (click a slot, type text) with drag reserved for an "advanced" mode? Slot-first keeps 90% of sessions to two text fields and zero layout decisions.
5. **How should overflow/auto-shrink be surfaced?** When auto-fit shrinks text below a readability threshold, should the UI show a warning chip on the text box, a suggested shorter caption, or both? (The engine already emits `warnings` — they just need pixels.)
6. **What is the keyboard-first path?** Power users and agents-watching-humans benefit from: `/` focus search, `1..9` select template, `Tab` cycle slots, `⌘/Ctrl+Enter` render, `⌘/Ctrl+S` save spec+image. Do we commit to full keyboard operability from v1 of the UI (it's also the accessibility baseline)?
7. **Does the gallery need server-side state?** Rendered-meme history could be purely `~/.meme-maker/history/` (spec + output pairs) with no DB. Is filesystem-as-state acceptable for v1?

---

## 4. Simulated user scenarios

### Scenario A — Non-technical user makes a meme (today → proposed)

**Persona:** Maya, a marketer, told "the meme tool is installed, make something for the launch tweet."

*Today:* Maya must discover CLI syntax, run `node dist/cli.js templates list`, read JSON, guess what "two-buttons" looks like, hand-edit `--text` flags, open the output file manually, and iterate blind. Realistically she gives up and screenshots imgflip. **Failure.**

*Proposed:* `meme ui` opens a gallery of 37 visual cards (Image/GIF tabs, tag filter chips, search). She clicks Drake → editor shows the template with two highlighted slot regions labeled with their hints ("the rejected option" / "the preferred option"). She types into two side-panel fields; preview re-renders ~instantly (debounced, spec-hash cached). Overflow chip appears on slot 2 — she shortens the caption. `⌘S` downloads PNG; the spec JSON is saved to history. Total time: under a minute, zero docs read. **Success criterion: first meme in <60s with no documentation.**

### Scenario B — Agent picks a template in chat (Synara)

**Persona:** A Synara thread where the user says "reply to this PR with a 'this is fine' meme about the flaky CI."

*Today:* Works well — the agent calls `list_templates(search:"fine")`, `render_meme`, and Synara's transcript renders the inline MCP image. The human's only controls are conversational ("make the text bigger"), which round-trips a full agent turn for a 2-second tweak.

*Proposed:* The rendered image block in the transcript carries an **"Open in Meme Editor"** affordance (a link to `http://localhost:PORT/edit?spec=<base64>` served by `meme ui`, rendered via Synara's existing `InlineLinkChip`/`LocalImagePreview` patterns). The human clicks, tweaks the caption in the visual editor, saves, and pastes/attaches the result — no extra model turn, no token cost. The agent and human are editing the *same MemeSpec document*. **Success criterion: human tweak of an agent meme without a model round-trip.**

### Scenario C — Power user batches 10 memes

**Persona:** Kartik generating a 10-meme deck for a talk.

*Today:* Feasible and decent: a shell loop over `meme spec render specs/*.json`. But choosing templates and validating results still means opening 10 files by hand.

*Proposed:* Batch flow = **spec list + contact sheet**. `meme spec render specs/ --out-dir out/` (a small CLI addition) plus a UI "Batch" view: drop 10 spec files → grid of rendered results with per-item overflow warnings → click any cell to hot-edit → "Export all." Keyboard: `j/k` navigate grid, `Enter` edit, `e` export. **Success criterion: 10 memes reviewed and corrected in one screen, no file browser.**

### Scenario D (bonus) — Template maintainer tunes slot rects

Adding a template today means guessing `rect: [x,y,w,h]` numbers and re-rendering. The editor's drag mode doubles as the maintainer tool: drag/resize slot boxes on the image, export the manifest entry JSON. This pays for the drag feature even if end-users mostly stay slot-based.

---

## 5. Proposed visual design direction

### 5.1 Product shape

`meme ui [--port N]` — a local web app served by the existing Node process (one new `src/server.ts` + a small static frontend; Vite + React or even Preact keeps it light, matching the repo's minimalism). All rendering stays server-side through `renderMeme(spec)` — the UI never re-implements text layout, so preview = truth.

### 5.2 Screens & layout

```
┌──────────────────────────────────────────────────────────────┐
│ ◤ meme-maker            [Search /]      [Gallery] [☾ theme]  │  top bar, 48px
├──────────────────────────────────────────────────────────────┤
│ Tabs: [Image Memes] [GIF Memes] [Blank Canvas] [Layouts]     │
│ Tag chips: choice · reaction · panic · four-panel · …        │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │
│ │ ▣  │ │ ▣  │ │ ▣  │ │ ▣  │ │ ▣  │ │ ▣  │   template cards   │
│ │drake│ │dist│ │two │ │brain│ │cat │ │fine│  (thumb + name + │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    slot count)     │
└──────────────────────────────────────────────────────────────┘
```

Gallery: responsive card grid (2-col at 640px → 6-col at 1440px), lazy-loaded thumbnails, GIF cards animate on hover only (reduced-motion: never autoplay). Card click → Editor.

```
┌──────────────────────────────────────────────────────────────┐
│ ← Gallery   Drake Hotline Bling            [Render ⌘↵] [Save]│
├───────────────────────────────┬──────────────────────────────┤
│                               │  TEXT SLOTS                  │
│   ┌───────────┬───────────┐   │  ┌ no — "the rejected…" ──┐  │
│   │           │ ░░░░░░░░░ │   │  │ MANUAL MEME EDITORS    │  │
│   │  (image)  │ ← slot:no │   │  └────────────────────────┘  │
│   ├───────────┼───────────┤   │  ┌ yes — "the preferred…"─┐  │
│   │           │ ░░░░░░░░░ │   │  │ A LIVE EDITOR TOO ⚠fit │  │
│   │  (image)  │ ← slot:yes│   │  └────────────────────────┘  │
│   └───────────┴───────────┘   │  ▸ Style (font, color, …)    │
│    live preview, checkered bg │  ▸ Output (png · 1200×1200)  │
│                               │  ▸ Spec (JSON view/copy)     │
└───────────────────────────────┴──────────────────────────────┘
```

Editor: preview left (~65%), inspector right (~35%, collapses under 900px to a bottom sheet). Slot regions get dashed outlines on hover/focus; the focused text field highlights its region. "Spec" disclosure shows live MemeSpec JSON with a copy button — the agent-handoff affordance. Advanced mode toggles free drag/resize of boxes (serializing to `x/y/width/height`); a "snap to %" toggle keeps specs resolution-independent.

Gallery-of-outputs ("My Memes"): grid over `~/.meme-maker/history/`, each item = image + spec; actions: re-edit, duplicate, copy spec, reveal file.

### 5.3 Visual language

- **Personality:** confident, slightly playful, but restrained — the memes are the color; the chrome stays quiet. No comic-sans irony in the UI itself.
- **Palette:** near-black ink surface scale for dark mode (`#0d0e11 / #16181d / #1e2128`), warm paper whites for light (`#faf9f7 / #ffffff`); one saturated accent — **meme yellow** `#ffd23f` (Impact-caption yellow) for primary actions/focus, with `#e5484d` reserved for destructive/overflow warnings. Accent is decorative-only on dark text (contrast-checked ≥4.5:1 for text usage).
- **Type:** UI in Inter/system stack; **Anton appears only in the brand mark and empty states** ("NO MEMES YET / MAKE ONE") — using the meme font as the brand voice without making the UI shout.
- **Preview surface:** checkered transparency board, subtle drop shadow on the rendered image, checkered board flips lightness with theme.
- **Motion:** 150–220ms ease-out on card hover, panel disclosure, and preview swap; honor `prefers-reduced-motion` everywhere (Synara's `disclosureMotion` convention is a good reference standard).
- **Brand mark:** a simple "M" tile in caption style — white Anton "M" with black stroke on the yellow square. Works at 16px favicon and as the MCP server icon.

### 5.4 Accessibility

- Full keyboard operability (see shortcut table below); visible focus rings (2px accent, offset 2px).
- Slot regions are labeled buttons, not just canvas pixels: `aria-label="Text slot: no — the rejected option"`.
- Alt-text field per meme ("describe the joke") stored in the spec (`texts[].alt`? or `output.alt`) — memes are notoriously inaccessible; a meme *tool* that emits alt text with every render (and returns it via MCP) would be genuinely differentiating.
- Contrast AA minimum for all chrome; never rely on color alone for overflow warnings (icon + text).
- GIFs: no autoplay in grids; play-on-focus/hover with a pause control; respect reduced-motion.

### 5.5 Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `1–9` | Select nth visible template card |
| `Enter` | Open focused card in editor |
| `Tab` / `Shift+Tab` | Cycle text slots |
| `⌘/Ctrl+Enter` | Render |
| `⌘/Ctrl+S` | Save spec + image |
| `⌘/Ctrl+D` | Toggle dark/light |
| `Esc` | Back to gallery |
| `j/k`, `e` | Batch grid: navigate, export |
| `?` | Shortcuts sheet |

### 5.6 Engine additions the UI needs (small, non-breaking)

1. `measureMeme(spec)` (or `renderMeme(spec, { measureOnly: true })`) → layout boxes + fitted font sizes + warnings, no raster. Powers instant overlay feedback.
2. Pre-generated thumbnails (`assets/templates/thumbs/`, ~320px) or a `meme thumbnails` build step.
3. `meme ui` command + `GET /api/templates`, `POST /api/render`, `POST /api/measure` — thin HTTP shims over existing functions.
4. Spec history convention: `~/.meme-maker/history/<timestamp>-<hash>.{json,png}`.

---

## 6. Synara integration (`/loop` & long-running agent flows)

Findings from the Synara codebase relevant to embedding meme-maker:

- **MCP images already render.** Synara transcripts render provider image content (`LocalImagePreview.tsx`, `ChatMarkdown.tsx`), so `render_meme`'s inline ≤1MB image block appears in-chat today with zero work. This is the baseline integration and it already functions.
- **Slash commands are the natural invocation surface.** Synara has a built-in composer slash-command system (`composerSlashCommands.ts`, `@synara/shared/composerSlashCommands`) with provider-native aliases. A `/meme drake no="..." yes="..."` command (or simply prompting a provider that has the MCP server configured) fits this pattern; the command palette (`components/ui/command.tsx`) can offer template autocomplete from `list_templates`.
- **Automations / heartbeat loops** (`packages/contracts/src/automation.ts`) run prompts on a schedule or self-resuming loop. A long-running loop (e.g. "post a weekly changelog meme") would call the MCP tools unattended — which raises the human-review need: the loop's draft-review step should surface the rendered meme plus an **Open in Meme Editor** link so a human can veto/fix before publish. This is exactly the Scenario-B handoff.
- **Embedding options,** in ascending effort:
  1. *Status quo:* MCP server configured per-provider; images inline in transcript. (Works now.)
  2. *Link-out:* agent includes `http://localhost:<port>/edit#<base64-spec>` in its reply; Synara's link chips (`InlineLinkChip`) make it one click. Requires only `meme ui` to exist. **Recommended v1.**
  3. *Embedded panel:* Synara's right-dock/`BrowserPanel` pattern (`rightDockStore.ts`, `BrowserPanel.tsx`) could host the editor in-app, like its existing browser surface. Nice later; not needed to prove value.
- **Theming coherence:** if embedded (option 3), the meme UI should accept a `?theme=dark|light&accent=<hsl>` query so it inherits Synara's theme tokens (`apps/web/src/theme/`) instead of clashing.
- **Port/instance hygiene:** Synara's AGENTS.md is emphatic about local port isolation; `meme ui` must support `--port` and print a machine-readable `{ "url": ... }` line so agents can discover the address rather than assuming a default.

---

## 7. Prioritized recommendations

| P | Recommendation | Effort |
|---|----------------|--------|
| P0 | README contact-sheet image + rendered examples (show, don't tell) | XS |
| P0 | `meme ui`: gallery + slot-based editor + live preview (§5.2), dark/light | M |
| P1 | `measureMeme` / dry-run endpoint + visible overflow warnings | S |
| P1 | Spec-as-document: Save writes `{json,png}` pairs; "Open in editor" deep link (`/edit#<spec>`) | S |
| P1 | Template thumbnails in-repo | S |
| P2 | Batch/contact-sheet view; drag mode (doubles as manifest slot tuner) | M |
| P2 | Alt-text field in spec + MCP output (accessibility differentiator) | S |
| P2 | Synara: `/meme` slash command + editor link chips; later, right-dock embed | S–M |
| P3 | Brand mark, empty states, shortcuts sheet, reduced-motion audit | S |

The through-line: **MemeSpec is the shared document; the UI is just a friendly editor for it.** That keeps the agent-first identity intact while giving humans the gallery, preview, and iteration loop that meme-making actually requires.
