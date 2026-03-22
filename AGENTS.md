# Repository Instructions

- Every hand-maintained source file must stay at or below `1000` lines. Do not add new logic to a file that already crosses that limit.
- If a file approaches `1000` lines, split it first: extract cohesive modules, helper runtimes, or partial classes before adding more behavior.
- Prefer low-risk refactors that preserve behavior: move code first, then simplify.
- When changing printing, schedule, navigation, or persistence code, run a real project build before finishing.
- Do not change the home page layout. It must remain: left = module cards, center = calendar, right = today's plan.
- Keep module-specific logic inside its own module. Do not place online-classroom, homework, home-page, schedule, or other module behavior into unrelated modules; if something is truly shared, extract a dedicated shared runtime instead.
- Do not modify or report the navigation banner static asset unless the user explicitly asks for that resource.
- For automated UI testing, use `npm run test:ui`. It runs a DOM/code-anchor smoke test for `StudyGate.exe`, a code-anchor C# smoke test for `HomeworkApp.exe` including real PDF print verification, and a homework interface smoke that creates and deletes homework through the API path.
- Before submitting or releasing any `学习助手` / `skillPublic` change, verify all of these stay in sync: `skills/study-helper/SKILL.md` version, `cloudbase/functions/skillPublic/index.js` `SKILL_VERSION`, `cloudbase/functions/skillPublic/assets/study-helper.zip`, and if the function is already deployed, `/api/skill` metadata version must match the downloaded zip version.
- When `学习助手` capabilities change, update every user-facing declaration together: `skills/study-helper/SKILL.md`, `skills/study-helper/scripts/study-helper.js`, and `cloudbase/functions/skillPublic/index.js` command metadata. Do not leave removed commands or stale descriptions in any one layer.
