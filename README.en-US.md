# WujiJie / G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

Current version: V1.0 (1.0.0)

G-LLM Client is a first-party desktop AI client built from scratch by GPROPHET LIMITED. The current product direction is assistant-first: users choose or create a role-based assistant, then start a focused multi-turn conversation.

## Features

- Desktop client built with Electron, React, and TypeScript
- WujiJie / G-LLM branded experience
- Built-in assistants for general chat, documents, contracts, code, business analysis, and learning
- Assistant center for creating, editing, and deleting custom assistants
- Streaming chat, starter prompts, conversation history, and local persistence
- Provider settings with the default G-LLM gateway and OpenAI-compatible provider templates
- Model management with connection tests, `/models` fetching, capability detection, and default model selection
- OpenAI-compatible Chat Completions streaming adapter
- Local data storage, lightweight local knowledge base, assistant memory, and data import/export
- Visible web search flow with search intent planning, search keywords, viewed source URLs, and answer generation

## Development

```bash
pnpm install
pnpm dev
```

Build:

```bash
pnpm build
```

Package for Windows:

```bash
pnpm package:win
```

Package for Apple Silicon macOS:

```bash
pnpm build
pnpm exec electron-builder --mac --arm64 --publish never
```

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
