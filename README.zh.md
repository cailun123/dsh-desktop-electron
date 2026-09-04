# dsh-desktop-electron

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web GUI 的 Electron 桌面外壳：启动 `dsh web`，等待服务端的就绪行，把 GUI 托管在独立窗口里，并常驻托盘。

本外壳面向公开发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 包。它仅依赖维护中的 `dsh web --host <host> --port <port> --no-open` 参数和 `dsh web: <URL>` 就绪行。

> 本仓库是独立维护的 DSH 桌面外壳项目，**不携带任何 harness 源码**；后端由主机上的 `dsh` 安装提供。

## 这是什么

Web GUI 是 harness 交互最丰富的界面，但平常只活在浏览器标签页里：没有任务栏存在感、没有托盘，每次启动都要开终端并且让标签页一直挂着。这个外壳把它变成一个真正的桌面窗口。

它**只是一个外壳**：不打包 Node 运行时，也不打包 harness 依赖闭包 —— 跑的是你机器上已有的那个 `dsh web`。因此 harness 升级后它依然正确，不会锁死在某个快照上。

| | |
|---|---|
| **启动动画** | 启动瞬间即现的动画窗口，画面上**只有一只呼吸的鲸鱼**：单色底面正中，4 秒一个呼吸周期（缩放 1 → 1.07 与明暗 0.72 → 1 同相起落）。没有字标、没有文字、没有进度条、没有状态行、没有转圈加载器、没有光环与渐变——启动要多久它就呼吸多久。整页只有底色与鲸鱼两种颜色，跟随系统与**主程序（dsh GUI）主题**（从 settings.yaml 读取）：日间纸白黑鲸、夜间石墨黑白鲸。GUI 在动画层背后预载，动画结束时正好是主界面 —— dsh 自己的转圈载入界面全程被盖住 |
| **窗口** | 沙箱化渲染进程（`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、无 preload）—— GUI 就是一个普通 Web 应用 |
| **托盘常驻** | 关闭窗口只是隐藏，服务端继续运行。托盘菜单对齐 Codex：**新话题**、正在运行的**话题**与最近**话题** —— 点一下直达那个会话（数据来自服务端自身的 session-list RPC；侧栏行点击为尽力而为）。菜单与悬停提示跟随 dsh 的 `locale.preference` 设置（中/英，未设置则跟随系统语言）。只有**退出**才终止服务端。托盘图标始终与其所在表面反色以增强可读性：深色任务栏/菜单栏用白色鲸鱼，浅色用黑色鲸鱼。Windows 上读取的是任务栏所跟随的**系统**模式（注册表 `SystemUsesLightTheme`），而非 `nativeTheme` 报告的应用模式，因此常见的"深色任务栏 + 浅色应用"设置下图标依然清晰可辨 |
| **单实例** | 二次启动聚焦已有窗口，而不是再起一个服务端 |
| **不留孤儿进程** | 退出时 tree-kill 服务端；即使主进程被硬杀（任务管理器、崩溃），reaper 子进程也会补上这次清理 |
| **平台** | Windows、macOS、Linux —— 纯 Node/npm 工具链，无需 Rust/Go/Swift |

启动画面的独立浏览器预览在 [preview/splash-preview.html](preview/splash-preview.html)：直接双击打开即可（无需启动应用、无网络依赖）查看呼吸 Logo 与就绪交接效果。

## 前置要求

一个可用的 `dsh web`，按以下顺序解析：

1. **`DSH_BIN`** —— 显式指定 `dsh` 可执行文件路径；
2. **`DSH_HOME`** —— harness checkout 根目录（用 `install.sh` 安装的话是 `~/.dsh/source/current`）。优先用其构建产物 `apps/cli/lib/bin.js`；没有则走 tsx 源码启动，与该 checkout 自己的 `pnpm run dsh` 完全一致；
3. **`PATH` 上的 `dsh`**。

在 Windows 上，spawn 边界会自动解析通过 `DSH_BIN` 或 `PATH` 找到的 npm 命令 shim，包括 `.cmd` 文件。参数始终保持独立向量：外壳不会启用通用命令 shell，也不要求用户自行定位 npm 包的 JavaScript 入口点。

服务端始终监听 `127.0.0.1`，端口由操作系统分配（`--port 0`），因此永远不会和已有的 `dsh web` 冲突。启动时带 `--no-open`，`dsh web` 不会自行打开浏览器标签页 —— 外壳窗口是唯一的 GUI，浏览器实例仍可与外壳同时开着。

## 从源码运行

```sh
npm install
DSH_HOME=~/.dsh/source/current npm run dev
```

## 打包

```sh
npm run dist        # 安装包输出到 release/
npm run dist:dir    # 只输出未打包目录，用于快速冒烟
```

安装包未签名，因此 Windows SmartScreen 和 macOS Gatekeeper 首次运行时会告警。打包后的应用仍然需要宿主机上有 `dsh` —— 见「前置要求」。

## 行为说明

- **Windows 权限模式**。Windows 没有 harness 的隔离后端，所以 CLI 默认的 `workspace-write` 模式在那里无法启动。当 `DSH_PERMISSION_MODE` 未设置时，外壳回退到 `danger-full-access`（审批提示被禁用）并打印警告。显式设置 `DSH_PERMISSION_MODE` 可覆盖。
- **进程树终止**。Windows 上用 `taskkill /T /F`，因为 `child.kill()` 只是对直接子进程做 `TerminateProcess`。POSIX 上服务端以 detached 方式启动，信号发给整个进程组：先 SIGTERM，宽限期后升级为 SIGKILL。服务端不走优雅 dispose 路径；会话数据按事件逐条写入 JSONL，所以被杀掉的服务端不会丢失任何已记录的内容。
- **外部链接**。任何打开新窗口或导航离开服务端 origin 的行为都转交系统浏览器，且限定 `http(s)`；无法解析的目标直接丢弃。
- **工作区语义**沿用 CLI 的：调用目录即默认项目根。从桌面快捷方式启动会以外壳的 cwd 为起点，因此建议从项目目录打开应用，或在 GUI 里选择 Workspace。
- **日志**。服务端 stdout 以 `[dsh web]` 前缀转发；从终端启动应用可同时看到两路输出。

## 测试

```sh
npm test        # 52 个无密钥用例：命令解析与 spawn、就绪行解析、HTTP 轮询、进程树终止
npm run test:electron:windows # 通过 Windows npm .cmd shim 验证构建后的 Electron 生命周期
npm run typecheck
npm run dist:dir # 解包应用及打包生产依赖闭包验证
```

## 来源

外壳、launcher 与 process-tree 原语是在一个 harness fork 中开发并已贡献回上游；本仓库是其独立抽取版本。相关的独立桌面外壳实现：[dsh-desktop](https://github.com/dsh-external/dsh-desktop)（Go/Wails，Windows）、[dsh-desktop-mac](https://github.com/dsh-external/dsh-desktop-mac)（Swift/WKWebView）、[deepseek-harness-desktop](https://github.com/omdsh-dev/deepseek-harness-desktop)（Wails + Node SEA）。

启动动画的"呼吸 Logo"手法参照 [OpenAI Codex](https://github.com/openai/codex)（Apache-2.0）的 CLI 呈现；启动层的视图管线最初以 [dsh-splash-launcher](https://github.com/Isilsolme/dsh-splash-launcher)（MIT）为模板。`whale.png` 黑鲸派生自 DeepSeek Harness 前端素材（MIT © 2026 DeepSeek），DeepSeek 名称与鲸鱼 Logo 为各自权利人的商标。

## 许可

[MIT](LICENSE)，与 harness 一致。
