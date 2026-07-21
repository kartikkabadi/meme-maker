# Curl Installer Cross-OS CI Test

Workflow: `.github/workflows/install-test.yml` (branch `devin/install-test-windows`)
Run: https://github.com/kartikkabadi/meme-maker/actions/runs/29832238989
Date: 2026-07-21

Command tested (from README):

```sh
PREFIX=$RUNNER_TEMP/meme-test curl -fsSL https://raw.githubusercontent.com/kartikkabadi/meme-maker/main/install.sh | sh
```

Then `meme --version`, `meme templates list | wc -l`, and
`meme render --template drake --text no="MANUAL" --text yes="AGENT" -o meme.png`.

## Results

| OS | Result | Notes |
|----|--------|-------|
| ubuntu-latest | PASS (14s) | Installed v0.3.1 from pre-built tarball (linux-x64). `meme --version` → 0.3.1, 609 template lines, drake render + artifact OK |
| macos-latest | PASS (26s) | Same flow, render + artifact OK |
| windows-latest | FAIL | Installer explicitly rejects native Windows |

## Windows failure detail

The install step runs under Git Bash (`C:\Program Files\Git\bin\bash.EXE`), where
`uname -s` reports `MINGW64_NT-...`. `install.sh` intentionally exits:

```
error: native Windows is not supported; please install inside WSL (https://learn.microsoft.com/windows/wsl/)
```

So Windows fails by design (explicit rejection in the platform-detection case
for `MINGW*|MSYS*|CYGWIN*`), not due to a downstream error. Native Windows
support would require either lifting the guard and shipping a `win32-x64`
release tarball (plus wrapper `.cmd` shims instead of symlinked shell
wrappers), or documenting WSL as the only supported path.

## Artifacts

Rendered `meme.png` uploaded for ubuntu-latest and macos-latest
(`meme-ubuntu-latest`, `meme-macos-latest`). No Windows artifact (install
never completed).
