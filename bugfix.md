# Bugfix Notes

This file records regressions that were introduced during development and then fixed. Every entry must explain:

- how the bug appeared
- the root cause
- the concrete fix
- how to avoid repeating it

## Update publisher could expose metadata before the new installer finished uploading

- How it appeared:
  Some update installs could fail very early with an NSIS extraction error such as failing to write `winshell.dll`, even though the locally built installer itself was valid.
- Root cause:
  The COS publish script uploaded `latest.yml` and `update-manifest.json` before the current installer payload. That allowed clients to discover a new version while the referenced installer was still missing, stale, or only partially uploaded.
- Fix:
  Changed the publisher to upload only the installer/zip named by the current `update-manifest.json`, upload payload binaries first, upload metadata last, and fail fast if either the payload set or metadata set is incomplete.
- Avoid:
  Treat update metadata as the final commit point of a release. Never publish `latest.yml` before the exact installer and archive it points to are already in place.

## Auto-update install could be blocked by the app's own quit guard

- How it appeared:
  After an update finished downloading, clicking install could keep showing that the current process could not be closed instead of handing control to the installer.
- Root cause:
  `autoUpdater.quitAndInstall()` ran while the main window still used the normal close interception path. The app only switched to `allowAppQuit = true` inside `before-quit`, so the update-triggered window close could still be prevented by the exit guard and password dialog flow.
- Fix:
  Before starting update installation, the auto-update runtime now explicitly switches the app into the allow-quit state and closes any exit-password window so `quitAndInstall()` can complete the shutdown path cleanly.
- Avoid:
  Any non-interactive quit path such as update install, restart, or maintenance shutdown must bypass UI close guards before requesting app exit.

## Remote study-agent queue could be blocked by one bad request

- How it appeared:
  One failed remote homework, dictation, or recitation request could stop the rest of the batch from being processed, and a stuck native module launch could leave the queue waiting indefinitely.
- Root cause:
  The desktop agent runtimes processed each batch strictly in series without isolating failures per request, and the native module launch path had no timeout. Homework source downloads also had no timeout, so a slow source URL could pin the whole homework queue.
- Fix:
  Wrapped each request in its own failure boundary so later requests still run, recorded failed request marks for diagnostics, added timeouts around HomeworkApp/DictationApp/RecitationApp agent launches, and added a timeout to remote homework source downloads.
- Avoid:
  Any remote queue that consumes multiple requests must isolate failures per request and bound external work with explicit timeouts. Do not let one malformed request or hung child process stall the whole batch.

## Release publisher defaulted to the wrong update path

- How it appeared:
  The packaged app checked updates from the `studygate-updates/latest` path, but the COS release publisher still defaulted to `studygate/releases/latest`.
- Root cause:
  The app-side update URL and the release upload script drifted apart, so a publish without explicit override variables could upload valid artifacts to a location the client never polled.
- Fix:
  Changed the release publisher default prefix to `studygate-updates/latest` so it matches the app configuration out of the box.
- Avoid:
  Keep the packaged client update URL, release uploader default prefix, and deployment docs aligned whenever the update hosting path changes.

## NSIS installer file name drifted away from latest.yml

- How it appeared:
  The packaged installer on disk used spaces in its file name, while `latest.yml` referenced the hyphenated variant produced by `electron-builder` metadata.
- Root cause:
  The custom NSIS artifact name in the packaging script used `"${productName} Setup ${buildVersion}"`, which did not match the file name that auto-update metadata expected clients to download.
- Fix:
  Changed the installer artifact naming pattern to `${productName}-Setup-${buildVersion}` so the generated installer file matches `latest.yml`.
- Avoid:
  Keep custom installer artifact naming aligned with the filenames referenced by auto-update metadata, and verify the generated installer file really exists under the exact name written into `latest.yml`.

## Cloud homework delete drifted away from the supported product boundary

- How it appeared:
  CloudBase docs still described remote homework delete actions, and the shared homework runtime could still accept delete-mode payloads, even though homework deletion was only supported locally in the desktop client.
- Root cause:
  The cloud homework request flow retained an older delete model after the product boundary had already moved deletion back to local-only handling.
- Fix:
  Removed the remote delete documentation and made the shared homework runtime reject non-create submissions with `agent_homework_delete_not_supported`, so the cloud entry points now match the desktop behavior.
