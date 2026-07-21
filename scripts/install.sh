#!/bin/sh
# Installer for agent-meme-maker.
# Usage: curl -fsSL https://github.com/kartikkabadi/meme-maker/releases/latest/download/install.sh | sh
set -eu

REPO="kartikkabadi/meme-maker"
INSTALL_DIR="${MEME_MAKER_HOME:-$HOME/.agent-meme-maker}"
BIN_DIR="${MEME_MAKER_BIN:-$HOME/.local/bin}"

command -v node >/dev/null 2>&1 || { echo "error: node >= 20 is required" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "error: node >= 20 is required (found $(node -v))" >&2; exit 1; }

TAG="${MEME_MAKER_VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -m1 '"tag_name"' | cut -d '"' -f 4)}"
[ -n "$TAG" ] || { echo "error: could not resolve latest release tag" >&2; exit 1; }

echo "Installing agent-meme-maker $TAG to $INSTALL_DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://github.com/$REPO/releases/download/$TAG/agent-meme-maker-$TAG.tar.gz" \
  -o "$TMP/pkg.tar.gz"
tar -xzf "$TMP/pkg.tar.gz" -C "$TMP"

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r "$TMP/agent-meme-maker-$TAG/." "$INSTALL_DIR/"

# Native deps (sharp) are platform-specific, so resolve them on the target machine.
(cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

mkdir -p "$BIN_DIR"
printf '#!/bin/sh\nexec node "%s/dist/cli.js" "$@"\n' "$INSTALL_DIR" > "$BIN_DIR/meme"
printf '#!/bin/sh\nexec node "%s/dist/mcp.js" "$@"\n' "$INSTALL_DIR" > "$BIN_DIR/meme-maker-mcp"
chmod +x "$BIN_DIR/meme" "$BIN_DIR/meme-maker-mcp"

echo "Installed: $BIN_DIR/meme and $BIN_DIR/meme-maker-mcp"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: add $BIN_DIR to your PATH" ;;
esac
