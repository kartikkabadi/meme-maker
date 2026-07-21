#!/usr/bin/env bash
# Re-renders the static meme frames used by the launch video via the repo CLI.
set -euo pipefail
cd "$(dirname "$0")"
CLI="node ../../dist/cli.js"
mkdir -p assets

$CLI render --template drake --force \
  --text no="MANUAL MEME EDITORS" --text yes="A CLI FOR AGENTS" \
  -o assets/scene2-drake.png

$CLI render --template expanding-brain --force \
  --text level1="COPY-PASTING TEMPLATES" --text level2="ONLINE MEME EDITORS" \
  --text level3="A DETERMINISTIC CLI" --text level4="AGENTS RENDERING MEMES VIA MCP" \
  -o assets/scene3-expanding-brain.png

$CLI render --template two-buttons --force \
  --text left="CLI" --text right="MCP SERVER" \
  --text caption="WHY NOT BOTH? (+ HTTP API + WEB UI)" \
  -o assets/scene4-two-buttons.png

$CLI render --template always-has-been --force \
  --text realization="WAIT, IT'S ALL JUST ONE JSON SPEC?" --text response="ALWAYS HAS BEEN" \
  -o assets/scene5-always-has-been.png

$CLI render --template success-kid --force \
  --text top="609 TEMPLATES" --text bottom="ZERO CLOUD" \
  -o assets/scene6-success-kid.png