- Avoid:
  When a capability is intentionally removed, delete or reject it at every layer that can still describe or accept it: docs, public API entry points, shared runtimes, and client sync code.

## Home page fallback: `本地首页加载失败。`

- How it appeared:
  After adding the manual update dialog, the packaged app opened `home.html` but the shared toolbar disappeared, `window.studyGate` was missing, and the home page fell back to `本地首页加载失败。`
- Root cause:
  The main-window preload `src/preload.js` added a new relative runtime import while Electron was running with `sandbox: true`. In the packaged app, that preload dependency failed before `contextBridge.exposeInMainWorld(...)`, so the file-page bootstrap never completed.
- Fix:
  Removed the fragile relative preload dependency, moved the update dialog runtime back into a self-contained `src/preload.js`, kept online-classroom preload logic in its own classroom preload path, and deleted the dead helper file.
- Avoid:
  Do not add unproven relative runtime imports to the main file-page preload. If `src/preload.js` changes, verify the packaged app still has `window.studyGate`, the shared toolbar, and rendered home cards. Treat `本地首页加载失败。` as a preload bootstrap failure first.

## Native module packaging failure: `NETSDK1047`

- How it appeared:
  `npm run build` failed while publishing `RecitationApp` with `NETSDK1047`, saying `project.assets.json` did not contain the `net10.0-windows/win-x64` target.
- Root cause:
  The native module project files did not explicitly declare `RuntimeIdentifiers`, but the packaging script published them with `-r win-x64 --no-restore`. That left RID-specific publish behavior dependent on restore state and made packaging flaky.
- Fix:
  Added `<RuntimeIdentifiers>win-x64</RuntimeIdentifiers>` to `HomeworkApp.csproj`, `DictationApp.csproj`, and `RecitationApp.csproj`, so restore and publish always produce the expected `win-x64` assets.
- Avoid:
  Any packaged native module that is published with `-r win-x64` must declare `RuntimeIdentifiers` explicitly. Do not rely on a prior restore state to make `--no-restore` publish succeed.

## `skillPublic` metadata drifted from the zip package

- How it appeared:
  The downloadable skill zip had the new version, but `/api/skill` metadata still reported an old version. OpenClaw then kept describing the skill as the old release.
- Root cause:
  `skills/study-helper/SKILL.md`, `cloudbase/functions/skillPublic/index.js`, and `cloudbase/functions/skillPublic/assets/study-helper.zip` were not updated together.
- Fix:
  Synchronized the version in all three layers and added a smoke check that compares the source version, `SKILL_VERSION`, and asset zip version.
- Avoid:
  Any `学习助手` change must update the script, `SKILL.md`, `skillPublic` metadata, and the packaged zip together. Never publish one layer without checking the other two.

## StudyGate smoke false failure during internal navigation

- How it appeared:
  `npm run test:ui` failed with `Execution context was destroyed, most likely because of a navigation.` after the update-dialog smoke was added.
- Root cause:
  The smoke helper awaited `window.studyGate.navigate('internal:library')` inside `page.evaluate(...)`, so the renderer context was torn down mid-evaluation when navigation started.
- Fix:
  Changed the smoke helper to trigger navigation without awaiting it inside the page context, then waited for navigation from Playwright outside the destroyed execution context.
- Avoid:
  In UI smoke, do not `await` app-triggered navigations from inside `page.evaluate(...)` when the same evaluation context is about to be replaced by a new page load.

## Native study modules showed the default taskbar icon

- How it appeared:
  `StudyGate` 的作业、听写、背诵模块启动后，在任务栏和窗口标题栏里显示的是系统默认程序图标，不是项目自己的图标。
- Root cause:
  三个独立 WPF 模块都没有设置 `ApplicationIcon`，顶层窗口也没有设置 `Window.Icon`，所以发布后的模块 `.exe` 只能落回默认图标。
- Fix:
  Reused the packaged `StudyGate.exe` icon as each module自己的资源，给 `HomeworkApp`、`DictationApp`、`RecitationApp` 都加上了 assembly icon 和 WPF window icon，并把附属编辑/执行窗口也一起绑定到同一个图标。
- Avoid:
  Every independent C# module must set both the executable icon and the window icon before packaging. When a new native module is added, verify the packaged `.exe`, main window, and any standalone child windows no longer show the default Windows icon.

## Main app fell back to the default Electron taskbar icon

- How it appeared:
  The packaged `StudyGate.exe` installed and launched normally, but the taskbar and shell shortcut icon still looked like the stock Electron app instead of the project icon.
