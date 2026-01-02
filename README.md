# GatoLang LSP

A minimal VS Code extension that provides real-time diagnostics for GatoLang files using the `gatoc` language server.

## Features

- Real-time linting and error detection
- JSON-formatted diagnostics via `gatoc --check`
- Debounced diagnostics on file change with immediate validation on save

## Requirements

- `gatoc` installed and available on your `PATH`, or set the `GATOC_PATH` environment variable to the full executable path

3. Open the repo in VS Code and press `F5` to run the extension in the Extension Development Host

## Usage

Open a `.gw` file to see diagnostics in the editor. Errors appear as you type.

## Troubleshooting

- If the server cannot find `gatoc` or if your `gatoc` is not on your PATH, set the `GATOC_PATH` environment variable to the full executable path.
- Please report any other bugs you find on GitHub. (https://github.com/Gatoware-6310/GatoLangLSP)