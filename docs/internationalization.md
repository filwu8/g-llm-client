# G-LLM Internationalization Guide

G-LLM separates product UI language from user data and model content. A language change must update the application chrome without rewriting conversations, custom assistants, notes, memories, provider names, paths, or imported files.

## Supported Languages

- `system`: follows the operating system. Chinese locales resolve to `zh-CN`; other locales currently resolve to `en-US`.
- `zh-CN`: Simplified Chinese.
- `en-US`: English.

The persisted preference is `AppSettings.language`. Renderer and main-process i18n instances resolve the same preference independently because Electron processes do not share runtime state.

## String Ownership

Use `src/shared/locales/<locale>.json` for buttons, labels, notices, validation messages, native menus, dialogs, and main-process results that users can see.

Use `src/shared/locales/assistant-presets/<locale>.json` for localized metadata of the built-in preset catalog. Preset IDs and business behavior remain in `src/shared/assistantPresets.ts`.

Keep user-created and persisted content unchanged. Never translate conversation messages, custom assistant fields, knowledge notes, memories, provider names, file names, or paths as a side effect of changing the interface language.

Model-facing prompts may remain in a single source language when that avoids duplicating safety or agent logic, but they must explicitly instruct the model to answer in the user's current language. Text returned directly to the UI must use the locale dictionaries.

## Adding UI Text

1. Add the same key to `zh-CN.json` and `en-US.json`.
2. Use `useTranslation()` and `t('namespace.key')` in React components.
3. Use `mainT(key, language)` in the Electron main process.
4. Interpolate variables with named placeholders. Do not build translated sentences by concatenating fragments.
5. Format dates and numbers with `Intl` or `toLocaleString(i18n.resolvedLanguage)`.
6. Run `pnpm i18n:check` and `pnpm exec tsc --noEmit`.

## Adding A Language

1. Add the locale code to `appLanguages` and update `resolveAppLocale` in `src/shared/i18n.ts`.
2. Add a complete `src/shared/locales/<locale>.json` and register it in both `src/renderer/src/i18n.ts` and `src/main/i18n.ts`.
3. Add the language option in the personalization settings UI.
4. Add `src/shared/locales/assistant-presets/<locale>.json` and register it in `localizedContent.ts`.
5. Add both files to `scripts/check-translations.mjs`.
6. Verify the main window, quick chat, native tray menu, dialogs, settings, assistant presets, errors, dates, numbers, and long-text layout.

## Platform Rules

Platform-specific behavior may be isolated, such as macOS traffic-light spacing, Windows tray lifecycle, installer language selection, and OS-native file-picker behavior. Shared product UI, assistant catalogs, model selection, chat controls, and settings must use the same localized source across macOS, Windows, and Linux.

Do not fork a component merely to change text for one operating system. Use a platform condition only when the operating system behavior or layout contract is genuinely different.

## Validation

`pnpm i18n:check` fails when:

- locale dictionaries have missing or extra keys;
- a built-in assistant preset has no localized metadata;
- localized preset metadata is missing a name, title, or description.

The production build runs this check automatically before TypeScript and Electron Vite compilation.
