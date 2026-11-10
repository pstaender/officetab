# LibreOffice Writer for the Web

A TypeScript port of LibreOffice Writer that runs entirely in the browser. There is no server and
no WebAssembly: the document model, layout and file filters are TypeScript translated from the
LibreOffice C++ sources, and text is painted on a `<canvas>`.

Based on **LibreOffice 26.2.7.3** (`08dfbf04dcac895fc3a8d30dbf5a00de1b9dda5e`).

## Status: early vertical slice

This is a working editor, but **not yet feature-equivalent to desktop Writer**. Run
`npm run upstream:report` for current numbers. At the time of writing:

- 101 of the 562 commands in Writer's menu work. The rest are shown greyed out.
- About 1.7 million lines of upstream C++ are in scope. 104 upstream files have a TypeScript
  counterpart, and most of those are deliberately *reduced* translations covering part of the file.

| Works today | Not ported yet |
| --- | --- |
| Typing, IME input, selection, clipboard (plain text and pasted images), undo/redo | Frames, shapes, text wrap around images |
| Paragraph and character formatting, paragraph styles, tab stops, clone formatting | Character styles, sections, columns, TOC and indexes |
| Bullets and numbering with levels, restarts and the pool list styles | Fields other than page number, page count, date and time |
| Tables: insert, rows, columns, merged cells, nested tables, heading rows | Splitting table rows across pages, table properties dialog |
| Headers and footers, footnotes, comments | Endnotes, different first/left page headers, more than one page style |
| Hyperlinks, images anchored as character, special characters, formatting marks | Track changes, spell check, hyphenation, right-to-left text |
| Line breaking, justification, line spacing, pagination with widows, orphans, keep-with-next | Paragraph borders, small capitals, hidden text |
| Find and replace, word count, zoom (also by pinching), page setup | DOCX, RTF and HTML export |
| ODT and TXT open/save, DOCX import, PDF export, autosave, offline PWA | Encrypted documents |

**Opening a file with unsupported content:** the missing content is listed in a notice, and the
document opens as a copy, so saving can never overwrite your original file. Word documents always
open as a copy; Save As stores them as ODT.

**Robustness:** the importers are exercised against the 1483 DOCX and 189 ODT test documents in
LibreOffice's own test data (import, layout and an ODT round trip). All open except encrypted and
deliberately malformed files.

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

- **Images** are always anchored as characters. Images that an ODT file positions on the page or
  wraps text around are shown in the line they are anchored to, and the file opens as a copy.

- **Accessibility:** canvas text is invisible to screen readers, so a visually hidden mirror of the
  document (headings, lists, tables, image descriptions, footnotes, comments) is kept in the page,
  and the line or character the caret moves over is announced. Editing feedback is still basic
  compared with desktop Writer's accessibility layer.
- **Fonts:** only fonts installed on the system are used. Liberation fonts fall back to their
  metric-compatible equivalents (Times New Roman, Arial, Courier New).
- **Line breaking** approximates ICU rules, because browsers expose no line-break iterator.
- **Printing** rasterises pages at 200 DPI through the browser's print dialog. **PDF export** writes
  vector text with the standard PDF fonts (metric-compatible with the Liberation fonts) stretched to
  the layout's widths; text those fonts cannot encode, such as CJK, is embedded as an image.
- **Desktop only** for now.

## Tracking upstream

Every port declares its C++ origin, and `ports.lock.json` records the exact upstream blob. To move
to a new LibreOffice release, see "Upgrading to a new LibreOffice release" in [CLAUDE.md](CLAUDE.md).

## License

Mozilla Public License 2.0, see [LICENSE](LICENSE); this is a derivative work of LibreOffice.
Toolbar icons are from LibreOffice's Colibre theme (CC0).
