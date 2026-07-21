# Installing meme-maker

meme-maker ships a CLI (`meme`) and an MCP server (`meme-maker-mcp`). All
install methods put both on your PATH.

## Prerequisites

- **Node.js >= 20** (all methods). The installer checks this and tells you how
  to get Node if it's missing.
- `curl` (or `wget`), plus `tar` — present on any stock Linux/macOS system.
- Windows: use [WSL](https://learn.microsoft.com/windows/wsl/); native Windows
  shells are not supported by the curl installer.

## Method 1: curl one-liner (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
```

What it does:

1. Detects your OS/arch and picks an install prefix: `/usr/local` when run as
   root, otherwise `~/.local`.
2. Verifies Node.js >= 20 is available (npm is only used internally — you never
   run it yourself).
3. Downloads the latest tagged release (falling back to `main`), builds it, and
   installs the app — including the template library from `assets/templates` —
   into `~/.meme-maker`.
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

## Method 2: npm

```sh
npm i -g agent-meme-maker
# or run without installing:
npx agent-meme-maker templates list
```

Note: the npm package does not yet bundle the full template library (it lives
in `assets/templates`, ~89 MB); the curl installer is the recommended way to
get the complete catalog.

## Method 3: build from source

```sh
git clone https://github.com/kartikkabadi/meme-maker.git
cd meme-maker
npm install
npm run build
node dist/cli.js templates list   # or: npm link, then use `meme` directly
```

## Verifying an install

```sh
meme --version
meme templates list | head
meme render --template drake --text no="MANUAL EDITORS" --text yes="ONE-LINE INSTALL" -o out.png
```
