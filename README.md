# GatoLang LSP (VS Code)

Minimal VS Code extension + language server that runs `gatoc --check --json-diags` for diagnostics.

## Prerequisites

- Build/install `gatoc` from `/home/gatoware/GatoLang/GatoLang/src/gatolang`.
- Ensure `gatoc` is on your `PATH`, or set `GATOC_PATH` to the full path.

## Install dependencies

From the repo root:

```
npm install
```

From the server folder:

```
cd server
npm install
```

## Build

From the repo root:

```
npm run build
```

From the server folder:

```
cd server
npm run build
```

## Run in VS Code

- Open this repo in VS Code.
- Press `F5` to run the extension (uses `.vscode/launch.json`).
- In the Extension Development Host, open `test-workspace/` and edit `good.gw` / `bad.gw`.

## Troubleshooting

- If the server cannot find `gatoc`, set `GATOC_PATH` to the full executable path.
- Diagnostics are debounced on change (~300ms) and run immediately on save.