- Root cause:
  The Windows package configuration only branded the unpacked app resources indirectly. `electron-builder` was still free to use its default application icon because the installer/window icon path was not wired through the package build and the packaged root did not carry an explicit runtime icon asset.
- Fix:
  Added a dedicated app-icon runtime, pointed the main shell windows at the branded icon path, configured the Windows/NSIS package icons explicitly in the packaging script, and copied the shared icon asset into the packaged app root so both the executable and runtime windows resolve the same icon.
- Avoid:
  When fixing or adding any desktop entry point, verify the packaged installer, the installed `StudyGate.exe`, and the runtime taskbar window all resolve the same branded icon. Do not assume branding child modules is enough for the main Electron shell.

## UI smoke can pass against stale packaged artifacts if `build` and `test:ui` overlap

- How it appeared:
  A smoke run reported mismatched behavior after code changes even though the source files were already corrected, because the test was validating an older packaged app.
- Root cause:
  Packaging and UI smoke were run too close together, so the smoke suite could start against a stale `dist` artifact while a new build was still being produced.
- Fix:
  Changed the validation flow to run `npm run build` to completion first, then run `npm run test:ui` against the newly packaged output. Rechecked the packaged version and smoke report after the sequential run.
- Avoid:
  Treat packaged-app smoke as artifact validation, not source validation. Never overlap `build` and `test:ui` when changes touch packaging, preload, icons, updater, or native module wiring. Always rebuild first, then run smoke against the fresh `dist` output.

## Online classroom `Ctrl + 滚轮` kept failing in BrowserView

- How it appeared:
  在线课堂页里按 `Ctrl + 滚轮` 没有任何缩放反应，最开始的 smoke 也一直卡在课堂 iframe 缩放不生效。
- Root cause:
  缩放最初挂在了 BrowserView 壳层和 isolated-world preload 上，分别踩中了两个问题：`before-input-event` 对 mouse wheel 不可靠，以及 isolated-world 里的课堂事件/桥接在课堂页面里并不稳定。结果是课堂页和 iframe 都没有走到真正能改变显示大小的逻辑。
- Fix:
  把在线课堂缩放收回到课堂模块自身：主 frame 和子 frame 都改成页面世界脚本，直接对各自 `document.documentElement.style.zoom` 做 `Ctrl + 滚轮 / Ctrl + 0` 处理，不再依赖通用 preload 或 BrowserView 壳层输入事件。同步把 advanced smoke 改成验证主 frame 和子 frame 的真实 zoom 值变化。
- Avoid:
  在线课堂行为必须留在课堂模块里，不要再把课堂交互塞回主窗口通用 preload。遇到 BrowserView 里的输入问题，优先验证页面世界脚本是否真的改变了课堂 DOM 的显示状态，再决定是否需要壳层参与。

## Online classroom controls leaked onto home cards and top frame zoomed with content

- How it appeared:
  首页里的在线课堂卡片出现了额外的 `初始化` 按钮，样式和其他卡片不一致；同时在线课堂 `Ctrl + 滚轮` 会缩放课堂顶部主 frame，而不是只缩放工具栏下方的内容子 frame。
- Root cause:
  在线课堂的状态重置能力被同时挂在共享 toolbar 和首页卡片上，模块边界被打破。缩放这边则是 BrowserView 壳层和课堂主 frame 都在抢 `Ctrl + 滚轮`，导致主 frame 本身被放大，而不是只把缩放意图转发给内容子 frame。
- Fix:
  去掉了首页卡片上的在线课堂 `初始化` 入口，只保留共享 toolbar 里的初始化。课堂缩放改成：BrowserView 不再拦截并调整整页 zoom，主 frame 只负责转发缩放命令，真正的 zoom 只作用在内容子 frame。
- Avoid:
  在线课堂相关入口和交互只能留在课堂模块自己的 toolbar / BrowserView 链路里，不能回流到首页卡片。涉及 frame 页面缩放时，先明确谁是容器、谁是内容，再验证只改内容 frame 的 DOM zoom。

## Homework paper max zoom changed after collapsing the assistant and hid tools on reopen

- How it appeared:
  作业纸放大到最大后，收起作业助手还能继续放大；再展开作业助手时，右下角工具按钮会被挤没。
