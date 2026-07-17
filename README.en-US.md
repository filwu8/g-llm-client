# WujiJie / G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

Current code version: [V1.2.1](https://github.com/filwu8/g-llm-client/tree/main)

Latest stable release: [V1.2.1](https://github.com/filwu8/g-llm-client/releases/tag/v1.2.1), released on 2026-07-16.

> Starting with V1.1.0, the source is licensed under BUSL-1.1 for free personal and internal business use; the current V1.2.1 release will automatically change to AGPL-3.0-only on 2030-07-14. V1.0.10 and earlier remain under the AGPL-3.0-only license included in their release tags.

[Download](https://llm.gprophet.com/download) | [Full changelog](https://llm.gprophet.com/download/changelog) | [GitHub Releases](https://github.com/filwu8/g-llm-client/releases)

G-LLM Client is a cross-platform desktop AI client built by GPROPHET LIMITED for Windows, macOS, and Linux. The product direction is assistant-first: users choose or create a role-based assistant, then use one desktop client for model configuration, knowledge references, screenshots, file understanding, and multi-turn conversations.

## Interface Preview

The workspace agent can read and modify files inside a user-authorized directory while showing its actions in the conversation. Eligible paid G-LLM users can also enable the exclusive gold theme.

![Business-plan assistant and workspace agent in the gold theme](./docs/images/gllm-gold-workspace.png)

Local file tools can generate, modify, and compress files in a conversation. Light and dark themes are available to every user.

| Dark theme | Light theme |
| --- | --- |
| ![PDF compression task in the dark theme](./docs/images/gllm-dark-file-tools.png) | ![PDF compression task in the light theme](./docs/images/gllm-light-file-tools.png) |

## V1.2.1 Highlights

- Complete Chinese and English UI: the main window, Quick Chat, tray/menu bar, settings, file tasks, native file dialogs, and errors can follow the system language or a manual selection.
- Consistent themes and windows: the default theme follows the system light/dark mode and can be overridden manually. The Windows title bar follows the app theme, with a dedicated black-and-gold treatment for Gold mode.
- Polished dialogs: modal backdrops use a frosted-glass blur with fade, scale, lift, or slide transitions, and the custom title bar stays behind open dialogs.
- More flexible assistant management: assistants can be reordered by dragging and pinned from the context menu, with per-space persistence. Built-in and custom assistants also share the same hide and delete behavior.
- Recoverable hidden assistants: a dedicated manager restores or permanently deletes hidden assistants, which are excluded from assistant and conversation-history search while hidden.
- Stronger web retrieval: Bing Search RSS and Google News RSS are combined, while improved entity and topic extraction handles long Chinese prompts without incorrectly reporting zero sources.
- Unified time and usage details: both the main window and Quick Chat show the full date, time zone, and total/input/output token counts. The time zone can follow the device or be selected manually from the IANA list.
- Consistent desktop entry points: a single click on the Windows tray icon, macOS menu-bar icon, or desktop pet opens Quick Chat, while the context menu retains Open Main Window and other actions.
- Safer localization releases: automated translation completeness checks keep Chinese and English menus, buttons, and messages aligned as features evolve.

## Features

- Cross-platform desktop client built with Electron, React, and TypeScript, with Windows, macOS, and Linux packaging.
- Assistant workflow with built-in assistants for general chat, documents, contracts, code, business analysis, and learning, plus creation, editing, drag reordering, pinning, hiding, restoring, and deletion.
- Chinese and English UI with system-language detection or manual selection across the main window, Quick Chat, and native menus.
- Multi-provider and multi-model setup with the default G-LLM gateway and OpenAI-compatible provider templates.
- Model management with connection tests, `/models` fetching, capability detection, and default model selection.
- Unified model selection across chat, global defaults, assistant settings, and quick chat, with capability labels and natural name sorting.
- Streaming chat, starter prompts, Markdown rendering, conversation history, and local persistence, with full dates, selected time zones, and total/input/output token details shared by the main window and Quick Chat.
- Intelligent conversation search across spaces using topics, people, tasks, or conclusions, with direct navigation back to the original conversation.
- Local-first features including lightweight knowledge base, assistant memory, persistent project memory, local data storage, and data import/export.
- Attachments and visual inputs including files, images, pasted clipboard content, system screenshots, and image copy to the system clipboard.
- Local file tasks that compress images or PDFs to a requested byte limit with approval, PDF rasterization warnings, non-destructive output, and per-file verification.
- Conversation workspaces that grant a single conversation controlled access to inspect, search, create, and modify files with a visible tool activity timeline.
- Web retrieval through Bing Search RSS and Google News RSS, with Chinese query planning and source deduplication before material is injected into the conversation context.
- Automatic system light/dark theming with manual overrides, plus a gold theme unlocked by a valid official G-LLM API key.
- Frosted-glass modal backdrops and progressive entry animations, with reduced-motion preference support.
- Privacy-friendly anonymous telemetry. The client only sends anonymous metadata and does not collect chat content, API keys, file content, screenshot content, knowledge base content, or memory content. Users can disable telemetry in settings.

## Desktop Resident Behavior

The client includes the following resident desktop behavior:

- A single click on the Windows tray icon, macOS menu-bar icon, or desktop pet opens Quick Chat; the context menu provides Open Main Window and the full set of actions.
- On Windows, closing the main window hides the app to the system tray instead of quitting.
- Minimizing the main window shows a floating G-LLM logo on the desktop.
- The floating logo can be dragged and snaps to the screen edge.
- The floating logo and tray/menu-bar icon share the same right-click menu: open Quick Chat, open the main window, show/hide the floating logo, and quit G-LLM.
- The quick chat window is transparent, frameless, always-on-top, and designed for fast access.
- Quick Chat and the main window share message actions, full timestamps, time zones, and token usage details.
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

G-LLM Desktop Client is published by GPROPHET LIMITED. The current V1.2.1 development version is licensed under the [Business Source License 1.1](./LICENSE) with an Additional Use Grant.

Personal use, research, evaluation, and internal business operations are free. Without a written commercial license from GPROPHET LIMITED, you may not white-label or OEM the client, resell or rent it, release or distribute it as a competing product, or provide it to third parties as a hosted, managed, outsourcing, service-bureau, or application service.

V1.2.1 automatically changes to AGPL-3.0-only on 2030-07-14. V1.0.10 and earlier are unaffected and remain under the license included in each release tag.

See [LICENSE](./LICENSE) and [LICENSE_POLICY.md](./LICENSE_POLICY.md) for the controlling scope, [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) for commercial licensing, and [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing code.

For commercial licensing, OEM cooperation, enterprise deployment, or white-label authorization, contact:

```text
GPROPHET LIMITED
Email: licensing@gprophet.com
Website: https://llm.gprophet.com/
```

The source license does not grant rights to use "G-LLM", "WujiJie", "无极界", related logos, icons, slogans, or brand assets. See [TRADEMARKS.md](./TRADEMARKS.md) for brand rules and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party licenses.
