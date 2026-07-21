# Installing meme-maker

meme-maker ships a CLI (`meme`) and an MCP server (`meme-maker-mcp`).
Distribution is via the curl installer and GitHub Releases only — meme-maker
is **not** published to the npm registry, and `npm install` is not the
supported install path.

## Prerequisites

- **Node.js >= 20** (runtime). The installer checks this and tells you how to
  get Node if it's missing.
- `curl` (or `wget`), plus `tar` — present on any stock Linux/macOS system.
- Windows: use [WSL](https://learn.microsoft.com/windows/wsl/); native Windows
  shells are not supported by the curl installer.

## The one-liner

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
```

What it does:

1. Detects your OS/arch and picks an install prefix: `/usr/local` when run as
   root, otherwise `~/.local`.
2. Verifies Node.js >= 20 is available.
3. Resolves the latest tagged release by following the GitHub
   `/releases/latest` redirect (no GitHub API calls, so no API rate limits);
   if that fails it falls back to `main`.
4. Downloads the matching pre-built tarball, or falls back to building from
   source (see below). Either way the app — including the template library
   from `assets/templates` — lands in `~/.meme-maker`.
5. Writes thin `meme` and `meme-maker-mcp` wrappers into `<prefix>/bin` and
   verifies they run.

## Per-platform behavior

CI builds and attaches a self-contained tarball for each supported platform
to every tagged release:

| Platform | Release asset | Built on |
| --- | --- | --- |
| Linux x64 | `meme-maker-linux-x64.tar.gz` | `ubuntu` runner |
| macOS arm64 (Apple Silicon) | `meme-maker-macos-arm64.tar.gz` | `macos-15` runner |
| macOS x64 (Intel) | `meme-maker-macos-x64.tar.gz` | `macos-15-intel` runner |

On these platforms the installer never uses npm — the tarball contains `dist`,
`assets`, and production `node_modules` (including sharp's platform-native
libvips binaries).

## Source fallback

If no pre-built tarball matches your platform/arch (e.g. Linux arm64), the
installer downloads the source for the chosen ref and builds it. This path
**requires npm** (`npm ci && npm run build`); a note is printed when it
happens. If npm is unavailable, the installer exits with an error.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PREFIX` | `/usr/local` (root) / `~/.local` (non-root) | where the `meme` / `meme-maker-mcp` wrappers go (`$PREFIX/bin`) |
| `MEME_MAKER_HOME` | `~/.meme-maker` | where the app itself lives |
| `MEME_MAKER_REF` | latest release tag, else `main` | git tag/branch to install |
| `MEME_MAKER_TARBALL` | (unset) | local pre-built tarball to install from (skips all downloads) |

## Install from a specific release

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh \
  | MEME_MAKER_REF=v0.3.0 sh
```

(The variable goes on the `sh` side of the pipe — `MEME_MAKER_REF=v0.3.0 curl ... | sh`
would only set it for `curl`.)

Or system-wide with a custom prefix:

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh \
  | sudo PREFIX=/usr/local MEME_MAKER_REF=v0.3.0 sh
```

## Uninstall

```sh
rm -f ~/.local/bin/meme ~/.local/bin/meme-maker-mcp
rm -rf ~/.meme-maker
```

(Adjust the first path if you used a custom `PREFIX`; the installer prints the
exact uninstall commands at the end of every install.)

## Troubleshooting

- **`Node.js is required but was not found on your PATH`** — install Node >= 20
  first (https://nodejs.org/en/download, or `brew install node` on macOS), then
  re-run the installer.
- **`Node.js >= 20 required, found vX`** — upgrade Node; the runtime needs
  Node 20 or newer.
- **`meme: command not found` after installing** — `<prefix>/bin` (usually
  `~/.local/bin`) is not on your PATH. The installer prints a note when this
  is the case; add it with:

  ```sh
  export PATH="$HOME/.local/bin:$PATH"
  ```

- **GitHub 403 / rate-limit or download errors** — the installer avoids the
  GitHub API entirely, but corporate proxies or GitHub outages can still block
  downloads from `github.com` / `codeload.github.com` /
  `raw.githubusercontent.com`. Retry later, or download a release tarball
  manually and install it offline:

  ```sh
  curl -fsSLO https://github.com/kartikkabadi/meme-maker/releases/download/v0.3.0/meme-maker-linux-x64.tar.gz
  MEME_MAKER_TARBALL=$PWD/meme-maker-linux-x64.tar.gz sh install.sh
  ```

- **`no pre-built tarball ... and npm is unavailable`** — your platform has no
  pre-built release asset, so the installer must build from source; install
  npm (ships with Node) and re-run.

## Build from source (for contributors)

```sh
git clone https://github.com/kartikkabadi/meme-maker.git
cd meme-maker
npm install
npm run build
node dist/cli.js templates list   # or: npm link, then use `meme` directly
```

## For maintainers: publishing a release tarball

The Release workflow (`.github/workflows/release.yml`) builds and attaches the
per-platform tarballs listed above to every `v*` tag's GitHub Release
automatically.

`scripts/package-release.sh` builds the same tarball locally for the current
machine. To test the installer against it:

```sh
sh scripts/package-release.sh
MEME_MAKER_TARBALL=$PWD/meme-maker-linux-x64.tar.gz sh install.sh
```

## Verifying an install

```sh
meme --version
meme templates list | head
meme render --template drake --text no="MANUAL EDITORS" --text yes="ONE-LINE INSTALL" -o out.png
```
