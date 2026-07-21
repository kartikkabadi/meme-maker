#!/bin/sh
# meme-maker installer
#
#   curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
#
# Installs the `meme` CLI and `meme-maker-mcp` server. Requires Node.js >= 20.
# Prefers a pre-built self-contained tarball from GitHub Releases
# (meme-maker-<platform>-<arch>.tar.gz); falls back to building from source.
# The app itself lives in $MEME_MAKER_HOME (default ~/.meme-maker); thin
# wrappers are placed in $PREFIX/bin.
#
# Environment overrides:
#   PREFIX           install prefix for wrappers (default: /usr/local as root,
#                    otherwise $HOME/.local)
#   MEME_MAKER_HOME  where the app is installed (default: $HOME/.meme-maker)
#   MEME_MAKER_REF   git ref / release tag to install (default: latest release,
#                    falling back to main)
#   MEME_MAKER_TARBALL  path to a local pre-built tarball (skips all downloads;
#                    mainly for testing scripts/package-release.sh output)
#
# Uninstall:
#   rm -f "$PREFIX/bin/meme" "$PREFIX/bin/meme-maker-mcp"
#   rm -rf "$MEME_MAKER_HOME"

set -eu

REPO="kartikkabadi/meme-maker"
NODE_MIN_MAJOR=20

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- platform detection -----------------------------------------------------
OS=$(uname -s 2>/dev/null || echo unknown)
ARCH=$(uname -m 2>/dev/null || echo unknown)
case "$OS" in
  Linux)  PLATFORM=linux ;;
  Darwin) PLATFORM=macos ;;
  MINGW*|MSYS*|CYGWIN*)
    die "native Windows is not supported; please install inside WSL (https://learn.microsoft.com/windows/wsl/)" ;;
  *) die "unsupported OS: $OS" ;;
esac
info "Detected $PLATFORM/$ARCH"

# --- prefix -----------------------------------------------------------------
if [ -z "${PREFIX:-}" ]; then
  if [ "$(id -u)" = "0" ]; then PREFIX=/usr/local; else PREFIX="$HOME/.local"; fi
fi
BIN_DIR="$PREFIX/bin"
MEME_MAKER_HOME="${MEME_MAKER_HOME:-$HOME/.meme-maker}"

# --- node check -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but was not found on your PATH."
  err "Install Node.js >= $NODE_MIN_MAJOR first, e.g.:"
  err "  - https://nodejs.org/en/download"
  err "  - macOS:  brew install node"
  err "  - Linux:  curl -fsSL https://install-node.vercel.app/lts | bash"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
  die "Node.js >= $NODE_MIN_MAJOR required, found $(node -v). Please upgrade Node."
fi
info "Using Node $(node -v)"

# --- fetch source -----------------------------------------------------------
fetch() { # url, dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else die "need curl or wget"; fi
}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

REF="${MEME_MAKER_REF:-}"
if [ -z "$REF" ]; then
  # Prefer the latest tagged release (follow the /releases/latest redirect);
  # fall back to main.
  if command -v curl >/dev/null 2>&1; then
    REF=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" 2>/dev/null \
      | sed 's|.*/tag/||')
  fi
  [ -n "$REF" ] || REF=main
fi
info "Installing $REPO@$REF"

case "$ARCH" in
  x86_64|amd64) ASSET_ARCH=x64 ;;
  aarch64|arm64) ASSET_ARCH=arm64 ;;
  *) ASSET_ARCH="$ARCH" ;;
esac

SRC_DIR="$TMP_DIR/src"
mkdir -p "$SRC_DIR"
TARBALL="$TMP_DIR/meme-maker.tar.gz"
NEED_BUILD=yes

# 0) Local pre-built tarball (testing / air-gapped installs).
if [ -n "${MEME_MAKER_TARBALL:-}" ]; then
  [ -f "$MEME_MAKER_TARBALL" ] || die "MEME_MAKER_TARBALL not found: $MEME_MAKER_TARBALL"
  info "Using local tarball $MEME_MAKER_TARBALL"
  tar -xzf "$MEME_MAKER_TARBALL" -C "$SRC_DIR" --strip-components=1
  NEED_BUILD=no
# 1) Pre-built, self-contained release asset (no npm needed at all).
elif [ "$REF" != "main" ] && ASSET_URL="https://github.com/$REPO/releases/download/$REF/meme-maker-$PLATFORM-$ASSET_ARCH.tar.gz" && fetch "$ASSET_URL" "$TARBALL" 2>/dev/null; then
  info "Using pre-built release tarball ($PLATFORM-$ASSET_ARCH)"
  tar -xzf "$TARBALL" -C "$SRC_DIR" --strip-components=1
  NEED_BUILD=no
# 2) Source tarball for the ref.
elif { info "No pre-built tarball for $PLATFORM-$ASSET_ARCH at $REF; falling back to source (requires npm)"; false; } || fetch "https://codeload.github.com/$REPO/tar.gz/refs/tags/$REF" "$TARBALL" 2>/dev/null \
  || fetch "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" "$TARBALL" 2>/dev/null; then
  tar -xzf "$TARBALL" -C "$SRC_DIR" --strip-components=1
# 3) git clone as a last resort.
elif command -v git >/dev/null 2>&1; then
  info "Tarball download failed; falling back to git clone"
  git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$SRC_DIR" >/dev/null 2>&1 \
    || die "could not download $REPO@$REF"
else
  die "could not download $REPO@$REF (and git is not available)"
fi

# --- build (source installs only) --------------------------------------------
cd "$SRC_DIR"
if [ "$NEED_BUILD" = "yes" ]; then
  command -v npm >/dev/null 2>&1 \
    || die "no pre-built tarball for $PLATFORM-$ASSET_ARCH and npm is unavailable to build from source"
  if [ ! -f dist/cli.js ] || [ ! -f dist/mcp.js ]; then
    info "Building from source (this may take a minute)..."
    npm ci --no-audit --no-fund --loglevel=error >/dev/null
    npm run build >/dev/null
  fi
  info "Pruning dev dependencies..."
  npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
fi

# --- install ----------------------------------------------------------------
info "Installing to $MEME_MAKER_HOME"
rm -rf "$MEME_MAKER_HOME"
mkdir -p "$MEME_MAKER_HOME"
for item in dist assets node_modules package.json LICENSE NOTICE README.md CHANGELOG.md; do
  if [ -e "$item" ]; then cp -R "$item" "$MEME_MAKER_HOME/"; fi
done

mkdir -p "$BIN_DIR"
write_wrapper() { # name, entry
  cat > "$BIN_DIR/$1" <<EOF
#!/bin/sh
exec node "$MEME_MAKER_HOME/dist/$2" "\$@"
EOF
  chmod +x "$BIN_DIR/$1"
}
write_wrapper meme cli.js
write_wrapper meme-maker-mcp mcp.js

# --- verify -----------------------------------------------------------------
"$BIN_DIR/meme" --version >/dev/null 2>&1 || die "installed binary failed to run"

info "Installed meme and meme-maker-mcp to $BIN_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    printf '\n\033[1;33mnote:\033[0m %s is not on your PATH. Add it with:\n' "$BIN_DIR"
    # shellcheck disable=SC2016
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac

printf '\nGet started:\n'
printf '  meme templates list\n'
printf '  meme render --template drake --text no="MANUAL EDITORS" --text yes="curl | sh" -o out.png\n'
printf '\nUninstall:\n'
printf '  rm -f "%s/meme" "%s/meme-maker-mcp" && rm -rf "%s"\n' "$BIN_DIR" "$BIN_DIR" "$MEME_MAKER_HOME"
