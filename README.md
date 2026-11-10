# LibreOffice Writer for the Web

A TypeScript port of LibreOffice Writer that runs entirely in the browser. There is no server and
no WebAssembly: the document model, layout and file filters are TypeScript translated from the
LibreOffice C++ sources, and text is painted on a `<canvas>`.

Based on **LibreOffice 26.2.7.3** (`08dfbf04dcac895fc3a8d30dbf5a00de1b9dda5e`).

## Status: early vertical slice

This is a working editor, but **not yet feature-equivalent to desktop Writer**. Run
`npm run upstream:report` for current numbers. At the time of writing:

- 56 of the 551 commands in Writer's menu work. The rest are shown greyed out.
- About 1.7 million lines of upstream C++ are in scope. 64 upstream files have a TypeScript
  counterpart, and most of those are deliberately *reduced* translations covering part of the file.

| Works today | Not ported yet |
| --- | --- |
| Typing, IME input, selection, clipboard (plain text), undo/redo | Tables, images, frames, shapes |
| Paragraph and character formatting, paragraph styles | Lists and numbering, sections, columns |
| Line breaking, justification, tabs, line spacing | Headers, footers, footnotes, fields, TOC |
| Pagination with widows, orphans, keep-with-next, page breaks | Track changes, comments, hyperlinks |
| Find and replace, word count, zoom, page setup | Spell check, hyphenation, right-to-left text |
| ODT and TXT open/save, autosave to the browser, offline PWA | DOCX, RTF, HTML, PDF export |

**Opening an ODT with unsupported content:** the missing content is listed in a notice, and the
document opens as a copy, so saving can never overwrite your original file.

## Run it

Requires Node 24 or newer.

```sh
npm install
npm run dev          # development server
npm run build        # type-checks, then writes dist/
npm test             # unit tests
npx playwright install chromium && npm run test:e2e   # browser tests (needs a build)
```

## Deploy

Copy `dist/` to any static web server, in any directory. No rewrites or special headers are needed.

Offline use and installation need a service worker, which browsers only allow on **HTTPS or
localhost**. Over plain HTTP the app still runs, but only while online. File System Access (saving
directly to a file on disk) is also limited to secure contexts and Chromium-based browsers; other
browsers download the file instead.

## Known limitations

- **Accessibility:** canvas text is invisible to screen readers. This is the main cost of canvas
  rendering, and a parallel accessibility tree is still to be built.
- **Fonts:** only fonts installed on the system are used. Liberation fonts fall back to their
  metric-compatible equivalents (Times New Roman, Arial, Courier New).
- **Line breaking** approximates ICU rules, because browsers expose no line-break iterator.
- **Printing** rasterises pages at 200 DPI through the browser's print dialog.
- **Desktop only** for now.

## Tracking upstream

Every port declares its C++ origin, and `ports.lock.json` records the exact upstream blob. To move
to a new LibreOffice release, see "Upgrading to a new LibreOffice release" in [CLAUDE.md](CLAUDE.md).

## License

Mozilla Public License 2.0, see [LICENSE](LICENSE); this is a derivative work of LibreOffice.
Toolbar icons are from LibreOffice's Colibre theme (CC0).
