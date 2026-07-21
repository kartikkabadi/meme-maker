# Installing meme-maker

meme-maker ships a CLI (`meme`) and an MCP server (`meme-maker-mcp`).
Distribution is via the curl installer and GitHub Releases only — meme-maker
is **not** published to the npm registry.

## Prerequisites

- **Node.js >= 20** (runtime). The installer checks this and tells you how to
  get Node if it's missing.
- `curl` (or `wget`), plus `tar` — present on any stock Linux/macOS system.
- Windows: use [WSL](https://learn.microsoft.com/windows/wsl/); native Windows
  shells are not supported by the curl installer.

## Method 1: curl one-liner (the supported install path)

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
```

What it does:

1. Detects your OS/arch and picks an install prefix: `/usr/local` when run as
   root, otherwise `~/.local`.
2. Verifies Node.js >= 20 is available (npm is never required from you; the
   installer only uses it internally when it has to build from source).
3. Prefers a pre-built, self-contained release tarball
   (`meme-maker-<platform>-<arch>.tar.gz`) from GitHub Releases. If none is
   published for your platform, it downloads the source for the latest tagged
   release (falling back to `main`) and builds it. Either way the app —
   including the template library from `assets/templates` — lands in
   `~/.meme-maker`.
4. Writes thin `meme` and `meme-maker-mcp` wrappers into `<prefix>/bin` and
   verifies they run.

Configuration via environment variables:

| Variable          | Default                                | Purpose                        |
| ----------------- | -------------------------------------- | ------------------------------ |
| `PREFIX`          | `~/.local` (non-root) / `/usr/local`   | where wrappers are installed   |
| `MEME_MAKER_HOME` | `~/.meme-maker`                        | where the app itself lives     |
| `MEME_MAKER_REF`  | latest release tag, else `main`        | git tag/branch to install      |

Example — install a specific ref system-wide:

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh \
  | sudo PREFIX=/usr/local MEME_MAKER_REF=main sh
```

### Uninstall

```sh
rm -f ~/.local/bin/meme ~/.local/bin/meme-maker-mcp
rm -rf ~/.meme-maker
```

(Adjust the first path if you used a custom `PREFIX`.)

## Method 2: build from source (for contributors)

```sh
git clone https://github.com/kartikkabadi/meme-maker.git
cd meme-maker
npm install
npm run build
node dist/cli.js templates list   # or: npm link, then use `meme` directly
```

## For maintainers: publishing a release tarball

`scripts/package-release.sh` builds the self-contained
`meme-maker-<platform>-<arch>.tar.gz` (dist + assets + production
node_modules) for the current machine. Attach it to the GitHub Release for the
tag and the installer will pick it up automatically — users then need no npm
at all, only Node.

## Verifying an install

```sh
meme --version
meme templates list | head
meme render --template drake --text no="MANUAL EDITORS" --text yes="ONE-LINE INSTALL" -o out.png
```
