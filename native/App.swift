import AppKit
@preconcurrency import WebKit
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var input: Pipe?
    var output: Pipe?
    var logHandle: FileHandle?
    var baseURL: URL?
    var token = UUID().uuidString + UUID().uuidString
    var buffer = ""
    var stopping = false
    var started = false
    var failed = false
    var timeout: Timer?
    let smoke = CommandLine.arguments.contains("--smoke-test")
    var smokeStarted = false
    var dataDirectory: URL {
        if smoke, let i = CommandLine.arguments.firstIndex(of: "--data-dir"), CommandLine.arguments.count > i + 1 {
            return URL(fileURLWithPath: CommandLine.arguments[i + 1], isDirectory: true)
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Ordo", isDirectory: true)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        makeMenus()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "desktop")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Ordo"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 820, height: 580)
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.setFrameAutosaveName("OrdoMainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString("""
        <html><meta charset="utf-8"><style>html{color-scheme:light dark}body{font:15px -apple-system;display:grid;place-content:center;height:90vh;text-align:center}h1{font-size:36px;letter-spacing:6px}p{opacity:.5}</style><h1>Ordo</h1><p>正在打开你的待办…</p></html>
        """, baseURL: nil)
        startServer()
    }

    func makeMenus() {
        let bar = NSMenu()
        NSApp.mainMenu = bar
        func submenu(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title); item.submenu = menu; bar.addItem(item); return menu
        }
        func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "", _ target: AnyObject? = nil) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.target = target; menu.addItem(item)
        }
        let app = submenu("Ordo")
        add(app, "关于Ordo", #selector(about), "", self)
        app.addItem(.separator())
        add(app, "设置…", #selector(settings), ",", self)
        app.addItem(.separator())
        add(app, "隐藏Ordo", #selector(NSApplication.hide(_:)), "h", NSApp)
        add(app, "显示全部", #selector(NSApplication.unhideAllApplications(_:)), "", NSApp)
        app.addItem(.separator())
        add(app, "退出Ordo", #selector(NSApplication.terminate(_:)), "q", NSApp)
        let file = submenu("文件")
        add(file, "新建待办", #selector(newItem), "n", self)
        file.addItem(.separator())
        add(file, "导出待办 JSON…", #selector(exportJSON), "", self)
        add(file, "备份全部数据…", #selector(backup), "", self)
        add(file, "打开数据文件夹", #selector(showData), "", self)
        file.addItem(.separator())
        add(file, "关闭窗口", #selector(NSWindow.performClose(_:)), "w")
        let edit = submenu("编辑")
        add(edit, "撤销输入", Selector(("undo:")), "z")
        add(edit, "重做输入", Selector(("redo:")), "Z")
        edit.addItem(.separator())
        add(edit, "剪切", #selector(NSText.cut(_:)), "x")
        add(edit, "拷贝", #selector(NSText.copy(_:)), "c")
        add(edit, "粘贴", #selector(NSText.paste(_:)), "v")
        add(edit, "全选", #selector(NSText.selectAll(_:)), "a")
        edit.addItem(.separator())
        add(edit, "搜索任务", #selector(searchTasks), "f", self)
        add(edit, "快速查找", #selector(searchTasks), "k", self)
        let view = submenu("显示")
        add(view, "刷新看板", #selector(reload), "r", self)
        add(view, "放大", #selector(zoomIn), "+", self)
        add(view, "缩小", #selector(zoomOut), "-", self)
        add(view, "实际大小", #selector(zoomReset), "0", self)
        let windows = submenu("窗口")
        NSApp.windowsMenu = windows
        add(windows, "最小化", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(windows, "缩放", #selector(NSWindow.performZoom(_:)))
        add(windows, "显示Ordo", #selector(showWindow), "", self)
        let help = submenu("帮助")
        add(help, "使用说明", #selector(helpWindow), "", self)
    }

    func startServer() {
        do {
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            guard let resources = Bundle.main.resourceURL else { throw appError("应用资源缺失") }
            let process = Process()
            process.executableURL = resources.appendingPathComponent("runtime/node")
            process.arguments = ["--disable-warning=ExperimentalWarning", resources.appendingPathComponent("backend/server.mjs").path]
            process.currentDirectoryURL = resources.appendingPathComponent("backend")
            process.environment = ["PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "LANG": "zh_CN.UTF-8",
                                   "TMPDIR": NSTemporaryDirectory(), "TODO_PORT": "0", "TODO_DIR": dataDirectory.path,
                                   "TODO_DESKTOP_TOKEN": token, "TODO_CODEX_DISABLED": "1"]
            // Preserve explicit account/network configuration supplied by the launcher.
            for key in ["CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "CODEX_CA_CERTIFICATE", "SSL_CERT_FILE"] {
                if let value = ProcessInfo.processInfo.environment[key] { process.environment?[key] = value }
            }
            let stdinPipe = Pipe(), stdoutPipe = Pipe()
            input = stdinPipe; output = stdoutPipe
            process.standardInput = stdinPipe
            process.standardOutput = stdoutPipe
            let logURL = dataDirectory.appendingPathComponent("desktop.log")
            FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            let log = try FileHandle(forWritingTo: logURL)
            logHandle = log; process.standardError = log
            stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; return }
                guard let text = String(data: data, encoding: .utf8) else { return }
                DispatchQueue.main.async { self?.receive(text) }
            }
            process.terminationHandler = { [weak self] proc in
                DispatchQueue.main.async {
                    guard let self = self, !self.stopping else { return }
                    self.fail("本地服务意外退出（\(proc.terminationStatus)）。你的数据仍保存在本机，可以重新打开Ordo。")
                }
            }
            server = process
            try process.run()
            timeout = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
                if self?.started == false { self?.fail("启动超时，请重新打开Ordo。") }
            }
        } catch { fail(error.localizedDescription) }
    }

    func receive(_ text: String) {
        buffer += text
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end]); buffer.removeSubrange(...end)
            let prefix = "ToDo board on "
            guard !started, line.hasPrefix(prefix), let url = URL(string: String(line.dropFirst(prefix.count)).components(separatedBy: " ")[0]),
                  url.host == "127.0.0.1", url.port != nil else { continue }
            started = true; timeout?.invalidate(); baseURL = url
            let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "ordo-session",
                                                 .value: token, HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                                                 HTTPCookiePropertyKey("SameSite"): "Strict"])!
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
                self?.webView.load(URLRequest(url: url))
            }
        }
    }

    func appError(_ text: String) -> NSError { NSError(domain: "Ordo", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    func fail(_ message: String) {
        guard !failed else { return }; failed = true
        if smoke { print("SMOKE FAILED: \(message)"); fflush(stdout); exit(1) }
        let alert = NSAlert(); alert.messageText = "Ordo暂时无法打开"; alert.informativeText = message
        alert.addButton(withTitle: "退出"); alert.addButton(withTitle: "查看日志")
        if alert.runModal() == .alertSecondButtonReturn { showData() }
        NSApp.terminate(nil)
    }

    func command(_ name: String) {
        showWindow()
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('ordo-command', {detail: '\(name)'}))", completionHandler: nil)
    }
    @objc func newItem() { command("new") }
    @objc func settings() { command("settings") }
    @objc func searchTasks() { command("search") }
    @objc func reload() { confirmDiscard { [weak self] proceed in if proceed { self?.webView.reload() } } }
    @objc func zoomIn() { webView.pageZoom = min(1.6, webView.pageZoom + 0.1) }
    @objc func zoomOut() { webView.pageZoom = max(0.7, webView.pageZoom - 0.1) }
    @objc func zoomReset() { webView.pageZoom = 1 }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func showData() { NSWorkspace.shared.open(dataDirectory) }
    @objc func exportJSON() { export(path: "/api/todo", name: "Ordo-待办.json", type: .json) }
    @objc func backup() { export(path: "/api/desktop/backup", name: "Ordo-完整备份.sqlite", type: UTType(filenameExtension: "sqlite") ?? .data) }

    func export(path: String, name: String, type: UTType) {
        guard let base = baseURL else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = name; panel.allowedContentTypes = [type]
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let destination = panel.url, let self = self else { return }
            var request = URLRequest(url: base.appendingPathComponent(path))
            request.setValue("ordo-session=\(self.token)", forHTTPHeaderField: "Cookie")
            URLSession.shared.dataTask(with: request) { data, response, error in
                do {
                    if let error = error { throw error }
                    guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data else { throw self.appError("无法读取备份数据") }
                    let bytes: Data
                    if type == .json {
                        bytes = try JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: data), options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
                    } else { bytes = data }
                    try bytes.write(to: destination, options: .atomic)
                    DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([destination]) }
                } catch {
                    DispatchQueue.main.async {
                        let alert = NSAlert(error: error); alert.beginSheetModal(for: self.window)
                    }
                }
            }.resume()
        }
    }

    @objc func about() {
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Ordo", .applicationVersion: "2.2.0",
            .credits: NSAttributedString(string: "序 · 给生活，一点秩序。\n\n专注待办，保存在本机。"),
            NSApplication.AboutPanelOptionKey(rawValue: "Copyright"): "组件许可保留在应用 Resources 中。"])
    }
    @objc func helpWindow() {
        let alert = NSAlert(); alert.messageText = "Ordo · 使用说明"
        alert.informativeText = "在顶部输入任务，按回车保存。点击四种状态筛选：我在做、Agent 在做、等别人、还没做。今天视图中新建的任务安排到今天，接下来视图中默认安排到明天。\n\n卡片上可以直接开始、完成或编辑任务。Agent 分类只记录交接位置和说明，不会自动执行；点「看过了」更新跟进时间，点「收回自己做」回到我在做。\n\n⌘N 打开新建详情，⌘↵ 保存，⌘F / ⌘K 搜索。日期、步骤、重复与标签按需添加。拖动任务到清单即可移动，右上角「…」提供排序、多选和编辑清单。\n\n已完成与回收站保留任务记录。⌘, 打开设置，或从「文件」菜单备份数据。"
        alert.addButton(withTitle: "知道了"); alert.beginSheetModal(for: window)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if let base = baseURL, url.scheme == base.scheme, url.host == base.host, url.port == base.port { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin = baseURL,
              message.frameInfo.securityOrigin.host == origin.host,
              message.frameInfo.securityOrigin.port == origin.port,
              let body = message.body as? [String: String] else { return }
        switch body["action"] {
        case "backup": backup()
        case "export": exportJSON()
        case "showData": showData()
        case "chooseFolder":
            let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
            panel.allowsMultipleSelection = false; panel.prompt = "选择工作文件夹"
            panel.beginSheetModal(for: window) { [weak self] response in
                guard response == .OK, let path = panel.url?.path else { return }
                self?.webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('ordo-folder',{detail:{id:id,path:path}}))", arguments: ["id": body["id"] ?? "", "path": path], in: nil, in: .page, completionHandler: nil)
            }
        case "openFolder":
            if let path = body["path"], path.hasPrefix("/") {
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue {
                    NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))
                }
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smoke, !smokeStarted, webView.url?.host == "127.0.0.1" else { return }
        smokeStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard let resource = Bundle.main.resourceURL else { return }
            do {
                let script = try String(contentsOf: resource.appendingPathComponent("smoke.js"), encoding: .utf8)
                webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                    switch result {
                    case .success(let result):
                        print("SMOKE PASSED: \(result)"); fflush(stdout)
                        NSApp.terminate(nil)
                    case .failure(let error): self.fail(error.localizedDescription)
                    }
                }
            } catch { self.fail(error.localizedDescription) }
        }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func confirmDiscard(quitting: Bool = false, _ completion: @escaping (Bool) -> Void) {
        webView.evaluateJavaScript("Boolean(window.ordoHasUnsavedChanges?.() || (\(quitting ? "true" : "false") && window.ordoActiveRuns))") { result, _ in
            guard result as? Bool == true else { completion(true); return }
            let alert = NSAlert(); alert.messageText = quitting ? "还有未保存的内容" : "还有未保存的内容"
            alert.informativeText = quitting ? "退出会放弃尚未提交的草稿。请先保存需要保留的内容。" : "请先保存正在编辑的任务，或等待当前修改保存完成。"
            alert.addButton(withTitle: "继续编辑"); alert.addButton(withTitle: "放弃并继续")
            alert.beginSheetModal(for: self.window) { completion($0 == .alertSecondButtonReturn) }
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if smoke || !started { return .terminateNow }
        confirmDiscard(quitting: true) { proceed in sender.reply(toApplicationShouldTerminate: proceed) }
        return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true; timeout?.invalidate(); output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        if server?.isRunning == true { server?.terminate(); server?.waitUntilExit() }
        try? logHandle?.close()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