- Root cause:
  最大缩放上限按当前 `LeftColumn.ActualWidth` 动态计算。助手收起后左栏宽度变成 `0`，缩放上限被意外抬高，导致重新展开助手时布局空间不够，工具按钮被挤出可见区域。
- Fix:
  最大缩放上限改成始终按展开态助手宽度预留空间计算，不再因为助手收起而继续增大。同步更新 UI smoke，验证展开最大缩放和收起后最大缩放一致，且重新展开后 `BtnTools` 仍然可见。
- Avoid:
  会影响版面边界的缩放上限必须基于稳定布局约束计算，不能跟随临时折叠态波动。任何涉及作业纸缩放和助手收起/展开的改动，都必须跑 `HomeworkApp` 的 editor smoke，检查最大缩放和工具按钮可见性。

## Homework UI smoke hung on the print-complete dialog after print-to-PDF

- How it appeared:
  `HomeworkApp` 的打印 smoke 能把 PDF 打出来，但测试随后会卡在 `打印完成 / 已发送到打印机` 弹框，导致后续复用同一进程的 editor smoke 无法继续。
- Root cause:
  smoke harness 只在等待 PDF 文件生成时顺手轮询了一次弹框；如果 `MessageBox.Show("已发送到打印机…", "打印完成")` 在 PDF 已经稳定落盘后才弹出来，测试就会漏掉这个模态窗口，留下一个阻塞整个窗口的对话框。
- Fix:
  把打印完成弹框处理改成明确的收尾阶段：PDF 生成完成后，再额外等待一个短窗口并持续尝试关闭 `打印完成` 对话框；同时保留固定位置点击确认和回车兜底，保证模态框在进入下一步 editor smoke 之前被清掉。
- Avoid:
  对任何“打印成功后再弹提示框”的流程，不能把弹框处理绑死在文件生成轮询里。必须在打印完成后再做一次显式的模态窗口清理，否则复用同一进程的后续 smoke 会被残留对话框锁死。

## Homework UI smoke menu step hung because the test guessed the first menu item

- How it appeared:
  作业助手收起/展开测试后，smoke 在 `BtnMenu` 这一步卡住，或者点开菜单却没有触发“同步云端作业”，最后报 `手动同步没有触发本地 StudyGate 同步接口`。
- Root cause:
  harness 之前只是把鼠标挪开后点击 `BtnMenu`，再用回车去“猜”第一项菜单。如果上下文菜单焦点没有稳定落到第一项，或者作业纸悬浮菜单抢了焦点，这个回车就不会命中“同步云端作业”。
- Fix:
  给作业助手菜单项补了明确的 `AutomationId`，菜单打开时主动把焦点放到第一项；smoke 则改成先把鼠标移到安全区域，再直接按 `AutomationId/Name` 查找并点击“同步云端作业”菜单项，不再靠回车猜第一项。
- Avoid:
  对弹出式菜单、上下文菜单、悬浮菜单的自动化，不要依赖“当前默认焦点大概率在第一项”这种假设。必须给关键菜单项稳定标识，并让 smoke 直接定位目标项；同时在菜单弹出前把鼠标移出会触发悬浮控件的区域。

## Manual update flow looked dead because the dialog did not receive live download/install state

- How it appeared:
  点击“检查更新”后，即使检测到新版本，弹框里也看不到下载进度，点“升级”后几乎没有反馈；安装阶段也没有任何显式状态，用户会误以为按钮没反应。
- Root cause:
  更新弹框只在打开时拉一次快照。手动下载时前端还在等待 `downloadUpdate()` 整个 Promise 完成，下载中的状态和进度没有持续推送到 renderer；安装前也没有单独的 `installing` 状态。
- Fix:
  给自动升级 runtime 补了状态广播，下载阶段改成立即返回并依靠事件持续推送 `checking / available / downloading / downloaded / installing`；弹框新增进度条、速度/传输量说明和安装准备状态。
- Avoid:
  任何需要等待长任务的桌面交互都不能只靠“打开时抓一帧快照”。只要任务会经历多个阶段，就必须有明确状态机和持续状态推送，并为用户展示实时进度。

## Extracting update-dialog preload code reintroduced the home-page preload regression

- How it appeared:
  为了把 `src/preload.js` 压回 1000 行以内，我把更新弹框逻辑拆到新的 `preload-update-dialog-runtime.js` 后，打包版首页再次回到 `本地首页加载失败。`
