# WujiJie / G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

Current version: V1.0.6

G-LLM Client is a cross-platform desktop AI client built by GPROPHET LIMITED for Windows, macOS, and Linux. The product direction is assistant-first: users choose or create a role-based assistant, then use one desktop client for model configuration, knowledge references, screenshots, file understanding, and multi-turn conversations.

## Features

- Cross-platform desktop client built with Electron, React, and TypeScript, with Windows, macOS, and Linux packaging.
- Assistant workflow with built-in assistants for general chat, documents, contracts, code, business analysis, and learning, plus custom assistant creation and editing.
- Multi-provider and multi-model setup with the default G-LLM gateway and OpenAI-compatible provider templates.
- Model management with connection tests, `/models` fetching, capability detection, and default model selection.
- Streaming chat, starter prompts, Markdown rendering, conversation history, local persistence, and token display.
- Local-first features including lightweight knowledge base, assistant memory, local data storage, and data import/export.
- Attachments and visual inputs including files, images, pasted clipboard content, system screenshots, and image copy to the system clipboard.
- Web search and tool configuration so retrieved source material can be injected into the conversation context.
- Privacy-friendly anonymous telemetry. The client only sends anonymous metadata and does not collect chat content, API keys, file content, screenshot content, knowledge base content, or memory content. Users can disable telemetry in settings.

## Windows Desktop Behavior

V1.0.6 includes Windows-specific desktop refinements:

- Closing the main window hides the app to the system tray instead of quitting.
- Minimizing the main window shows a floating G-LLM logo on the desktop.
- The floating logo can be dragged and snaps to the screen edge.
- The floating logo and tray icon share the same right-click menu: open quick chat, open main window, show/hide floating logo, and quit G-LLM.
- The quick chat window is transparent, frameless, always-on-top, and designed for fast access.
- The screenshot button hides the current app window before entering the Windows screenshot flow.
- Single-instance protection is enabled. Launching the shortcut again brings the existing app to the front instead of starting another process.
- Main-process logs are written to `%APPDATA%/G-LLM/logs/main.log` for startup and crash diagnostics.

> Note: public Windows builds without a code-signing certificate may still be warned or blocked by Smart App Control or antivirus software. Trusted signing and Microsoft Store/MSIX distribution are handled as a separate release-compliance track.

## Development

```bash
pnpm install
pnpm dev
```

Build:

```bash
pnpm build
pnpm package:win
pnpm package:mac
pnpm package:linux
```

Build artifacts are written to `dist/`. GitHub Actions builds Windows, macOS, and Linux artifacts on their corresponding runners.

## API Contract

The client calls an OpenAI-compatible streaming Chat Completions endpoint:

```http
POST {apiBaseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

Example request body:

```json
{
  "model": "g-llm-chat",
  "messages": [],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true
}
```

The default provider is G-LLM:

```text
https://llm.gprophet.com/v1
```

Users provide their own API key on first use. Additional OpenAI-compatible providers can also be configured from templates.

Model fetching uses:

```http
GET {apiBaseUrl}/models
Authorization: Bearer {apiKey}
```

The client supports standard OpenAI `/models` responses and simple string-array model lists.

## Release QA

Before shipping, use [docs/release-qa-checklist.md](./docs/release-qa-checklist.md) to verify the Windows tray, floating logo, screenshot flow, single-instance behavior, logs, and basic macOS/Linux packaging.

## License

G-LLM Desktop Client is published by GPROPHET LIMITED. The community edition is licensed under [AGPL-3.0-only](./LICENSE).

You may use, modify, distribute, and commercially use this project as long as you comply with AGPL-3.0-only. If you want closed-source redistribution, white-label customization, embedding into a proprietary product, private customer delivery, or exemption from AGPL source disclosure obligations, you need a separate commercial license.

See [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) for commercial licensing terms.

For commercial licensing, OEM cooperation, enterprise deployment, or white-label authorization, contact:

```text
GPROPHET LIMITED
Email: licensing@gprophet.com
Website: https://llm.gprophet.com/
```

The source code license does not grant rights to use "G-LLM", "WujiJie", "无极界", related logos, icons, slogans, or brand assets. See [TRADEMARKS.md](./TRADEMARKS.md) for trademark and brand usage rules.
