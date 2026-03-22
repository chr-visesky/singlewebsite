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
