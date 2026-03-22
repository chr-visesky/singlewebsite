# Bugfix Notes

This file records regressions that were introduced during development and then fixed. Every entry must explain:

- how the bug appeared
- the root cause
- the concrete fix
- how to avoid repeating it

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