- Root cause:
  这次又把主窗口 preload 变成了相对依赖外部 runtime 的形式，重新触发了同类风险：sandbox preload 在打包环境里没能稳定完成 bootstrap，导致 `window.studyGate` 和共享 toolbar 都没起来。
- Fix:
  撤掉新的 preload helper，把更新弹框逻辑收回 `src/preload.js` 本体，同时继续把总代码控制在 1000 行以内；随后用打包版和整套 `npm run test:ui` 重新验证首页和工具栏都正常。
- Avoid:
  对主窗口 preload，优先通过压缩和局部整理控制行数，不要轻易再引入新的相对 preload helper。只要涉及主窗口 preload 的拆分，必须把“打包版首页是否仍有 `window.studyGate` 和 toolbar”当成第一优先级回归项。

## Dictation startup could feel frozen and exposed every answer up front

- How it appeared:
  On lower-performance PCs, opening the dictation module could stall while the main screen rendered a full task preview, and the preview/session flow made it easy for a child to copy the answer instead of attempting the dictation first.
- Root cause:
  The main window eagerly rendered every dictation item for the selected task, so long word lists turned startup into a large WPF list render. At the same time, the task session treated answer reveal as the primary action instead of making the learner attempt an answer before checking it.
- Fix:
  Changed the main-window preview to a short masked summary instead of the full answer list, added recovery for corrupted `tasks.json`, and redesigned the session flow so the learner types an attempt first and then checks or skips to reveal the answer.
- Avoid:
  Do not render full answer sets on a module landing page, especially for low-spec devices. Keep startup previews bounded, treat persisted task data as untrusted input, and make "check after attempt" the default interaction for dictation-style practice.

## Installed app could not auto-update because `app-update.yml` was missing

- How it appeared:
  Fresh installs could launch normally, but checking for updates from the installed app failed before any real download started, and the packaged app had no `resources/app-update.yml`.
- Root cause:
  The packaging flow generated the NSIS installer and zip artifacts, but never wrote the updater runtime config into the staged app resources, so installed builds were missing the file `electron-updater` needs at runtime.
- Fix:
  Updated `scripts/package-app.js` to generate `resources/app-update.yml` during staging, wiring the generic feed URL, channel, and `updaterCacheDirName` into every packaged desktop build. Added artifact smoke coverage for the file.
- Avoid:
  Treat packaged updater config as a required release artifact, not an optional byproduct. Any auto-update change must verify the staged app, installer, and smoke suite all see the same `app-update.yml`.

## Quit path crashed because netdisk cleanup was wired in `main.js` but not exported

- How it appeared:
  On shutdown, especially during update install, the app could throw before exiting because `main.js` called `clearPendingNetdiskAuth()` even though the runtime object did not export it.
- Root cause:
  The netdisk runtime owned the cleanup implementation, but its public return object omitted `clearPendingNetdiskAuth`, leaving the quit path with an undefined function call.
- Fix:
  Exported `clearPendingNetdiskAuth` from `src/netdisk-runtime.js` and kept the quit sequence in `src/main.js` using the shared runtime entry point.
- Avoid:
  When adding shutdown cleanup to `main.js`, verify the called helper is part of the source runtime's public contract and is exercised by an installed-app quit smoke, not only by source inspection.

## Update install crashed in `before-quit` because session persistence was not wired from storage runtime

- How it appeared:
  A real `1744 -> 1815` upgrade could detect the new version and start download, but clicking install crashed the installed app during `before-quit` with `ReferenceError: persistSessionState is not defined`.
- Root cause:
  `src/storage-runtime.js` had the `persistSessionState` implementation, but the function was missing from the runtime return object, and `src/main.js` also was not destructuring it. The quit handler called `persistSessionState()` without ever getting a callable binding.
- Fix:
  Exported `persistSessionState` from `src/storage-runtime.js` and added it to the `storageRuntime` destructure in `src/main.js`, so the update-install quit path can flush session state without throwing.
- Avoid:
  Any runtime helper used in startup or quit hooks must be imported from the owning runtime in the same change. Real installer-to-updater E2E should stay in the release checklist because source-level smoke did not catch this missing binding.

## Update dialog regressed to "already latest" after the download actually completed

- How it appeared:
  In a real local `1744 -> 1815` upgrade run, the main process finished downloading the installer and wrote it into the updater cache, but the visible dialog flipped back to `当前已经是最新版本。` instead of exposing the install action.
