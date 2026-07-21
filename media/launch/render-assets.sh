#!/usr/bin/env bash
# Re-renders the static meme frames used by the launch video via the repo CLI.
# Scenes with text that would auto-fit too close to a template slot edge use
# explicit MemeSpec files (specs/*.json) with fixed font sizes.
set -euo pipefail
cd "$(dirname "$0")"
CLI="node ../../dist/cli.js"
mkdir -p assets

$CLI render --template drake --force \
  --text-file specs/scene2-drake.json \
  -o assets/scene2-drake.png

$CLI render --template expanding-brain --force \
  --text-file specs/scene3-expanding-brain.json \
  -o assets/scene3-expanding-brain.png

$CLI render --template two-buttons --force \
  --text-file specs/scene4-two-buttons.json \
  -o assets/scene4-two-buttons.png

$CLI render --template always-has-been --force \
  --text realization="WAIT, IT'S ALL JUST ONE JSON SPEC?" --text response="ALWAYS HAS BEEN" \
  -o assets/scene5-always-has-been.png

$CLI render --template success-kid --force \
  --text top="609 TEMPLATES" --text bottom="ZERO CLOUD" \
  -o assets/scene6-success-kid.png
