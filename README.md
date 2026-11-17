# Smithgentic Browser

A Chrome/Edge AI browser agent with a side panel. Use your own API key and model provider.

It reads and controls the page with DOM refs, open Shadow DOM, same-origin iframes, screenshots, local OCR, and real coordinate input for canvas and visual-only UIs.

## Install

1. Clone the repo.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension` folder.
5. Click the toolbar icon or press `Ctrl+E` / `Cmd+E`.
6. Open **Settings → Providers** and add your API key and model.

Requires Chrome or Edge 116+.

## Providers

OpenRouter, OpenAI, Azure OpenAI, Anthropic, Google Gemini, Groq, Venice AI, Ollama, LM Studio, and any OpenAI-compatible endpoint.

Keys are stored in `chrome.storage.local` and sent only to the provider you configure.

## Local agents

In Settings, enable **Let local agents use this browser**, then install the native bridge:

```bash
node extension/native/install.mjs <extension-id>
```

The installer prints the MCP command to add to Claude Code, Codex, Cursor, or another local agent.

## Development

```bash
npm install
npm run build
```

The extension itself loads without a build. The build compiles the optional backend library and regenerates the packaged OCR assets.

## Layout

```text
extension/   Loadable Chrome/Edge extension
src/         Optional standalone browser-control / vision library
scripts/     OCR asset build
```