- Root cause:
  `src/auto-update-runtime.js` emitted live status changes using raw `lastStatus`, which only tracked `availableVersion`. The preload dialog renderer expects derived fields such as `latestVersion`, `enabled`, and `hasUpdate`, so the pushed `downloaded` payload was interpreted as "no update".
- Fix:
  Added a shared status-snapshot builder in `src/auto-update-runtime.js` and used it for live emits, `getStatus()`, and manual snapshots, so renderer updates always include `currentVersion`, `latestVersion`, `enabled`, and `hasUpdate`.
- Avoid:
  Treat updater IPC payloads as a stable contract. When adding or refactoring updater state, keep polling snapshots and push events shaped the same, and verify the packaged dialog still reaches `available -> downloading -> downloaded -> installing` in a real E2E run.

## Auto-update launched the installer in interactive mode and then hung waiting for UI

- How it appeared:
  After download completed and the app entered `installing`, the updater did start `StudyGate-Setup-2026.408.1815.exe`, but the installed version stayed on `1744` while the installer process remained alive with `--updated --force-run`.
- Root cause:
  `src/auto-update-runtime.js` called `autoUpdater.quitAndInstall(false, true)`. In `electron-updater`, the first argument controls silent mode, so the desktop updater was starting the NSIS installer as a non-silent install during an otherwise automatic flow.

## Dictation session layout fought the real lesson workflow

- How it appeared:
  The dictation session showed one small handwriting box per item, so the child had to look across many mini writing areas instead of following a normal classroom rhythm. The page also made the lesson feel like a form editor rather than "listen to this question, write it, save it, move on".
- Root cause:
  The session UI was designed around per-row editing and deferred checking, but it never matched the intended mental model of "top = lesson progress and saved results, bottom = one current writing board". That mismatch came from treating the session as a list of parallel inputs instead of a single active-answer workspace.
- Fix:
  Redesigned `DictationApp` so the top half is a lesson result strip with one card per question and the bottom half is a single large handwriting board. Each answer is now saved upward into its question card, the board is cleared for the next question, and grading still happens only after the whole round is complete.
- Avoid:
  For classroom-style dictation, always design around one active answer at a time. Keep "progress/history" and "current writing surface" separate, and validate the interaction against a real student workflow before adding more per-item controls.
- Fix:
  Switched the call to `autoUpdater.quitAndInstall(true, true)` so automatic upgrades run the installer silently and still relaunch the app after install.
- Avoid:
  Do not rely on defaults or positional booleans for updater install behavior. When changing auto-update install flow, verify the actual spawned installer command path and confirm the installed version changes without any UI prompt.

## Updater smoke stopped matching packaged behavior after `app-update.yml` became mandatory

- How it appeared:
  `npm run test:ui` failed in the update runtime smoke with `Missing packaged updater config: app-update.yml`, even though the real packaged installer and installed app already contained that file.
- Root cause:
  The smoke harness instantiated the packaged updater runtime without creating a mock `process.resourcesPath/app-update.yml`, so the new runtime guard was validating a fake environment that could never exist in a real packaged app.
- Fix:
  Reworked `scripts/ui-smoke/update-runtime-smoke.js` to create a temporary `resources/app-update.yml`, point `process.resourcesPath` at it, and assert the silent install call shape as part of the smoke.
- Avoid:
  When packaging assumptions become stricter, update the smoke harness to mimic the packaged filesystem contract instead of weakening the production guard. Packaged-app checks and runtime smoke should validate the same prerequisites.

## Dictation session still showed too much chrome after switching to the single handwriting board

- How it appeared:
  After the first single-board redesign, the session page still felt busy: the top area was too tall, question cards occupied too much space, the bottom area still carried extra prompt text, and the writing-time controls had not been fully pushed out into settings.
- Root cause:
  The redesign fixed the high-level flow, but the visible layout still inherited too much of the previous "instruction-heavy form" structure. We kept a roomy top container, oversized cards, and visible helper copy in the writing area instead of treating the session as a minimal classroom surface.
- Fix:
  Compressed the top section into a flat horizontal question strip, reduced each card to a small number-plus-preview tile, removed the extra visible session copy from the bottom area so only the handwriting board and `清空手写` remain, and kept playback count / writing seconds exclusively in the dedicated settings window. Updated native-module smoke and the real-UI test case document to validate the new structure.
