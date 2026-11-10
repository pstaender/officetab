# LibreOffice Writer for the Web

TypeScript port of LibreOffice Writer. See README.md for status and limitations.

## Commands

- `npm run dev`, `npm run build`, `npm run typecheck`
- `npm test` (Vitest, `tests/unit`), `npm run test:e2e` (Playwright, runs against `dist/`, so build first)
- `npm run upstream:fetch`: materialise the pinned source in `upstream/core` (git-ignored)
- `npm run upstream:gen`: regenerate `src/app/generated/` from upstream UI definitions
- `npm run upstream:check`: validate `@upstream` headers and rewrite `ports.lock.json`
- `npm run upstream:report`: measure port coverage
- `npm run upstream:migrate -- <tag> [--diff]`: list ports affected by another release

## Layout

- `src/lo/`: the port. **Paths mirror the LibreOffice tree** (`src/lo/sw/inc/bparr.ts` is `sw/inc/bparr.hxx`).
- `src/app/`: web shell (React UI, `.uno:` command table, storage, PWA). Not a port.
- `src/app/generated/`: generated from upstream; never edit by hand.
- `tools/upstream/`: upstream tracking. `tools/build/`: build helpers.

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
- `src/lo/` must not import from `src/app/` or use the DOM, apart from the canvas in `vcl` and `view`,
  so it stays testable in Node.
- TypeScript runs with `erasableSyntaxOnly`: no `enum`, no parameter properties. Use `as const` objects.

## Making a menu command work

Menus, toolbars and shortcuts come from upstream data. Register the command under its upstream
`.uno:` name in `src/app/commands.ts`; it then enables itself everywhere. Never register a no-op:
coverage is measured from that table.

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
