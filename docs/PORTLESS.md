# Stable local URLs with portless

[portless](https://portless.sh) gives `meme ui` a stable, named URL — `https://meme.localhost` — instead of `http://localhost:<random port>`. It is an optional convenience layer; nothing in meme-maker requires it.

## Run

From the repo root (after `npm run build`):

```sh
npx portless          # -> https://meme.localhost
```

Or with a global install (`npm install -g portless`):

```sh
portless
```

Equivalent npm script:

```sh
npm run ui:portless   # portless --script ui
```

`portless.json` at the repo root sets the app name (`meme`) and the script to run (`ui`, which starts `meme ui`). On first run, portless generates and trusts a local CA and binds port 443 (it may prompt for sudo on macOS/Linux). Use `portless --no-tls` for plain `http://meme.localhost`.

## How it works

portless assigns a free port via the `PORT` environment variable and proxies `https://meme.localhost` to it. `meme ui` honors `PORT` when `--port` is not given, and when `PORTLESS_URL` is set it prints that stable URL in its output (both the machine-readable first stdout line and the human-readable stderr line).

## Without portless

Nothing changes:

```sh
meme ui              # auto-picks a free port, prints http://127.0.0.1:<port>
meme ui --port 8787  # pin a port
```

If portless is not installed, `npx portless` will offer to fetch it; `npm run ui:portless` fails with a "portless: not found" style error — just fall back to `meme ui`.