- Avoid:
  For dictation session UI, separate "visible student surface" from "automation/status plumbing". Visible elements should be limited to what the student truly needs in the moment, while status text and timing metadata stay hidden for smoke and diagnostics. Whenever the dictation layout is changed, verify the real window still reads as "top = question strip, bottom = one handwriting board" before closing the work.

## Dictation task home drifted away from the rest of the product shell

- How it appeared:
  The dictation task page opened in a smaller window, the four action buttons were squeezed so the right edge could be clipped, tasks could not be deleted from the UI, and the overall button/card styling no longer matched the rest of the WPF modules or the desktop shell.
- Root cause:
  The page kept a narrow fixed action strip that no longer fit the growing button set, never added a delete path to the task store or main window, did not default to the expected maximized state, and had no module-level shared style resources to keep DictationApp visually aligned with the other surfaces.
- Fix:
  Reworked the dictation home action area into a stable multi-row layout, added task deletion to `DictationTaskStore` and the main window, made the main dictation window start maximized, introduced app-level shared brushes/button/card/input styles for DictationApp, and updated native-module smoke plus the real-UI test cases to check the maximized shell and visible actions.
- Avoid:
  Treat a module landing page as part of the same product shell, not a one-off screen. Any time actions are added to a fixed toolbar area, revalidate layout at runtime sizes, add the missing persistence path if the action edits data, and keep the module on shared visual tokens instead of ad-hoc inline styling.

## Dictation lesson window did not follow the same default maximized shell behavior

- How it appeared:
  The dictation task home already opened maximized, but after clicking `开始听写` the actual lesson window still opened in a smaller centered window, so the handwriting surface and question strip did not use the full screen like the rest of the module.
- Root cause:
  The maximized-window fix only covered `DictationApp.MainWindow`. `TaskSessionWindow` still kept its original fixed startup size and never opted into the same shell behavior.
- Fix:
  Made `TaskSessionWindow` start maximized and updated the native-module smoke plus the real-UI test cases to assert that both the task home and the lesson window now open maximized by default.
- Avoid:
  When a module adopts a default shell behavior such as maximized startup, apply it to the full primary flow, not just the landing page. Smoke should validate every top-level window the learner actually uses, not only the first one.

## Dictation session drifted into batch typing and stopped matching the real lesson workflow

- How it appeared:
  During development, the dictation session regressed into a “batch + text box + manual review” flow. That made the module feel like task management instead of student dictation, and it no longer matched the real classroom path of “finish one lesson, then review only the wrong words”.
- Root cause:
  The session redesign started from implementation convenience rather than the actual student workflow. We used batch rows, typed answers, and loose review steps, so the product boundary drifted away from “lesson-based handwriting dictation with automatic judging”.
- Fix:
  Replaced the batch text-box session with a lesson-first handwriting session, added per-item `InkCanvas` writing areas, split handwriting recognition from judging, made judging strict enough to prefer `请重写` over false positives, kept wrong-word replay as the only follow-up round, and updated native-module smoke to validate the new real window flow.
- Avoid:
  For student dictation, treat the core unit as a lesson, not a batch. Keep “recognition” and “judging” as separate layers, prefer false negatives over false positives, and update UI smoke whenever the real learner flow changes so tests do not keep validating an outdated interaction model.

## Dictation task home still behaved like a pop-up form instead of a lesson word-group workspace

- How it appeared:
  Even after the earlier cleanup, the task home still felt like a management form: the main actions lived in a toolbar cluster, grouping was weak, and editing a lesson still leaned on the old pop-up mental model instead of letting the parent manage one lesson's word groups inline.
- Root cause:
  The page structure had not fully shifted from “task CRUD screen” to “lesson word-group workspace”. Creation, editing, and deletion were still organized around toolbar actions and separate editor surfaces, so the UI hierarchy did not match the desired flow of “pick a grouped lesson on the left, edit the individual dictation word groups on the right”.
- Fix:
  Reworked `DictationApp.MainWindow` into a split workspace: a single `+` create affordance and grouped task cards on the left, card-level edit/delete actions, and a right-side inline editor focused on one word group row at a time. Added new automation anchors for the grouped list and inline editor, refreshed the real-UI test case document, and updated native-module smoke to validate the new shell.
- Avoid:
  For study-task modules, decide the primary interaction unit first. If the real unit is a lesson's word-group set, the landing page must be a workspace for that set, not a generic CRUD toolbar. Whenever the interaction model changes, update both the visible IA and the smoke anchors in the same change.
