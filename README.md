# 无极界 / G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

当前版本：V1.0.7

G-LLM Client 是 GPROPHET LIMITED 自研的跨平台桌面 AI 客户端，支持 Windows、macOS 和 Linux。当前产品方向是“助手优先”：用户先选择或创建适合场景的助手，再在同一个桌面客户端里完成模型配置、知识引用、截图提问、文件理解和多轮对话。

## 当前能力

- 跨平台桌面客户端：Electron + React + TypeScript，支持 Windows、macOS、Linux 打包。
- 助手工作流：内置通用、文档、合同、代码、经营分析、学习导师等助手，支持新建、编辑和删除自定义助手。
- 多供应商与多模型：默认 G-LLM 网关，也支持 OpenAI-compatible、OpenAI、DeepSeek、本地兼容服务等供应商模板。
- 模型管理：支持测试供应商连接、拉取 `/models`、能力识别和默认模型选择。
- 聊天体验：流式回复、开场问题、Markdown 渲染、会话历史、本地保存和 Token 展示。
- 本地能力：轻量知识库、助手长期记忆、本地数据存储、数据导入导出。
- 附件与视觉输入：支持文件、图片、剪贴板粘贴、系统截图，并可将截图复制到系统剪贴板。
- 联网与工具：支持联网搜索流程和工具配置，让搜索资料进入提问上下文。
- 隐私友好的匿名统计：默认只上报匿名元数据，不采集聊天内容、API Key、文件内容、截图内容、知识库内容或记忆内容，用户可在设置中关闭。

## Windows 桌面体验

V1.0.7 已针对 Windows 做了桌面常驻优化：

- 点击关闭按钮不会退出应用，而是隐藏到系统托盘。
- 最小化主窗口后显示桌面悬浮 G-LLM logo。
- 悬浮 logo 支持拖动，并会吸附到屏幕边缘。
- 悬浮 logo 右键菜单与托盘右键菜单复用同一套功能：打开快速对话、打开主窗口、显示/隐藏悬浮窗、退出 G-LLM。
- 快速对话窗口为透明无边框、置顶小窗，适合随时唤起。
- 截图按钮会先隐藏当前界面，再进入 Windows 截图流程。
- 应用启用单进程保护；重复双击快捷方式会唤起已有窗口，不再启动多个进程。
- 主进程日志写入 `%APPDATA%/G-LLM/logs/main.log`，便于定位用户机器上的闪退或启动问题。

> 说明：当前公开构建如果未配置 Windows 代码签名证书，可能被 Smart App Control 或杀毒软件提示风险。可信签名、Microsoft Store/MSIX 分发属于发布合规工作，正在单独推进。

## Development

```bash
pnpm install
pnpm dev
```

如果本机没有全局 Node.js，可以使用 Codex 工作区自带运行时：

```powershell
$env:Path='C:\Users\filwu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;C:\Users\filwu\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin;' + $env:Path
pnpm dev
```

## Build

```bash
pnpm build
pnpm package:win
pnpm package:mac
pnpm package:linux
```

构建产物输出到 `dist/`。GitHub Actions 会分别在 Windows、macOS、Linux runner 上构建对应平台产物。

## API Contract

当前客户端按 OpenAI Chat Completions 流式协议调用：

```http
POST {apiBaseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

请求体包含：

```json
{
  "model": "g-llm-chat",
  "messages": [],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true
}
```

首次使用会打开供应商设置。默认供应商为 G-LLM：

```text
https://llm.gprophet.com/v1
```

用户填写自己的 API Key 后即可请求真实网关。也可以从供应商模板新增其他 OpenAI-compatible 配置，再切换为当前供应商。

供应商设置中的“拉取模型”会调用：

```http
GET {apiBaseUrl}/models
Authorization: Bearer {apiKey}
```

兼容标准 OpenAI `/models` 返回格式，也兼容简单字符串数组。

## Release QA

发布前请参考 [docs/release-qa-checklist.md](./docs/release-qa-checklist.md) 完成三端基础验证，尤其是 Windows 托盘、悬浮 logo、截图、单进程保护和启动日志。

## License

G-LLM Desktop Client 由 GPROPHET LIMITED 发布，社区版采用 [AGPL-3.0-only](./LICENSE) 许可证。

你可以在遵守 AGPL-3.0-only 的前提下使用、修改、分发和商用本项目。若你希望闭源分发、白标改造、嵌入商业产品、交付私有定制版，或免除 AGPL 的源码开放义务，需要取得单独的商业授权。

商业授权说明见 [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)。

商业授权、OEM 合作、企业部署、白标授权请联系：

```text
GPROPHET LIMITED
Email: licensing@gprophet.com
Website: https://llm.gprophet.com/
```

源码许可证不自动授权使用 "G-LLM"、"WujiJie"、"无极界" 及相关 Logo、图标、宣传语或品牌资产。品牌和商标使用规则见 [TRADEMARKS.md](./TRADEMARKS.md)。
