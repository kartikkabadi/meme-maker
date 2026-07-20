# Review: meme-maker × Synara — Integration & Ecosystem Fit

**Scope:** integration review of `kartikkabadi/meme-maker` (branch `devin/polish`, v0.1.0) against `kartikkabadi/synara` (default branch). Review only — no code changes.

## 1. What each side is

### meme-maker
- TypeScript/Node ≥20 package (`agent-meme-maker`) with three surfaces over one core:
  - **CLI** (`meme`): commander-based, JSON-in/JSON-out.
  - **MCP server** (`meme-maker-mcp`): stdio transport, 5 tools — `list_templates`, `get_template`, `render_meme`, `render_layout`, `preview_template`. Tool results return JSON metadata plus an inline `image` content block when the output is ≤1 MB (`MAX_INLINE_BYTES`, `src/mcp.ts`).
  - **Library**: `renderMeme(spec)`, catalog, zod `MemeSpec` schemas (`src/index.ts`).
- Fully offline and deterministic; ~32 image + 5 GIF templates ship in `assets/`.
- Native dependency: `sharp` (libvips). MCP dep: `@modelcontextprotocol/sdk` (stdio only; no HTTP transport).
- **Important:** the implementation lives on unmerged branches (`devin/v1-core` → `devin/polish`); the default branch has only README/DESIGN, and the package is not published to npm.

### Synara (relevant subsystems)
- Bun/Effect monorepo: `apps/server` (orchestration, provider adapters, git), `apps/web` (React chat UI), `apps/desktop` (Electron), `packages/contracts` (schemas).
- **Threads/turns/deciders:** orchestration domain events flow through `apps/server/src/orchestration` (Decider, ProjectionPipeline) to the web store over WebSocket (`orchestration.domainEvent`).
- **Providers:** 9 provider adapters (Codex app-server JSON-RPC, Claude Agent SDK, ACP agents Cursor/Grok/Droid, OpenCode, Kilo, Pi, Antigravity) in `apps/server/src/provider/Layers/*`. Canonical items include `mcp_tool_call` and `image_generation` lifecycle types (`packages/contracts/src/providerRuntime.ts`), rendered in the timeline/work log (`TimelineWorkEntryRow.tsx`, `workLog.ts`, `toolCallLabel.ts`).
- **Synara is already an MCP host *and* an MCP server:** the agent gateway (`apps/server/src/agentGateway/`) exposes `synara_*` tools over HTTP+bearer token and **injects itself into each provider's native MCP config** via `mcpInjection.ts` — Codex `[mcp_servers.synara]` TOML, Claude `mcpServers` HTTP entry, ACP `mcpServers` session entries (with a stdio proxy fallback). OpenCode/Kilo (pooled server processes) and Pi (native custom-tool API) take special paths (`provider/runtimeLayer.ts`).
- **Worktrees:** threads can be worktree-backed for isolated agent edits (`apps/server/src/git/Layers/GitManager.ts`, `worktreeCleanup.ts`).
- **Surfaces:** chat timeline with inline image handling (`localImageFiles.ts`, `localImageRoute`, `codexGeneratedImages.ts`, `studioGeneratedImages.ts`); Studio for long-running autonomous tasks (`studioOutputs.ts`); composer slash commands (built-in `/clear`, `/review`, `/automation`, `/fork`, … plus discovered provider-native commands — there is **no `/loop`** in Synara; that lives in `chatgpt-yolo`).
- `plans/006-make-synara-the-agent-harness.md` shows the direction: Synara as the authoritative harness, with validated batch thread creation and stronger MCP invocation scoping.

## 2. Five-dimension analysis (Synara-weighted)

