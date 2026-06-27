# 无极界 / G-LLM Client

当前版本：V1.0（1.0.0）

G-LLM 自有桌面客户端，从零开发。当前阶段聚焦“助手优先”的使用体验：用户打开客户端后先选择或创建适合场景的助手，再开始对话。

## 当前能力

- 桌面客户端：Electron + React + TypeScript
- 品牌入口：无极界 / G-LLM
- 内置助手：通用、文档、合同、代码、经营分析、学习导师
- 助手中心：新建助手、基于内置模板创建、编辑自定义助手、删除自定义助手
- 聊天体验：流式回复、开场问题、会话历史、本地保存
- 供应商配置：默认 G-LLM 网关，也可通过模板新增其他 OpenAI-compatible 供应商
- 模型管理：支持测试供应商连接、拉取 `/models`、从模型列表选择默认模型
- 网关适配：OpenAI-compatible Chat Completions streaming
- 设置项：当前供应商、API Base URL、API Key、默认模型、温度、最大词元、匿名使用统计

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

用户填写自己的 API Key 后即可请求真实网关。也可以从供应商模板新增 OpenAI-compatible、OpenAI、DeepSeek、本地兼容服务等配置，再切换为当前供应商。

供应商设置中的“拉取模型”会调用：

```http
GET {apiBaseUrl}/models
Authorization: Bearer {apiKey}
```

兼容标准 OpenAI `/models` 返回格式，也兼容简单字符串数组。

## License

G-LLM Desktop Client 社区版采用 [AGPL-3.0-only](./LICENSE) 许可证。

你可以在遵守 AGPL-3.0-only 的前提下使用、修改、分发和商用本项目。若你希望闭源分发、白标改造、嵌入商业产品、交付私有定制版，或免除 AGPL 的源码开放义务，需要取得单独的商业授权。

商业授权说明见 [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)。

源码许可证不自动授权使用 "G-LLM"、"WujiJie"、"无极界" 及相关 Logo、图标、宣传语或品牌资产。品牌和商标使用规则见 [TRADEMARKS.md](./TRADEMARKS.md)。
