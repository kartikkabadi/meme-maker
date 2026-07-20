# Examples

Render a spec file:

```sh
meme spec render examples/drake.json
meme spec render examples/layout-2x2.json   # 2x2 grid; expects a.jpg..d.jpg in cwd
```

Or caption templates directly from the CLI:

```sh
# two-panel choice
meme render --template drake --text no="MANUAL MEME EDITORS" --text yes="A CLI FOR AGENTS" -o drake.png

# multi-panel plan-backfires
meme render --template grus-plan \
  --text step1="SHIP THE FEATURE" --text step2="SKIP THE TESTS" \
  --text step3="PROD IS DOWN" --text step4="PROD IS DOWN" -o plan.png

# comparison
meme render --template buff-doge-vs-cheems --text buff="DEVS IN 1999" --text cheems="DEVS NOW" -o doge.png

# reaction
meme render --template hide-the-pain-harold --text top="CI IS GREEN" --text bottom="AFTER FORCE-PUSHING" -o harold.png

# animated GIF
meme render --template mind-blown --text top="AGENTS MAKING MEMES" -o mind-blown.gif
```

List everything in the catalog:

```sh
meme templates list --json
```
