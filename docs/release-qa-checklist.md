# G-LLM Release QA Checklist

本清单用于每次发布前做人工验收，重点覆盖用户最容易感知的问题：安装、启动、托盘、悬浮窗、截图、复制、单进程和三端基础可用性。

## 构建检查

- 确认 `package.json` 版本号与发布版本一致。
- 执行 `pnpm build`，确保 TypeScript 和前端构建通过。
- Windows 执行 `pnpm package:win`，确认生成 `dist/G-LLM-Setup-<version>-x64.exe`。
- macOS 执行 `pnpm package:mac`，确认生成 macOS 产物。
- Linux 执行 `pnpm package:linux`，确认生成 AppImage 和 deb 产物。
- 发布前记录 Windows 安装包 SHA256，便于排查不同机器下载到的是否是同一个文件。

## Windows 验收

- 首次安装后可以正常启动，主窗口出现在任务栏。
- 再次双击桌面快捷方式不会创建第二个进程，只会唤起已有窗口。
- 点击主窗口关闭按钮后应用不退出，进入系统托盘。
- 从托盘右键菜单可以打开快速对话、打开主窗口、显示/隐藏悬浮窗、退出 G-LLM。
- 最小化主窗口后桌面显示悬浮 G-LLM logo。
- 悬浮 logo 背景透明，不出现方形底色或残留阴影。
- 悬浮 logo 可以拖动，松开后吸附到屏幕边缘。
- 悬浮 logo 右键菜单与托盘右键菜单功能一致。
- 快速对话窗口透明无边框、置顶，不显示设置齿轮。
- 点击截图按钮时当前 G-LLM 窗口先隐藏，然后进入 Windows 截图。
- 截图完成后图片进入待发送附件。
- 截图或图片附件右键可以复制图片，并能粘贴到微信、浏览器输入框或其他程序。
- 自己发送过的历史消息可以选择、复制和引用。
- 固定任务栏后再次启动可以复用已有进程，不闪退。
- 如果用户反馈闪退，先收集 `%APPDATA%/G-LLM/logs/main.log`。

## macOS 验收

- 应用可以启动主窗口。
- 基础聊天、供应商设置、模型拉取可用。
- 文件/图片附件可添加。
- 关闭窗口、Dock 图标和菜单栏行为符合 macOS 常规习惯。
- 未配置 Apple Developer 签名和公证时，记录 Gatekeeper 提示，不把它误判为代码功能问题。

## Linux 验收

- AppImage 可以启动。
- deb 安装后可以从应用菜单启动。
- 基础聊天、供应商设置、模型拉取可用。
- 文件/图片附件可添加。
- 桌面图标和应用名称显示为 G-LLM。

## 分发状态记录

- Windows 未签名构建：可能被 Smart App Control 或杀毒软件拦截。
- Windows 签名构建：需要记录证书主体、签名时间戳、安装包 SHA256。
- Microsoft Store/MSIX：账号、包名、发布状态单独记录。
- macOS 正式发布：需要 Apple Developer ID 签名和 notarization。
- Linux 正式发布：至少保留 AppImage 和 deb 两种产物，后续可补 apt 仓库。
