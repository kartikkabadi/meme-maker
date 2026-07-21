# Releasing meme-maker

How a maintainer cuts a release. Distribution is via GitHub Releases and the
curl installer only — nothing is published to the npm registry
(see [INSTALL.md](./INSTALL.md)).

## 1. Bump versions

The version string lives in four places; keep them in sync:

| File | What to change |
| --- | --- |
| `package.json` | `"version"` field |
| `src/cli.ts` | `.version('X.Y.Z')` on the Commander program |
| `src/mcp.ts` | `version` in the `McpServer` constructor |
| `CHANGELOG.md` | Add a `## X.Y.Z` section at the top |

The CHANGELOG section heading must be exactly `## X.Y.Z` (no `v` prefix) —
the release workflow extracts everything under that heading as the GitHub
Release notes.

## 2. Verify locally

```sh
npm ci
npm run build
npm test
npm run lint
```

## 3. Merge, tag, and push

Land the version-bump PR on `main`, then tag the merge commit:

```sh
git checkout main && git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 4. What the Release workflow does

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. **build** (matrix): builds a self-contained platform tarball on each runner —
   `ubuntu-latest` → `linux-x64`, `macos-15-intel` → `macos-x64`,
   `macos-15` → `macos-arm64`. Each job runs build, lint, and tests, then
   packages `dist`, `assets`, and production `node_modules` (including sharp's
   platform-native libvips binaries).
2. **release**: builds a source tarball, extracts the `## X.Y.Z` section from
   `CHANGELOG.md` as release notes, and creates the GitHub Release.

Assets attached to the release:

- `meme-maker-linux-x64.tar.gz`
- `meme-maker-macos-x64.tar.gz`
- `meme-maker-macos-arm64.tar.gz`
- `agent-meme-maker-vX.Y.Z.tar.gz` (source)
- `install.sh`

## 5. Verify the install

Once the release is published:

```sh
curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
meme --version          # should print X.Y.Z
meme templates list | head
```

The installer should report installing from a pre-built tarball (not a source
build) on Linux x64 and both macOS architectures.

To test a tarball before tagging, build one locally:

```sh
sh scripts/package-release.sh
MEME_MAKER_TARBALL=$PWD/meme-maker-linux-x64.tar.gz sh install.sh
```
