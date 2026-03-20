# Repository Instructions

- Every hand-maintained source file must stay at or below `1000` lines. Do not add new logic to a file that already crosses that limit.
- If a file approaches `1000` lines, split it first: extract cohesive modules, helper runtimes, or partial classes before adding more behavior.
- Prefer low-risk refactors that preserve behavior: move code first, then simplify.
- When changing printing, schedule, navigation, or persistence code, run a real project build before finishing.
- Do not change the home page layout. It must remain: left = module cards, center = calendar, right = today's plan.
- Do not modify or report the navigation banner static asset unless the user explicitly asks for that resource.
- For automated UI testing, use `npm run test:ui`. It runs a DOM/code-anchor smoke test for `StudyGate.exe` and a code-anchor C# smoke test for `HomeworkApp.exe`, including real PDF print verification.
