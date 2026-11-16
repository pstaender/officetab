# Workspace Office

Browser-native TypeScript port of LibreOffice, as a suite of apps: for now Writer; Calc and Impress will follow
in the same repository. See README.md for status and limitations.

## Commands

- `npm run dev` (the Start Center at `/`, Writer at `/writer/`), `npm run dev:writer`, `npm run build`, `npm run typecheck`
- `npm test` (Vitest, `tests/unit`), `npm run test:e2e` (Playwright, runs against `dist/`, so build first;
  one project per app: `npm run test:e2e:writer` or `npx playwright test --project <app>`). The preview
  server's port is `E2E_PORT` (default 4173); a server already on it is reused, so give each worktree
  its own (`E2E_PORT=4181`) after checking it is free (`lsof -i :4181`)
- `npm run version:bump -- <major|minor|patch|beta|release|X.Y.Z[-pre]>`: set the version in
  `package.json`, `package-lock.json` and `changelog.md` (`--dry-run` to preview). The app reads it
  from `package.json` through `src/lo/unotools/source/config/configmgr.ts`. The major version follows
  the LibreOffice release the port is based on (26 for 26.2).
- `npm run upstream:fetch`: materialise the pinned source in `upstream/core` (git-ignored)
- `npm run upstream:gen`: regenerate each app's `src/<app>/generated/upstream-ui.json` (Writer's, Calc's;
  the modules are described in `tools/upstream/gen-ui.ts`) and `src/shell/generated/` from upstream UI
  definitions (and LibreOffice's Writer templates, packed from `extras/source/templates` into
  `src/writer/generated/templates/`)
- `npm run upstream:check`: validate `@upstream` headers and rewrite `ports.lock.json`
- `npm run upstream:report`: measure port coverage
- `npm run upstream:migrate -- <tag> [--diff]`: list ports affected by another release
- `node tools/build/gen-webfonts.ts`: regenerate `src/shell/generated/webfonts.json` (the Fontsource
  catalogue, offered fonts pinned) and fetch TeX Gyre Termes into `public/fonts/`
