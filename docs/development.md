# 开发与构建

## 环境

- macOS，已验证 Apple Silicon / macOS 14.6。
- Xcode Command Line Tools，提供 Swift 编译器与签名工具。
- Node.js 24+，使用标准库中的 SQLite。
- Codex 功能需要已安装、已登录的本机 Codex CLI。

## 构建

在仓库根目录运行：

```sh
ORDO_NODE="$(command -v node)" ORDO_OUTPUT="$PWD/dist/Ordo.app" bash build.sh
```

`ORDO_NODE` 指向要内置的 Node.js 可执行文件；省略时从 PATH 查找。`ORDO_OUTPUT` 指定应用输出位置；省略时生成在仓库的上一级目录。

构建使用当前机器架构，并嵌入 Node.js、前端资源和后端代码。脚本进行 ad-hoc 签名和严格签名校验。公开分发二进制时，需要自行配置 Developer ID 签名及公证。当前已验证 arm64；Node.js 24 的系统要求使该构建需要 macOS 13.5+。

## 项目结构

```text
native/                 Swift / AppKit / WKWebView 窗口、菜单、文件对话框
backend/desktop.mjs     桌面服务启动、会话和数据目录
backend/codex.mjs       Codex 进程、事件流与生命周期
backend/web/desktop/    Ordo 桌面界面
backend/core/           任务模型与 SQLite 存储
backend/test/           数据、API 与执行逻辑测试
backend/dev/            界面测试和演示数据
```

`backend/README.md` 保留上游 Web 项目的说明。Ordo 的桌面入口是原生启动器，不是直接运行上游 Web 服务。

## Codex 集成

通过官方非交互执行接口运行本机 Codex，以标准输入传入任务，解析 JSON 事件流，使用 `workspace-write` 权限。每次调用启用 `respect_system_proxy`，遵循 macOS 系统代理/PAC；不会修改全局 Codex 配置。启动器保留显式传入的代理、自定义 CA 与 CODEX_HOME 环境设置。

任务成功返回后进入等待验收；停止、进程失败、连接重试超时或应用退出都不会自动勾选任务。当前限制一个活动执行，执行记录有长度及数量限制。需要额外交互授权的步骤可能无法在非交互模式完成。

参考：[非交互执行](https://learn.chatgpt.com/docs/non-interactive-mode)、[系统代理配置](https://learn.chatgpt.com/docs/enterprise/managed-configuration#use-the-system-proxy-for-native-client-requests)。

## 验证

```sh
cd backend
node --test test/*.test.mjs
node dev/test-desktop.mjs
node dev/test-desktop-performance.mjs
node dev/test-codex-ui.mjs
```

界面测试需要 Google Chrome，默认读取 macOS 标准安装路径，也可用 `CHROME` 指定可执行文件。浏览器测试使用独立临时数据与浏览器配置；Codex UI 测试使用可控模拟进程。真实 Codex 执行另行验证，需要本机登录和网络。

原生冒烟测试位于 `native/smoke.js`，可通过构建后应用二进制的 `--smoke-test --data-dir <临时目录>` 参数运行。始终指定独立测试目录。已完成的验证见 [VALIDATION.md](../VALIDATION.md)。

## 第三方许可

- 原项目：[`backend/LICENSE`](../backend/LICENSE)。
- Preact / htm：[`backend/web/vendor/`](../backend/web/vendor/)。
- 字体：[`backend/web/fonts/`](../backend/web/fonts/)。
- Node.js 及组件：[`native/NODE-LICENSE`](../native/NODE-LICENSE)，构建后同时置于应用的 `Contents/Resources/runtime/LICENSE`。更换内置 Node.js 版本时应同步核对许可文件。
