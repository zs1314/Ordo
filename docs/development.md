# 开发与构建

## 环境

- macOS，已验证 Apple Silicon / macOS 14.6。
- Xcode Command Line Tools，提供 Swift 编译器与签名工具。
- Node.js 24+，使用标准库中的 SQLite。

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
backend/web/desktop/    Ordo 桌面界面与四状态卡片
backend/core/           任务模型与 SQLite 存储
backend/test/           数据、API 与存储测试
backend/dev/            界面测试与演示截图生成
```

桌面界面使用 Preact / htm 原生 ES 模块，无前端打包步骤。`backend/README.md` 介绍独立的数据服务、API 与 Web 开发模式；Ordo 桌面应用通过原生启动器运行。

## 手动 Agent 分类

2.2 的 Agent 分类只维护任务状态和交接信息。原生启动器设置 `TODO_CODEX_DISABLED=1`，服务不创建 Codex 执行器，相关桌面 API 返回 404；前端没有执行入口、状态轮询或登录检测。

旧版本的执行模块与单元测试保留在源码中，已有执行历史和工作目录也保留。它们不参与当前桌面工作流程。

## 验证

```sh
cd backend
node --test test/*.test.mjs
node dev/test-desktop.mjs
node dev/test-focus-ui.mjs
node dev/test-status-board.mjs
node dev/test-desktop-performance.mjs
```

界面测试需要 Google Chrome，默认读取 macOS 标准安装路径，也可用 `CHROME` 指定可执行文件。测试通过 CLI 启动无头浏览器，使用独立临时数据与浏览器配置。

原生冒烟测试位于 `native/smoke.js`，通过构建后应用二进制的 `--smoke-test --data-dir <临时目录>` 参数运行。始终指定独立测试目录；在同一目录再次运行会检查重启后的持久化。已完成的验证见 [VALIDATION.md](../VALIDATION.md)。

从仓库根目录生成演示截图：

```sh
node backend/dev/snapshot-desktop.mjs docs/images
```

该脚本只使用合成任务，不读取个人待办。

## 第三方许可

- 后端组件：[`backend/LICENSE`](../backend/LICENSE)。
- Preact / htm：[`backend/web/vendor/`](../backend/web/vendor/)。
- 字体：[`backend/web/fonts/`](../backend/web/fonts/)。
- Node.js 及组件：[`native/NODE-LICENSE`](../native/NODE-LICENSE)，构建后同时置于应用的 `Contents/Resources/runtime/LICENSE`。更换内置 Node.js 版本时应同步核对许可文件。
