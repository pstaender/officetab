# OfficeTab

OfficeTab is a browser-native port of LibreOffice, as a suite of apps: for now only Writer; Calc and
Impress will follow in this repository.
It runs entirely in the browser. There is no server: the document model, layout and file filters are TypeScript translated from the LibreOffice C++ sources,
and text is painted on a `<canvas>`. The only WebAssembly is Hunspell, LibreOffice's spell checker,
which loads with the first spelling dictionary. Grammar checking is LanguageTool, ported from Java to
TypeScript as well (`src/languagetool/`), running in a Web Worker.

Version **26 (Beta)**, based on **LibreOffice 26.2.7.3** (`08dfbf04dcac895fc3a8d30dbf5a00de1b9dda5e`).

## Status: early vertical slice

This is a working editor, but **not yet feature-equivalent to desktop Writer**. Run
`npm run upstream:report` for current numbers. At the time of writing:

- 289 of the 706 commands in Writer's menu work. The rest are shown greyed out.
- About 1.7 million lines of upstream C++ are in scope. 371 upstream files have a TypeScript
  counterpart, and most of those are deliberately *reduced* translations covering part of the file.

| Works today | Not ported yet |
| --- | --- |
| Typing, IME input, selection, clipboard (plain text, pasted images, and selected objects: images, formulas, shapes, frames), undo/redo | Drawing shapes |
| Paragraph and character formatting (with small capitals, shadow, outline, overline, Change Case), tab stops, borders, clone formatting | Generating alphabetical and user-defined indexes and bibliographies, and tables of contents from index entries (the entries and citations themselves work); the bibliography database |
| Paragraph and character styles: apply, edit, new and update from selection | Fields other than page number, page count, date, time, number ranges, cross-references, document information, statistics and variables; date and time formats of fields; the Fields dialog's Functions and Database pages; a number range's chapter level; editing fields (Edit > Fields) |
| Bullets and numbering with levels, restarts, the pool list styles, moving items with sub-items, the Bullets and Numbering dialog; number types such as 1st, One, First, 01, ①, Greek, Cyrillic and CJK counting | Outline numbering, list style editing, image bullets; number names only in English, German and Chinese |
| Tables: insert, rows, columns, cell selection, merging and splitting cells and tables, sizes (also by dragging borders), Table Properties, AutoFormat styles, sorting, converting text, number formats and recognition, formulas and AutoSum, rows across pages, captions | Captions of objects anchored as characters |
| Headers and footers (on or off per page style or for all of them, the header/footer button on the page with its menu, borders and background), the page number wizard, footnotes, endnotes, comments, table of contents (its entries link to the headings), index entries (Insert and Edit Index Entry, for the table of contents, the alphabetical index and user-defined indexes; also in ODT, and in DOCX as XE and TC fields), citations (Insert and Edit Citation with the document's bibliography entries, numbered or by short name; also in ODT, and in DOCX as CITATION), bookmarks (the Bookmark dialog: insert, go to, delete, rename, edit their text) and links into the document, cross-references (to reference marks, headings, numbered paragraphs, bookmarks, notes and captions; a click on one goes to its target as on a hyperlink), protecting fields and bookmarks (Tools > Protect Document), document information fields (title, subject, keywords, comments, author, dates, custom properties; fixed or updated) and statistics fields (pages in a numbering range, words, characters, paragraphs, tables, images, objects), variables (set and show variables, formulas, input fields with their dialog, number ranges with formulas, page variables, user fields; also in headers and footers, and in ODT and DOCX), the Fields dialog | Hyphenation, thesaurus; hidden bookmarks and their conditions; of a header's or footer's format: left and right margins, a fixed height (AutoFit off), line styles other than solid, shadows and backgrounds other than a colour |
| Images and text frames anchored to page, paragraph or character, with text wrap; image mode, transparency and colour adjustments; captions of images, frames, formulas and shapes; text boxes and vertical text; signature lines (not signing) | Tracked formatting changes |
| Sections and columns (balanced), page styles with follow styles and renumbering, Insert > Content from Document (ODT, DOCX, Word 97-2003, HTML, Markdown and text files, with their footnotes, comments, bookmarks, objects and missing styles) | Hidden text, drop caps |
| Track changes: record, show, accept, reject, manage | RTF export |
| Spell checking in 152 languages, dictionaries downloaded on demand; spelling and grammar checking with LanguageTool (Tools > Options > LanguageTool) in the browser for English and German, or on a LanguageTool server for its languages | Vertical text, Asian layout |
| Right-to-left and mixed-direction text | Encrypted documents |
| Line breaking, justification, line spacing, pagination with widows, orphans, keep-with-next | |
| Find and replace, word count, zoom (also by pinching), page setup, context menus, Help > Search Commands (Ctrl+/ or Shift+Esc) | |
| The Navigator (F5): headings, tables, frames, images, objects, bookmarks, sections, hyperlinks, indexes, comments, fields, footnotes and endnotes; Navigate By with Previous and Next; Go to Page; promoting, demoting and moving headings with their text | Dragging headings, the Navigator's context menu and its buttons for content other than headings, headings in frames, headers and footers, the global document view |
| View > Paper View and Screen View (LibreOffice's Normal and Web view), rulers (page margins, paragraph indents and tab stops, dragged as in Writer; vertical ruler with the top and bottom margins), Grid and Helplines (display grid, snap to grid, helplines while moving) | Table columns and text columns on the rulers, the rulers' context menus, Screen View saved with the document, the grid's options under Tools > Options |
| Icon themes: Fluent UI System Icons (outline, the default, or colour), Colibre, Keyline Icons, Material Line Icons (Tools > Options > View) | Other LibreOffice icon themes |
| A ribbon (Writer's tabbed notebookbar with contextual tabs, the default) or the classic menus and toolbars, chosen under Menu | The other notebookbar variants, customising toolbars |
| Document properties (title, subject, keywords, dates, revision, editing time) in ODT and DOCX, Graphic Size Check | Custom properties, document statistics |
| ODT, DOCX, HTML, Markdown and TXT open and save, printing (and PDF through the print dialog), autosave (File > Autosave), offline PWA | |
| File > Versions: versions stored in the ODT as LibreOffice does (save with a comment, show, open, delete, save on closing); with autosave, Save makes a version (see DIFFERENCES.md) | Comparing versions |
| Templates: the template manager (categories, search, thumbnails, open, edit, default template for new documents, rename, move, import, export), Save as Template, Edit Template, Load Styles from Template, and LibreOffice's own Writer templates | Frame styles; Load Styles does not bring the content of page styles' headers and footers; the query to update a document's styles from its changed template |
| Word 6.0, 95 and 97-2003 (.doc, .dot) open: text, styles, character and paragraph formatting, tables (nested too), lists, headers and footers, page size and margins, pictures, floating objects and text boxes, footnotes and endnotes, comments, tracked changes, hyperlinks, tables of contents and form fields (text, check boxes, drop-downs; a click toggles a check box) | In .doc files: editing a text form field's text in place or choosing a drop-down entry; fields other than page numbers, page counts, sequences, links, tables of contents and form fields (their last result is kept as text), arcs and freeforms, OLE objects, Word 6 drawn objects; Word 2.0 and older |
| Formulas (LibreOffice Math): the formula language, layout, the formula editor, Word equations and ODT formula objects | The visual formula editor, user symbols, formulas anchored other than as character |

**Calc** (at `calc/`) is the second app: a spreadsheet view on the ported core (`src/lo/sc`: the
document model, the formula compiler and interpreter with most built-in functions, recalculation,
and the document functions with undo). Working: the grid painted on a canvas from the ported
`ScViewData`, `ScDocument::FillInfo` and `ScOutputData` (backgrounds, grid, borders, text alignment,
overflow into empty neighbours and clipping, wrapped and multi-line text, number format colours,
`###` for numbers that do not fit, merged cells), column and row headers with resizing by dragging
and double-click for the optimal size, sheet tabs (insert, delete, rename, move/copy by dragging or
dialog, tab colour, hide/show), frozen panes, zoom; selection and navigation (Shift and Ctrl
selections, whole rows and columns, Ctrl+arrows to data edges, Home/End, Page Up/Down, Ctrl+Page
Up/Down, Enter and Tab as the input options say, the Name Box); ODS (with its view settings), OTS, flat FODS and CSV open and save, autosave and versions as in Writer;
cell input in the cell and the formula
bar (formula references in colour, pointing at cells to insert references, function name completion
and argument tips, AutoInput, AutoSum and the sum menu, F4 for absolute references); clipboard (text
and HTML tables; within the app with formulas and formats), Paste Special basics; insert and delete
cells, rows and columns; fill down/right/up/left and the AutoFill handle; merging; formatting from the
toolbar, ribbon and Format Cells dialog (numbers, font, effects, alignment, borders, background); cell
styles; sort; find and replace; the status bar's selection functions; database ranges (Define and
Select Range), AutoFilter with its popup (sort, search, values, Top 10, empty and not empty, Standard
Filter), the Standard Filter dialog, Reset Filter and the filtered records in the status bar;
subtotals; validity (the dialog, the list, input help and error alerts); conditional formatting with
cell value and formula conditions; the Analysis and Date add-in functions; Tools > Options pages
(General, View, Calculate, Formula) and Excel keyboard templates.

| Calc: not ported yet | |
| --- | --- |
| Files | XLSX (in progress); the Text Import dialog; printing and PDF |
| Cells | Rich text within a cell, rotated and stacked text, shrink to fit, comments, hyperlinks; in validity, macros on errors; in conditional formatting, colour scales, data bars, icon sets and date conditions (reported as lost when a file has them) and the easy-condition submenu |
| Data | Pivot tables, outlines (subtotals make no row groups), Data > More Filters > Advanced Filter, filtering by colour and the date tree in the AutoFilter, Refresh Range (RepeatDB), the output of a filter elsewhere keeping the formats and sizing the range, sort and import settings of database ranges in ODS, named range management (named ranges can be used in the Name Box) |
| View | Split windows that are not frozen, page break view, charts and drawing objects, value highlighting, the Navigator and the sidebar, the Function Wizard |
| Formula options | Other separators than Calc's own (the formula syntax can be chosen) |

**Opening a file with unsupported content:** the missing content is listed in a notice, and the
document opens as a copy, so saving can never overwrite your original file. Word documents always
open as a copy; Download As writes them as Word or OpenDocument.

**Differences from desktop Writer** that come from running in a browser (storage and autosave,
Download instead of Save a Copy, the ribbon by default, printing, fonts) are listed in
[DIFFERENCES.md](DIFFERENCES.md).

**Robustness:** the filters are exercised against the 1483 DOCX and 189 ODT test documents in
LibreOffice's own test data (import, layout, and round trips through ODT and DOCX). All open except
encrypted and deliberately malformed files, and the DOCX round trip keeps their text.

## Run it

Requires Node 24 or newer.

```sh
npm install
npm run dev          # development server: the Start Center at /, Writer at /writer/
npm run dev:writer   # the same, opening Writer
npm run build        # type-checks, then writes dist/ (every app)
npm test             # unit tests
npx playwright install chromium && npm run test:e2e   # browser tests (needs a build)
npm run test:e2e:writer                                # only Writer's browser tests
```

### Repository layout

This repository is the monorepo of the whole suite. LibreOffice's modules are ported once and shared,
and each app is a page of its own in one multi-page build:

| Path | What | Built to |
| --- | --- | --- |
| `src/lo/` | The LibreOffice port, mirroring LibreOffice's tree (`sw` is Writer; `sc` and `sd` will be Calc and Impress) | (shared chunks) |
| `src/languagetool/` | The LanguageTool port | (a Web Worker) |
| `src/shell/` | The web shell all apps share: texts, storage and settings, fonts, icons, spelling, the base controller, the shared menus, toolbars, ribbon and dialogs, service worker, the list of apps | (shared chunks) |
| `src/startcenter/`, `src/index.html` | The Start Center, listing the apps | `dist/index.html` |
| `src/writer/` | Writer: its interface, commands and entry page | `dist/writer/` |
| `src/calc/generated/` | Calc's UI data from upstream (its app is to follow) | |
| `public/` | Fonts, LanguageTool's data, icons; `public/<app>/` an app's web manifest | `dist/` |
| `tests/unit/`, `tests/e2e/<app>/`, `specs/<app>/` | Unit tests, browser tests per app, reference documents per app | |

How to add an app is described in [CLAUDE.md](CLAUDE.md) ("Adding an app").

## Deploy

Copy `dist/` to any static web server, in any directory. No rewrites or special headers are needed.
The directory's own address shows the Start Center; Writer is at `writer/` below it.

Offline use and installation need a service worker, which browsers only allow on **HTTPS or
localhost**. Over plain HTTP the app still runs, but only while online. File System Access (saving
directly to a file on disk) is also limited to secure contexts and Chromium-based browsers; other
browsers download the file instead.

## Known limitations

- **Objects:** pictures and text frames are positioned and wrapped as Writer does, but a character
  anchor is positioned like a paragraph anchor, and text continued on another page only wraps
  around that page's objects. Drawing shapes are not ported.
- **WMF and EMF** pictures are drawn as SVG: EMF+ records, raster operations other than copy
  (except the XOR trick of old logos), pattern brushes and font metrics are approximated or skipped.
- **Columns** balance only when a section fits on one page.
- **Word layout:** Word's paragraph spacing, line spacing and table rules are followed where
  LibreOffice follows them, but fonts that are missing on the system (or the fallback font a
  symbol comes from) have other metrics, so lines can still differ by a point or two.
- **Spelling** dictionaries come from LibreOffice's dictionaries repository (through the jsDelivr
  CDN, large ones from GitHub) the first time a language is chosen in the status bar, and are then
  kept in the browser for offline use. The user dictionary is kept in this browser only.
- **LanguageTool** in the browser is LanguageTool 6.8 ported to TypeScript (see
  `src/languagetool/PORTING.md`): its own rules, word lists and dictionaries, loaded from the pinned
  release the first time a language is checked and then kept offline. What needs a server is left
  out: n-gram and neural rules, premium rules, remote rules. English and German are ported (German
  spelling runs on Hunspell in WebAssembly); other languages use the spelling dictionaries, or a
  LanguageTool server if one is configured. The first check of a language in a session takes a few
  seconds (German about ten) while LanguageTool builds its data; later checks take milliseconds.
- **Right-to-left text** follows a reduced Unicode Bidirectional Algorithm (no explicit embeddings
  or isolates); justification is not applied to lines with mixed directions.
- **Track changes** records insertions, deletions and paragraph breaks, not formatting changes.
- **AutoCorrect** (Tools > AutoCorrect: while typing, Apply, the options dialog and word completion)
  follows Writer, but the transliteration to Old Hungarian is not ported, Apply and Edit Changes
  records only text changes (not new styles and formatting), tables drawn with `+---+` get columns
  of equal width, and text blocks with formatting in the replacement table are not supported.
  URL, DOI and ordinal-suffix recognition cover the common cases (ordinal suffixes in English,
  French, Spanish, Italian, Portuguese, Galician and Catalan).

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
  available fonts" is on. With font previews on (the default, unavailable with all fonts listed),
  the list shows each name in its font, loading only the Latin regular face of the entries in view,
  and lists the five fonts chosen last first.
- **Line breaking** approximates ICU rules, because browsers expose no line-break iterator.
- **Printing** paints every page as SVG: vector graphics, with the text as text in the document's
  fonts. The print dialog's "Save as PDF" gives a PDF with those fonts embedded. Writer's own PDF
  export is switched off for now (its port is kept): it only knew the 14 standard PDF fonts.
- **Long documents** (a thousand pages and more) take a few seconds to open, behind a loading
  indicator: the whole document is laid out at once, after its web fonts have loaded (for at
  most three seconds), where Writer lays out the pages in view first and the rest while idle.
  A change lays out again from a page before it until the pages are as before; undo and redo,
  style and page style changes, linked frames and objects positioned on the page lay out the
  whole document.
- **HTML** is read and written as LibreOffice's "HTML Document (Writer)" filter does, with images
  embedded in the page. Images linked by URL, forms, scripts, frames, embedded objects and image
  maps are not read (the document opens as a copy); images are always anchored as characters, and
  DIVs do not become sections. Drawing shapes, formulas and comments are not written, nor the
  headers and footers of first and left pages.
- **Screen View** follows the visible width, but does not widen for tables or objects wider than
  the window, and is not stored with the document: documents always open in Paper View.
- **Rulers:** in a table cell or a text frame the cell's or frame's edges are shown but cannot be
  dragged; table columns and rows are not shown on the rulers, and dragging with Ctrl
  (proportionally) is not ported.
- **Desktop only** for now.

## Tracking upstream

Every port declares its C++ origin, and `ports.lock.json` records the exact upstream blob. To move
to a new LibreOffice release, see "Upgrading to a new LibreOffice release" in [CLAUDE.md](CLAUDE.md).

## Versioning

OfficeTab's major version follows the LibreOffice release it is based on: 26 for LibreOffice 26.2.
The version lives in `package.json` (`26.0.0-beta`, shown as "26 (Beta)"). Change it with

```sh
npm run version:bump -- minor           # 26.0.0-beta -> 26.1.0-beta
npm run version:bump -- release         # 26.0.0-beta -> 26.0.0
npm run version:bump -- major --beta    # 26.0.0 -> 27.0.0-beta
npm run version:bump -- 26.0.1 --dry-run
```

which updates `package.json`, `package-lock.json` and the unreleased heading of `changelog.md`.

## License

Mozilla Public License 2.0, see [LICENSE](LICENSE); this is a derivative work of LibreOffice.
Toolbar icons are from LibreOffice's Colibre theme (CC0); the alternative Material Line Icons theme
is [line-md](https://github.com/cyberalien/line-md) by Vjacheslav Trushkin (MIT), completed with Google's
[Material Symbols](https://fonts.google.com/icons) (Apache 2.0), and Keyline Icons are
from [Iconify](https://icon-sets.iconify.design/keyline-icons/) (MIT), completed with this project's own icons
in their style (`tools/build/keyline-own.ts`). Fluent UI System Icons are by
[Microsoft](https://github.com/microsoft/fluentui-system-icons) (MIT).
