#!/bin/sh
# meme-maker installer
#
#   curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
#
# Installs the `meme` CLI and `meme-maker-mcp` server. Requires Node.js >= 20.
# The app itself lives in $MEME_MAKER_HOME (default ~/.meme-maker); thin
# wrappers are placed in $PREFIX/bin.
#
# Environment overrides:
#   PREFIX           install prefix for wrappers (default: /usr/local as root,
#                    otherwise $HOME/.local)
#   MEME_MAKER_HOME  where the app is installed (default: $HOME/.meme-maker)
#   MEME_MAKER_REF   git ref / release tag to install (default: latest release,
#                    falling back to main)
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

command -v npm >/dev/null 2>&1 || die "npm not found (it normally ships with Node)."

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
  # Prefer the latest tagged release; fall back to main.
  if command -v curl >/dev/null 2>&1; then
    REF=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1) || true
  fi
  [ -n "$REF" ] || REF=main
fi
info "Installing $REPO@$REF"

TARBALL="$TMP_DIR/meme-maker.tar.gz"
if fetch "https://codeload.github.com/$REPO/tar.gz/refs/tags/$REF" "$TARBALL" 2>/dev/null \
  || fetch "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" "$TARBALL" 2>/dev/null; then
  SRC_DIR="$TMP_DIR/src"
  mkdir -p "$SRC_DIR"
  tar -xzf "$TARBALL" -C "$SRC_DIR" --strip-components=1
elif command -v git >/dev/null 2>&1; then
  info "Tarball download failed; falling back to git clone"
  SRC_DIR="$TMP_DIR/src"
  git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$SRC_DIR" >/dev/null 2>&1 \
    || die "could not download $REPO@$REF"
else
  die "could not download $REPO@$REF (and git is not available)"
fi

# --- build ------------------------------------------------------------------
cd "$SRC_DIR"
if [ ! -f dist/cli.js ] || [ ! -f dist/mcp.js ]; then
  info "Building from source (this may take a minute)..."
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
  npm run build >/dev/null
fi
info "Pruning dev dependencies..."
npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null

# --- install ----------------------------------------------------------------
info "Installing to $MEME_MAKER_HOME"
rm -rf "$MEME_MAKER_HOME"
mkdir -p "$MEME_MAKER_HOME"
for item in dist assets node_modules package.json LICENSE NOTICE; do
  [ -e "$item" ] && cp -R "$item" "$MEME_MAKER_HOME/"
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