| Dimension | Assessment |
|---|---|
| **Architecture fit** | Excellent as an *out-of-process tool server*. meme-maker's stdio MCP shape matches exactly how Synara's providers already consume MCP servers. Embedding it in-process in `apps/server` would drag `sharp` (native libvips) into the Bun/Electron build for no benefit. |
| **Protocol/interface fit** | High. All 8 gateway-capable providers can call stdio MCP servers via their native configs (the same channel `mcpInjection.ts` uses). Gaps: no HTTP transport in meme-maker (Synara's own gateway pattern is HTTP-first), and OpenCode/Kilo/Pi have constrained MCP paths. |
| **UX surfaces** | Good but unverified end-to-end: MCP tool calls render as `mcp_tool_call` work entries in the timeline; whether the inline `image` content block (≤1 MB base64) is displayed as an image inline — vs. only the JSON text part — needs verification. Synara has plumbing to serve local image files (`localImageRoute`), which suits the `output.path` flow better. |
| **Packaging & distribution** | Weakest dimension. Implementation is unmerged to the default branch and unpublished. A Synara user today cannot `npx meme-maker-mcp`. `sharp` requires per-platform prebuilt binaries — fine for a user-installed npm package, risky if bundled into the Synara desktop app. |
| **Ecosystem fit** | Strong conceptually: agents in Synara produce PR comments, social content, and docs where a meme is a legitimate artifact; meme-maker is provider-agnostic so one registration serves all 9 providers. It should stay a generic MCP server usable by Claude/Cursor/Devin directly, not become Synara-specific. |

## 3. Integration options considered

| Option | Verdict |
|---|---|
| **A. MCP server registered in each provider's native config** | ✅ **Recommended.** Zero Synara code changes; reuses the exact channel Synara already relies on for its own gateway. |
| B. npm library dependency inside `apps/server` | ❌ Pulls `sharp` into Bun/Electron; couples release cycles; duplicates what MCP already gives every provider. |
| C. Web UI inside Synara (template gallery/editor) | ❌ Contradicts meme-maker's agents-not-humans thesis; large surface for marginal value. Revisit only if humans ask to browse templates. |
| D. Sidecar HTTP service managed by Synara | ⚠️ Overkill now. Becomes attractive only if Synara grows a first-party "managed tool servers" catalog (a natural extension of `mcpInjection.ts`). |
| E. Provider plugin (e.g. Codex plugin with `mcpServers`) | ⚠️ `codexDiscoveryCatalog.ts` shows Codex plugins can declare `mcpServers`, but this covers only one of nine providers. |

## 4. Simulated integration scenarios

### Scenario 1 — Chat thread: "make me a Drake meme about tabs vs spaces"
User config: `meme-maker-mcp` registered in `~/.codex/config.toml` (or Claude `mcpServers`). In a worktree-backed Synara thread, the agent calls `list_templates {search:"drake"}` → `get_template {id:"drake"}` → `render_meme {base:{kind:"template",id:"drake"}, texts:[…], output:{path:"drake.png"}}`.
- **Works:** tool calls appear as `mcp_tool_call` timeline entries; the file lands in the thread's cwd; result JSON gives path/dimensions; image ≤1 MB also comes back inline.
- **Friction:** the PNG is written *into the worktree*, dirtying `git status` and potentially getting committed by a Stacked Action. There's no blessed scratch/attachment output dir an MCP server can target.
- **Friction:** unverified whether Synara's timeline renders the MCP `image` content block inline or only the JSON text.

### Scenario 2 — Gateway sub-agent: parent thread delegates meme production
A parent thread uses `synara_*` gateway tools to spawn a child thread ("generate 5 memes for the release announcement"). The child (any provider with meme-maker registered) renders memes and reports paths; parent reads them via thread-read tools.
- **Works:** fits the harness plan's batch-creation direction; worktree isolation prevents collisions.
- **Insight:** the sub-agent adds no value over Scenario 1 unless the memes are one step of a larger delegated task — meme-maker should *not* require the gateway. Direct MCP is the right default; the gateway composes on top for free.

### Scenario 3 — Studio/automation: recurring meme batch for social content
A long-running Studio task or `/automation` run scripts the **CLI** (`meme render --spec spec.json`) inside its workspace, writing outputs to `studioOutputs`-style directories, mirroring `studioGeneratedImages.ts` handling.
- **Works:** CLI's JSON mode and determinism suit scripted/CI-style runs; no MCP session needed.
- **Friction:** requires `agent-meme-maker` to be installable (`npx`) — blocked on npm publication; Node ≥20 must be on PATH in the Studio workspace (Synara itself runs on Bun).

## 5. Integration gaps

1. **Unshipped:** implementation unmerged to the default branch; not published to npm. This blocks *every* integration path.
2. **No managed-MCP registration UX in Synara:** users must hand-edit per-provider configs (codex TOML, Claude settings, …) ×9 providers. `mcpInjection.ts` already knows every provider's format but is hardcoded to the `synara` gateway server.
3. **Output location:** no convention for tool-generated artifacts in worktree-backed threads — rendered memes dirty the git worktree; no automatic serving via `localImageRoute`/attachment store.
4. **Inline image rendering unverified:** MCP `image` content blocks vs. Synara's `image_generation`-item pipeline; GIF animation in the timeline also unverified.
5. **Provider coverage holes:** OpenCode/Kilo (pooled server, isolated managed-server path) and Pi (custom-tool API, no MCP client) can't use a plain stdio registration.
6. **Transport mismatch for future managed mode:** meme-maker is stdio-only; Synara's injection pattern prefers HTTP (with a stdio proxy fallback), so a managed sidecar would either use the proxy or need an HTTP mode (DESIGN.md v2 already lists an HTTP API).
7. **`sharp` platform binaries:** fine as a user-space npm install; a hazard if ever bundled into the Electron desktop build.

## 6. Concrete integration questions

1. **Does Synara's timeline render `image` content blocks from `mcp_tool_call` results inline** (like `image_generation` items), or only the JSON text part? If not, should it — or should meme-maker lean on `output.path` + `localImageRoute`?
2. **Should Synara grow a first-party "tool servers" catalog** that generalizes `mcpInjection.ts` beyond the `synara` gateway, so servers like meme-maker are registered once and injected into all provider configs — and if so, is meme-maker the pilot?
3. **Where should MCP tools write artifacts in worktree-backed threads** — the worktree (visible in diffs, risk of accidental commit), a scratch workspace (`scratchWorkspaces.ts`), or the managed attachment store? Should Synara expose a per-thread `SYNARA_ARTIFACTS_DIR` env var to injected servers?
4. **Is provider parity required?** Do OpenCode/Kilo/Pi threads need meme-maker (via Pi's custom-tool projection / OpenCode managed-server path), or is coverage on Codex/Claude/ACP providers enough for v1?
5. **Distribution:** publish `agent-meme-maker` to npm (pinning `sharp`) so registration is `npx -y agent-meme-maker meme-maker-mcp`, or vendor it as a git dependency? Who owns the release cadence relative to Synara?
6. **Should GIF outputs be first-class in the timeline** (animated preview), given 5 of 37 templates are GIFs and GIF renders can exceed the 1 MB inline cap?
7. **Does the harness policy need a tool-namespace rule** so `meme_*`/tool results are never confused with `synara_*` control tools in the model's context (cf. plan 006's capability scoping)?

## 7. Recommendation

**Simplest robust design: keep meme-maker a standalone npm package whose stdio MCP server is registered in each provider's native config. No Synara code changes for v1.**

Phased:

1. **Phase 0 (unblock):** merge `devin/polish` to the default branch; publish `agent-meme-maker@0.1.0` to npm. Document one-line registration snippets per provider (Codex TOML, Claude `mcpServers`, Cursor/Grok/Droid ACP) in the README.
2. **Phase 1 (convention):** default `output.path` to a `.memes/` (or OS temp) directory instead of the cwd when running under an agent, so worktree-backed Synara threads don't dirty git status; keep the ≤1 MB inline image for immediate visibility.
3. **Phase 2 (optional, Synara-side):** if a managed experience is wanted, generalize `mcpInjection.ts` into a small "registered tool servers" table (name → command/URL) injected alongside the `synara` entry, plus verification that `mcp_tool_call` image content renders inline in the timeline. meme-maker needs no changes to benefit.

Explicitly rejected: embedding as a library in `apps/server`, a meme web UI inside Synara, and a mandatory sidecar — each adds coupling or native-binary risk without improving what agents can already do through MCP.
