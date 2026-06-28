# Repository Instructions

- Every hand-maintained source file must stay at or below `1000` lines. Do not add new logic to a file that already crosses that limit.
- If a file approaches `1000` lines, split it first: extract cohesive modules, helper runtimes, or partial classes before adding more behavior.
- Prefer low-risk refactors that preserve behavior: move code first, then simplify.
- When changing printing, schedule, navigation, or persistence code, run a real project build before finishing.
- Do not change the home page layout. It must remain: left = module cards, center = calendar, right = today's plan.
- Treat the local home page as preload-critical. This specific regression happened because the main-window `src/preload.js` added a new relative runtime import while Electron was running with `sandbox: true`; the packaged preload then failed before `contextBridge.exposeInMainWorld(...)`, which removed `window.studyGate`, removed the shared toolbar, and made the home page fall back to `本地首页加载失败。`.
- To avoid this regression, keep the main-window preload self-contained unless a relative preload dependency has already been proven in the packaged app. Module-specific preload code such as online-classroom behavior must stay in its own dedicated preload/module path, not be mixed into the main file-page preload by convenience.
- If the home page ever shows `本地首页加载失败。`, treat it as a preload bootstrap regression first. Check whether `window.studyGate` is missing in the packaged app, whether the toolbar shadow host exists, and whether a new preload dependency or bootstrap change prevented `contextBridge.exposeInMainWorld(...)` from running.
- Before shipping any preload/home/toolbar change, verify the packaged app still passes these concrete checks: home cards render, shared toolbar renders, `学生计划` action is present, `检查更新` action is present if expected, and `npm run test:ui` passes. If preload was touched, also run a packaged app sanity check that the home page no longer reports `本地首页加载失败。`.
- If a preload/home regression appears, fix it by moving the risky logic back into the correct module boundary first, then restore behavior. For this class of bug, the concrete repair is: remove the fragile preload indirection, restore `src/preload.js` to a self-contained bootstrap, keep any new dialog/runtime logic inline there or behind a proven-safe boundary, delete the dead helper file, rebuild the packaged app, and rerun UI smoke until the home page and toolbar both render again.
- Keep module-specific logic inside its own module. Do not place online-classroom, homework, home-page, schedule, or other module behavior into unrelated modules; if something is truly shared, extract a dedicated shared runtime instead.
- New native modules must be split as independent modules. Dictation, recitation, homework, updater, and each cloud-sync pipeline must keep their own code, storage model, commands, tests, and packaging paths. Only genuinely generic utilities may go into shared code.
- For new platform capabilities, prefer stable open-source or official industrial-grade components over hand-rolled infrastructure. Reuse maintained libraries/SDKs for updater, storage upload, diff, audio, and packaging when they fit the requirement.
- Keep [bugfix.md](Q:/singlewebsite/bugfix.md) current. Any regression introduced during development and any later bugfix must be recorded there before closing the work. Do not silently fix and move on. Every entry must capture: symptom, root cause, concrete repair, and how to avoid repeating it.
- Do not modify or report the navigation banner static asset unless the user explicitly asks for that resource.
- For automated UI testing, use `npm run test:ui`. It runs a DOM/code-anchor smoke test for `StudyGate.exe`, a code-anchor C# smoke test for `HomeworkApp.exe` including real PDF print verification, dedicated native-module smoke for `DictationApp.exe` and `RecitationApp.exe`, `学习助手` smoke for homework/dictation/recitation command paths, and an update-artifact smoke for packaged auto-update metadata.
- UI automated tests must minimize process churn. In one full smoke run, each module/app should be started once and closed once. If adjacent checks can reuse the same StudyGate/HomeworkApp/module session, merge them instead of relaunching.
- Before submitting or releasing any `学习助手` / `skillPublic` change, verify all of these stay in sync: `skills/study-helper/SKILL.md` version, `cloudbase/functions/skillPublic/index.js` `SKILL_VERSION`, `cloudbase/functions/skillPublic/assets/study-helper.zip`, and if the function is already deployed, `/api/skill` metadata version must match the downloaded zip version.
- When `学习助手` capabilities change, update every user-facing declaration together: `skills/study-helper/SKILL.md`, `skills/study-helper/scripts/study-helper.js`, and `cloudbase/functions/skillPublic/index.js` command metadata. Do not leave removed commands or stale descriptions in any one layer.
- Before shipping any auto-update change, verify all of these stay in sync: `package.json` updater dependencies, `scripts/package-app.js` installer generation, `scripts/publish-cloudbase-hosting-release.js` CloudBase hosting output, and the client `autoUpdate.url/channel` configuration expected by `src/auto-update-runtime.js`.
- Before shipping any new native module or cloud-sync module, add a dedicated smoke path for both the packaged desktop module and the corresponding `学习助手` / cloud function command path. Do not rely on homework smoke to cover dictation, recitation, or future modules.

## CloudBase Workspace Facts

- The active CloudBase environment for this repo is `selfuse-5g3tkjfq0ede092b` (`alias=selfuse`, `region=ap-shanghai`).
- The CloudBase mini program appid currently used by this repo is `wxf0e5731b8c3b1d9e`.
- Keep the local mcporter MCP config in [config/mcporter.json](Q:/singlewebsite/config/mcporter.json) so future Codex sessions can reconnect to CloudBase quickly.
- Keep the environment marker in [cloudbaserc.json](Q:/singlewebsite/cloudbaserc.json) so future Codex sessions do not need to rediscover the CloudBase envId.
- The desktop auto-update feed is hosted from CloudBase static hosting at `https://selfuse-5g3tkjfq0ede092b-1324687027.tcloudbaseapp.com/studygate-updates/latest/`.
- The CloudBase static hosting bucket is `8bb1-static-selfuse-5g3tkjfq0ede092b-1324687027`.
- The CloudBase storage bucket is `7365-selfuse-5g3tkjfq0ede092b-1324687027`.
- Publish desktop update artifacts to `studygate-updates/latest/` and keep exactly these files in sync: `latest.yml`, `update-manifest.json`, `StudyGate-win32-x64.zip`, `StudyGate-Setup-<version>.exe`.
- When the homework cloud-sync contract changes, redeploy `homeworkPublic` and `homeworkAdmin`.
- `build/branding/studygate.ico` and `build/branding/studygate.png` are real repo assets and must stay tracked.
- `作业模块.md` and `听写和背诵模块.md` are project documents and must stay tracked.
