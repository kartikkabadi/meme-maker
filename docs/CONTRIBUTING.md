# Contributing

```sh
npm install
npm run build   # tsc + vite (web UI)
npm test        # vitest
npm run lint    # eslint + prettier + ui typecheck
```

## Reporting security issues

Please do not open public issues for security vulnerabilities. See
[SECURITY.md](../SECURITY.md) for how to report them privately.

## Adding a template

1. Drop the media file under `assets/templates/images/` or `assets/templates/gifs/`.
   To avoid id conflicts when several contributors add templates in parallel, use a
   pack instead: `assets/templates/packs/<pack>/{images,gifs}/` with an optional
   `pack.json` (see `assets/templates/packs/README.md`). Pack template ids are
   prefixed with the pack id (`<pack>-<filename>`).
2. Add a `<id>.meta.json` sidecar next to it (name, tags, slots with rects and hints, provenance).
3. Run `npm run build:manifest` — it scans `assets/templates/**`, derives paths/dimensions, validates against the schema, and regenerates `assets/templates/manifest.json`. Never edit `manifest.json` by hand.
4. Run `npm run build:thumbs` to regenerate `assets/templates/thumbs/` and `docs/contact-sheet.webp`.
5. Record the source and license in `assets/templates/CREDITS.md`.
