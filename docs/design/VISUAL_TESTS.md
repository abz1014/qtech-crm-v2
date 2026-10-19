# Visual and accessibility tests (U09)

`/dev/gallery` (dev builds only) shows every built primitive and D08 state. Dialogs, the command palette, toasts and open pop-ups are separate pages at `/dev/gallery?scene=<name>`. Scene names live in `SCENE_LIST` in `src/dev/gallery/sceneList.ts` (plain data, shared by the gallery and the tests); the node for each is in `scenes.tsx` and the steps that open one, if any, are in `e2e/support.ts`.

## What runs

- `e2e/gallery.visual.spec.ts`: `toHaveScreenshot` for each gallery section and each scene, at 1440 and 375 wide (Playwright projects `w1440`, `w375`). The baselines are at the Normal text size (the default since 2026-10-19); the `textsize` section shows a sample at Normal and at Smaller side by side, so both scales are photographed.
- The same file checks the shell without screenshots (`shell widths`, run once, in `w1440`): the `shell` scene (the real top bar, phone bar and tabs with a fixed list of five, or six with `&tabs=6`) must not overflow or scroll sideways at 768, 1024, 1093, 1280, 1366, 1440, 1536 and 1920, every label must be in words from 1024 up, and the phone tabs must fit at 320, 360 and 375 without cutting a label. The database suite `e2e/money-books/shell-overflow.spec.ts` checks the real screens at 375, 1280, 1366 and 1440.
- `e2e/gallery.axe.spec.ts`: axe-core in Chromium (colour contrast on), WCAG 2.2 AA plus best-practice rules, over the page and every scene. The bar is zero violations. The `region` rule is off for scenes only: Radix tooltips, pop-ups and listboxes portal outside `<main>`.
- Determinism: clock frozen at Fri 27 Nov 2026 10:00 (Asia/Karachi) before the page loads, `Asia/Karachi` timezone, reduced motion, animations and transitions off, caret hidden, and the test fails if Geist Sans or Geist Mono has not loaded.
- The server is a development-mode build (`npm run build:e2e`) served by `vite preview`, because the gallery route exists only when `import.meta.env.DEV` is true.

CI runs both suites in the `e2e` job of `.github/workflows/ci.yml` on `ubuntu-24.04` (pinned, not `ubuntu-latest`: a runner image change shifts font rendering and breaks every baseline; move the pin and regenerate the baselines in the same PR). The job installs Chromium with `npx playwright install --with-deps chromium`.

One `playwright.config.ts` holds every suite as separate projects: `w1440` and `w375` (this suite, dev build, no database) and `auth` (A03, the CI Supabase stack, run by `.github/workflows/e2e.yml` with `E2E_SUITE=auth`). Each suite starts only its own server, so always pass `--project` (`npm run test:e2e` does).

## Baselines are Linux-only

They are in `e2e/__screenshots__/<project>/` with no platform suffix. Never commit baselines made on Windows or macOS: font rasterisation differs and CI will fail. Local runs of the visual suite are for looking at the images, not for committing them.

## Updating baselines after a deliberate primitive change

1. Make the change. Run the axe suite locally: `npm run test:e2e -- e2e/gallery.axe.spec.ts`.
2. Push the branch. The visual suite fails and its diffs are in the `playwright-report` artifact. Check that every diff is intended.
3. Actions, CI, Run workflow, pick your branch, tick `update_baselines`. (Or: `gh workflow run ci.yml --ref <branch> -f update_baselines=true` (works on a feature branch).)
4. `gh run download <run-id> -n visual-baselines -D e2e/__screenshots__`
5. `git add e2e/__screenshots__`, commit with the change, push. CI is green when the committed images match.

First run, or if the folder is deleted: the visual step generates the baselines itself, uploads them as the `visual-baselines` artifact and fails on purpose. Download it as in step 4, commit, push.

Review the PNGs in the PR. A baseline change with no matching primitive change is a regression, not an update.