- `node tools/build/gen-icon-themes.ts`: regenerate `src/shell/generated/icons-<theme>.json` (the Fluent,
  Keyline and Material Line (line-md plus Material Symbols) icon themes from their `@iconify-json` packages; the command mappings and colours are in
  the script, Keyline's missing icons in `keyline-own.ts`)
- `node tools/build/render-pages.ts <file> <outdir>`: print a document as the app does (SVG pages) to
  Chromium's PDF, plus PNG pages via `pdftoppm` (needs a build and `npx vite preview --port 4173`, or
  another server given as `BASE=http://localhost:<port>/`); spreadsheets (.ods, .ots, .fods, .csv) print in
  Calc, every sheet. Compare text positions with a reference PDF via `pdftotext -bbox`. Reference documents
  and PDFs are in `specs/` (`specs/calc/<name>.pdf` is LibreOffice's PDF of `<name>.ods`).
  In `specs/writer/`, `<name>_word.pdf` is Word's own PDF of `<name>.docx` and `<name>_word_export.*`
  is the document as Word saved it in another format (ODT, DOTX).

## Layout

The repository is the monorepo of the Workspace Office suite. Vite's root is `src/`: every app is a
page of a multi-page build, `src/<app>/index.html` becoming `dist/<app>/index.html`.

- `src/lo/`: the port, shared by every app. **Paths mirror the LibreOffice tree** (`src/lo/sw/inc/bparr.ts`
  is `sw/inc/bparr.hxx`); Writer is `sw`, Calc will be `sc`, Impress `sd`, next to the shared modules.
- `src/languagetool/`: the LanguageTool port (see its `PORTING.md`), shared.
- `src/shell/` (`@shell/…`): the web shell every app shares: i18n, storage, settings, fonts, icons,
  spelling, LanguageTool client, keymaps, the base controller (`appcontroller.ts`), the shared command
  table (`commands.ts`), the shared React UI and CSS (`ui/`), the service worker (`pwa/`), the app list
  (`apps.ts`), `suiteUrl()` for files in `public/`. Not a port; must not import from an app.
- `src/writer/`: Writer's web shell (React UI, controller, `.uno:` command table, entry page). Not a port.
- `src/startcenter/` and `src/index.html`: the Start Center at the suite's root, listing the apps.
- `src/*/generated/`: generated from upstream; never edit by hand.
- `public/`: served from the suite's root (fonts, LanguageTool data, icons); `public/<app>/` holds an
  app's web manifest. From an app's page, reach these with `suiteUrl()`, not a page-relative URL.
- `tests/unit/`: Vitest; `tests/e2e/<app>/`: Playwright per app; `specs/<app>/`: reference documents.
- `tools/upstream/`: upstream tracking. `tools/build/`: build helpers.

## Working on this repository

- Work on every task on a new branch named by its kind: `feature/<name>`, `fix/<name>`,
  `improvement/<name>` (and so on), branched from `main`.
- Commit on that branch whenever a larger change is done and the tests pass.
- When the task is done, ask whether to merge the branch into `main`; after merging, ask whether
  to delete the merged branch. Never push without asking first.

## Porting rules

The goal is that an upstream diff can be applied to the TypeScript by reading it side by side.

- Keep upstream file paths and class, method and member names (`SwTextNode::InsertText`,
  `m_pSwpHints`). Do not rename to JS conventions in `src/lo/`.
- Overloads become one method with optional parameters. Keep the statement order and upstream comments.
- Every file in `src/lo/` starts with `// SPDX-License-Identifier: MPL-2.0` and one line per source:
  `// @upstream <path> <faithful|partial|reduced>`
  - `faithful`: statement-by-statement translation of the whole file
  - `partial`: faithful, but only some of the file's functions
  - `reduced`: same responsibility and names, simplified logic
  State honestly what a `reduced` port leaves out in a header comment.
- Read the upstream C++ before writing a port; do not reconstruct behaviour from memory.
- After changing ports, run `npm run upstream:check` and commit `ports.lock.json`.
- `src/lo/` must not import from `src/shell/` or an app (`src/writer/`), or use the DOM, apart from the canvas in `vcl` and `view`,
  so it stays testable in Node.
- TypeScript runs with `erasableSyntaxOnly`: no `enum`, no parameter properties. Use `as const` objects.

## Making a menu command work

Menus, toolbars and shortcuts come from upstream data. Register the command under its upstream
`.uno:` name in the app's `commands.ts` (`src/writer/commands.ts`); it then enables itself everywhere. Never register a no-op:
coverage is measured from that table.

## Adding an app (Calc, Impress)

1. Port its LibreOffice module into `src/lo/<module>/` (`sc`, `sd`) as the porting rules say.
2. Create `src/<app>/` with `index.html` and its shell, built from `src/shell/` as Writer is
   (`src/writer/controller.ts`, `ui/registry.tsx`, `ui/labels.ts`, `keymaps.ts`, `main.tsx`):
   - a controller extending `AppController` (`src/shell/appcontroller.ts`) with an `AppDescription`
     (id, name, own and other file types) and its hooks (`document`, `newDoc`, `installDocument`,
     `attach`, `readPackage`, `exportPackage`, `importFile`, `exportFile`, view positions). The base
     does storage (`lo-<app>`), autosave, versions, save, download, open, queries, UI mode and zoom;
   - a command table spreading `SHELL_COMMANDS` (`src/shell/commands.ts`);
   - its UI from its `upstream-ui.json` through `createAppUi` (`src/shell/ui/labels.ts`), with a
     `KeymapStore` under `<app>:keymap` and its keymap templates;
   - an `AppRegistry` (`src/shell/ui/registry.ts`: commands, UI, popup controllers, Options pages,
     ribbon) passed to `setAppRegistry` before rendering; the shared components (`src/shell/ui/`:
     menus, toolbars, ribbon, dialogs (`ShellDialogs`), message bar) read it;
   - `@shell/ui/shell.css` before its own stylesheet, which lays out its `.app` grid.
   Settings LibreOffice shares across modules use `suiteKey()` (`src/shell/settings.ts`), per-module
   ones `<app>:<name>`. Writer-only code stays in `src/writer/`; move code to `src/shell/` once
   another app needs it.
3. Register it in `src/shell/apps.ts` (the build, the Start Center and Playwright's projects follow), add
   `app.<id>` and `app.<id>.description` to every i18n catalogue, and `public/<app>/manifest.webmanifest`.
4. Put its browser tests in `tests/e2e/<app>/` and its reference documents in `specs/<app>/`.

## Differences from LibreOffice

Every change that makes the application work or look different from desktop LibreOffice
(a renamed, moved, removed or added command, other defaults, other behaviour) must be documented
in `DIFFERENCES.md` in the same commit: what LibreOffice does, what this application does, and why.
Not-yet-ported features belong in the README instead.

## Upgrading to a new LibreOffice release

1. `npm run upstream:migrate -- <tag> --diff` lists each affected TypeScript file with its C++ diff.
2. Apply those diffs to the matching ports.
3. Update `tag` and `commit` in `upstream.json`, then run `upstream:fetch`, `upstream:gen`, `upstream:check`.
4. Run the tests and add an entry to `changelog.md`.

## Gotchas

- The node array is: inserts area (footnote sections), autotext area (header and footer sections),
  then the body. Use `BodyStart()`, `FirstTextNode()` and `AreaOf()`, never index 0 or 1.
- Text attributes with content (fields, footnotes, images, comments) are a `CH_TXTATR_BREAKWORD`
  placeholder character carrying the attribute. They must never expand when typing next to them.
- Undo snapshots node ranges. An operation that touches two places (a footnote section and its
  anchor) must use `recordedRanges`, and the nodes around each range must survive the operation.
- `npm test` covers the model; for importers, also run upstream's test documents through them
  (`sw/qa/extras/*/data`), which finds real bugs.

- Layout measures with font size numerically in twips; painting scales the canvas. Do not measure
  in device pixels, or line breaks will vary with zoom.
- `SwPaM` models "no selection" as point equal to mark, so moving the point without `DeleteMark()`
  creates a selection.
- `SwPosition` registers with its node. Call `Release()` on temporary positions.
- Importers must report unsupported content through `ImportResult.lost`. A document with losses must
  not keep its file handle, so saving cannot overwrite the richer original.
- Any `.uno:` shortcut for copy, cut or paste must stay native: only native events may use the clipboard.
- Flys: as-character graphics are placeholder characters (`RES_TXTATR_FLYCNT`); paragraph and
  character anchored flys live on their paragraph (`m_aAnchoredFlys`), page anchored ones in
  `SwDoc.m_aPageFlys`. Formats are replaced, never mutated, so undo snapshots can share them.
- Tracked changes are text attributes (`RES_TXTATR_REDLINE`) and paragraph end marks
  (`RES_PARATR_REDLINE`); the redline table is computed from them. Never mutate a shared
  `SwRedlineData`.
- Header and footer sections belong to a page style (`m_sPageDesc` on the start node); pass the
  style name to `FindAreaSection` and `SetHeaderFooter`.
- Undo restore rebuilds nodes when the node count changed: hold on to indices or look nodes up
  again after `Undo()`, not to `SwTextNode` objects.
- The Hunspell emscripten module is a thenable: never resolve a promise with it directly.
- React: never set state from an effect that runs after every edit (it once made a held-down key
  end in "Maximum update depth exceeded"); write to the DOM through a ref instead.
- DOCX `w:docDefaults` are the pool defaults (`doc.m_aDefaults`), not Normal's properties: a Word
  style without `w:basedOn` has no parent and must not inherit from "Standard".
- Word layout depends on document settings (`m_bParaSpaceMax`, `m_bTabOverSpacing`, ...): set them
  in the importer as upstream's writerfilter does, and keep them through ODT `settings.xml`.
- Reference rendering: `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf`
  (with `-env:UserInstallation=file://<tmp>`) gives LibreOffice's own PDF of a spec document.
- The shell's own texts go through `t()` in `src/shell/i18n.ts`, with every key in every catalogue.
- An app lives one directory below the suite's root: `./fonts/…` from its page is `writer/fonts/…`. Use
  `suiteUrl()` (`src/shell/paths.ts`) for anything in `public/`.
