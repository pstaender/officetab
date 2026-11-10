# LibreOffice Writer for the Web

A TypeScript port of LibreOffice Writer that runs entirely in the browser. There is no server: the
document model, layout and file filters are TypeScript translated from the LibreOffice C++ sources,
and text is painted on a `<canvas>`. The only WebAssembly is Hunspell, LibreOffice's spell checker,
which loads with the first spelling dictionary.

Based on **LibreOffice 26.2.7.3** (`08dfbf04dcac895fc3a8d30dbf5a00de1b9dda5e`).

## Status: early vertical slice

This is a working editor, but **not yet feature-equivalent to desktop Writer**. Run
`npm run upstream:report` for current numbers. At the time of writing:

- 241 of the 706 commands in Writer's menu work. The rest are shown greyed out.
- About 1.7 million lines of upstream C++ are in scope. 246 upstream files have a TypeScript
  counterpart, and most of those are deliberately *reduced* translations covering part of the file.

| Works today | Not ported yet |
| --- | --- |
| Typing, IME input, selection, clipboard (plain text and pasted images), undo/redo | Drawing shapes, contour wrap, chained frames |
| Paragraph and character formatting (with small capitals, shadow, outline, overline, Change Case), tab stops, borders, clone formatting | Alphabetical indexes, bibliography |
| Paragraph and character styles: apply, edit, new and update from selection | Fields other than page number, page count, date and time |
| Bullets and numbering with levels, restarts, the pool list styles, moving items with sub-items, the Bullets and Numbering dialog | Outline numbering, list style editing, image bullets |
| Tables: insert, rows, columns, cell selection, merging and splitting cells and tables, sizes, Table Properties, AutoFormat styles, sorting, converting text, number formats and recognition, formulas and AutoSum, rows across pages, captions | Captions of images and frames |
| Headers and footers, footnotes, endnotes, comments, table of contents | Hyphenation, thesaurus, grammar checking |
| Images and text frames anchored to page, paragraph or character, with text wrap; image mode, transparency and colour adjustments | Tracked formatting changes |
| Sections and columns (balanced), page styles with follow styles and renumbering | Hidden text, drop caps |
| Track changes: record, show, accept, reject, manage | RTF and HTML export |
| Spell checking in 152 languages, dictionaries downloaded on demand | Vertical text, Asian layout |
| Right-to-left and mixed-direction text | Encrypted documents |
| Line breaking, justification, line spacing, pagination with widows, orphans, keep-with-next | |
| Find and replace, word count, zoom (also by pinching), page setup | |
| Document properties (title, subject, keywords, dates, revision, editing time) in ODT and DOCX, Graphic Size Check | Custom properties, document statistics |
| ODT, DOCX, Markdown and TXT open and save, printing (and PDF through the print dialog), autosave, offline PWA | |

**Opening a file with unsupported content:** the missing content is listed in a notice, and the
document opens as a copy, so saving can never overwrite your original file. Word documents always
open as a copy; Save As stores them as Word or OpenDocument.

**Robustness:** the filters are exercised against the 1483 DOCX and 189 ODT test documents in
LibreOffice's own test data (import, layout, and round trips through ODT and DOCX). All open except
encrypted and deliberately malformed files, and the DOCX round trip keeps their text.

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

- **Objects:** pictures and text frames are positioned and wrapped as Writer does, but a character
  anchor is positioned like a paragraph anchor, and text continued on another page only wraps
  around that page's objects. Drawing shapes are not ported.
- **Columns** balance only when a section fits on one page.
- **Word layout:** Word's paragraph spacing, line spacing and table rules are followed where
  LibreOffice follows them, but fonts that are missing on the system (or the fallback font a
  symbol comes from) have other metrics, so lines can still differ by a point or two.
- **Spelling** dictionaries come from LibreOffice's dictionaries repository (through the jsDelivr
  CDN, large ones from GitHub) the first time a language is chosen in the status bar, and are then
  kept in the browser for offline use. The user dictionary is kept in this browser only.
- **Right-to-left text** follows a reduced Unicode Bidirectional Algorithm (no explicit embeddings
  or isolates); justification is not applied to lines with mixed directions.
- **Track changes** records insertions, deletions and paragraph breaks, not formatting changes.

- **Accessibility:** canvas text is invisible to screen readers, so a visually hidden mirror of the
  document (headings, lists, tables, image descriptions, footnotes, comments) is kept in the page,
  and the line or character the caret moves over is announced. Editing feedback is still basic
  compared with desktop Writer's accessibility layer.
- **Fonts:** a font the system lacks is drawn with its replacement from the font profile in
  Tools > Options: *LibreOffice* (LibreOffice's metric-compatible table, e.g. Calibri → Carlito,
  with Arimo, Tinos and Cousine standing in for the Liberation fonts), *Google Fonts* (the default:
  Office fonts → open Google Fonts, Inter, TeX Gyre Termes and Fira Code as defaults) or your own
  copies, which can be exported and imported as JSON. Web fonts come from the Fontsource packages
  of all Google Fonts on the jsDelivr CDN (TeX Gyre Termes from the app itself) when a document
  uses them, and are kept for offline use. The font list shows a selection unless "Show all
  available fonts" is on.
- **Line breaking** approximates ICU rules, because browsers expose no line-break iterator.
- **Printing** paints every page as SVG: vector graphics, with the text as text in the document's
  fonts. The print dialog's "Save as PDF" gives a PDF with those fonts embedded. Writer's own PDF
  export is switched off for now (its port is kept): it only knew the 14 standard PDF fonts.
- **Desktop only** for now.

## Tracking upstream

Every port declares its C++ origin, and `ports.lock.json` records the exact upstream blob. To move
to a new LibreOffice release, see "Upgrading to a new LibreOffice release" in [CLAUDE.md](CLAUDE.md).

## License

Mozilla Public License 2.0, see [LICENSE](LICENSE); this is a derivative work of LibreOffice.
Toolbar icons are from LibreOffice's Colibre theme (CC0).
