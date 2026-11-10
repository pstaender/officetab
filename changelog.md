# Changelog

## 0.1.0 (unreleased)

First vertical slice of Writer, based on LibreOffice 26.2.7.3.

### Added

- Document model: node array, paragraphs, character attributes, paragraph styles, page style
- Editing: insert, delete, split and join paragraphs, undo and redo
- Layout: line breaking, alignment, justification, tabs, line spacing, pagination with widow, orphan
  and keep-with-next control, page breaks
- Canvas rendering at any zoom level, with viewport-only painting
- React interface whose menus, toolbars, labels, icons and shortcuts are generated from upstream
- Dialogs for character, paragraph and page formatting, find and replace, word count
- ODT and plain text import and export
- Autosave to IndexedDB, opening and saving files on disk, printing
- Installable PWA with offline support, hostable from any directory of a static web server
- Tooling that ties each port to its upstream source and reports what a new release changes
- Lists: bullets and numbering, levels (Tab and Shift+Tab), restart, uncounted entries, the pool
  list styles, `text:list` import and export
- Tables: insert dialog, typing and Tab navigation, insert and delete rows and columns, delete table,
  merged cells, nested tables, heading rows repeated on new pages, `table:table` import and export
- Hyperlinks: Hyperlink dialog (Ctrl+K), Ctrl/Cmd+click to open, `text:a` import and export
- Headers and footers with page number, page count, date and time fields
- Images anchored as character: insert from a file, paste, drop, `draw:frame` import and export
- Tab stops: left, right, centre and decimal, with fill characters
- Footnotes: insert, number, lay out above the footer with a separator, `text:note` import and export
- Comments: insert (Ctrl+Alt+C), edit, resolve and delete in a sidebar, commented ranges,
  `office:annotation` import and export, author name in Tools > Options
- DOCX import of styles, formatting, lists, tables, images, links, fields, headers, footers,
  footnotes, comments and page setup; Word files open as a copy
- PDF export (Export Directly as PDF)
- Formatting marks, Clone Formatting, Special Characters
- Paragraph borders, merged across equal neighbours
- Different headers and footers on the first page and on left pages
- Paragraph style editing (Edit Style, New Style from Selection, Update Selected Style) and
  character styles (Emphasis, Strong Emphasis, Quotation, Source Text)
- Tables of contents with Update Index
- An accessible mirror of the document for screen readers, with caret announcements
- Pinch zoom on the document zooms the document instead of the page
- Splash screen while the app and the last document load
- Images and text frames anchored to the page, a paragraph or a character, positioned by
  orientation and relation, with text wrap (none, before, after, parallel, through, optimal); they
  can be selected, moved, resized, re-anchored and edited in an Image/Frame dialog; Insert > Frame;
  ODT and DOCX import of positions, wrap, text boxes and `w:framePr` frames
- Track changes: record, show or hide, accept and reject (at the cursor, in the selection, all),
  next and previous change, Manage Changes; ODT import and export, DOCX import
- Sections with columns, hide and protect flags (Insert Section, Edit Sections); page and section
  columns with separator lines (Format > Columns); column breaks; balanced section columns
- Several page styles with follow styles, page number restarts and their own headers and footers;
  Insert > More Breaks > Manual Break; pages of different sizes; DOCX sections become page styles
- Endnotes, collected after the text on Endnote pages
- Save as Word (.docx)
- Spell checking: a text language field in the status bar loads LibreOffice's Hunspell dictionary
  for the language on demand; red waves under unknown words, suggestions on right-click, Ignore All,
  Add to Dictionary, Tools > Spelling, Automatic Spell Checking
- Right-to-left paragraphs (Format > Text direction) and mixed-direction text

### Fixed

- Dialogs now return keyboard focus to the document when they close
- Printing now includes table borders and backgrounds
- ODT export no longer writes an extra nested list for siblings at deeper list levels
- Splitting a paragraph keeps its page break on the first part
- DOCX import survives styles whose `basedOn` chain loops
- Word documents lay out like Word's own output (checked against `specs/writer/exam.docx` and
  Word's PDF of it): paragraphs inherit the spacing they do not set; the space between paragraphs
  is the larger of the two unless `w:doNotUseHTMLParagraphAutoSpacing` (`PARA_SPACE_MAX`);
  contextual spacing; the proportional line spacing of a paragraph's last line goes above the next
  paragraph, and below the last paragraph of a table cell or header; no upper spacing at the top of
  later pages in Word 2013 layout (`IsCollapseUpper`); footers sit at the bottom of their area
  (dynamic spacing); bottom-only paragraph borders keep their distance; table cells keep separate
  top and bottom margins; bullet labels use their level's font; inline pictures no longer scale
  the line spacing
- Cropped pictures (`a:srcRect`, `fo:clip`) show only their cropped part, in DOCX and ODT
- Frames in content controls of headers (Word's "Page X of Y" boxes) are no longer lost, and
  auto-width frames no longer wrap their last word
- A paragraph that starts with a page break now starts the new page
- Selecting an image no longer scrolls the view to the cursor
- Pressing a key repeatedly (holding Enter) no longer stops the app with a React update loop
- ODT import: the default paragraph style (`style:default-style`) applies, through document
  defaults (`SwDoc::SetDefault`); each margin inherits on its own (also indents in DOCX); a header
  without `fo:margin-bottom` has no spacing; text boxes without a width grow with their text; symbol
  font bullets (U+F0B7) become "•" (shared `fontcvt` recoding). `exam.odt` and `exam.docx` now lay
  out within 3 pt of LibreOffice's own PDFs of them
- A paragraph at the top of a page keeps its upper spacing only on the first page or after a break,
  and only with "Add paragraph and table spacing at tops of pages" (`PARA_SPACE_MAX_AT_PAGES`), as
  in Writer; ODF files without the setting have it off
- Drawing shapes: LibreOffice's custom shape engine (`EnhancedCustomShape2d` with its formula
  parser) draws the 199 LibreOffice and 187 OOXML preset shapes generated from upstream, on screen,
  in print and PDF. Word shapes (`wps:wsp`, with theme colours, adjustments, rotation, mirroring and
  text) and ODF shapes (`draw:custom-shape` with `draw:enhanced-geometry`, `draw:rect`,
  `draw:ellipse`, `draw:line`) are imported and exported, anchored or in the line. Groups,
  polygons, curves, connectors, gradients and shape text in the line are not ported yet
- Insert > Shape: the Basic, Symbol, Arrow, Star, Callout and Flowchart shape submenus (generated
  from upstream's shape toolbars) and Line; drag on the page to draw the shape (Shift keeps it
  square, a click gives the default size, Escape cancels). Shapes are shaded as in Writer
  (`nColorData`)
- The web shell's own texts can be translated (`src/app/i18n.ts`, English and German so far)
- Fonts: font replacement profiles in Tools > Options (LibreOffice's metric-compatible table, a
  Google Fonts profile with Inter, TeX Gyre Termes and Fira Code without ligatures as defaults, and
  the user's own, cloned, imported or exported as JSON; optionally used even for installed fonts).
  All Google Fonts (about 2000, Fontsource on jsDelivr) load when a document uses them, by
  script; the font list offers a selection and, on request, all of them. Fonts are cached for
  offline use
- Tools > Options lists its pages (User Data, Fonts, Writing Aids) beside the selected page; the
  Fonts page has tabs for replacement profiles, default fonts and the font list
- Primary dialog buttons keep their colour when hovered
- Shapes: Area and Line (fill and line colour, line width) and rotation in the shape's dialog
  (Format > Position and Size, Area, Line); a double click edits a shape's text, Escape selects the
  shape again
- Markdown: open (.md, .markdown) and Save As, ported from LibreOffice's own Markdown filter
  (sw/source/filter/md): headings, emphasis, strikethrough, code spans and blocks, links, lists
  with nesting, start numbers and task items, tables with column alignment, block quotes,
  horizontal rules, images as data: URLs, and tracked changes as `<ins>`/`<del>` on export.
  markdown-it (CommonMark with GitHub tables) stands in for md4c; raw HTML keeps its text
- DOCX shapes with their own geometry (a:custGeom: guides, arcs, curves, path coordinate
  spaces) are read instead of shown as rectangles; shapes without an OOXML preset are written as
  a:custGeom
- Dialogs accept measurements off the spinner step (4.23 cm was rejected)
- Open dialog: Delete all removes every document stored in the browser except the open one
- Printing offers the document's paper and orientation (A4 landscape, Letter, ...) to the print dialog
- ODT polygons, polylines and paths (draw:polygon, draw:polyline, draw:path with lines, curves and
  arcs) are read instead of dropped; they save as custom shapes in ODT and as a:custGeom in DOCX
- Gradient fills of shapes (linear, axial, radial, ellipsoid, square, rectangular, with several
  colours): read from DOCX (a:gradFill) and ODT (draw:gradient), painted and exported to PDF in
  steps as LibreOffice does, and saved in both formats
- Word documents closer to Word's own layout (checked with `specs/writer/course_schedule_template.docx`):
  styles without basedOn use the document defaults instead of Normal's font, table cells with
  vertical text (btLr, tbRl) and vertical alignment, footnote numbers superscript once and
  followed directly by their text, no empty paragraph before a leading table, empty paragraphs
  as high as their paragraph mark
- Word templates (.dotx) open as new documents
- Word's ODT exports: style:writing-mode sideways-lr/sideways-rl and the page margin Word writes
  as a negative header or footer height are read; DOCX table borders inherit side by side from
  the table style
- A document opened as a copy says that it can be edited right away, with Edit document and
  Save As buttons
- Printing paints pages as SVG (vector graphics, text in the document's fonts) instead of 200 DPI
  images; "Save as PDF" in the print dialog embeds those fonts. The own PDF export is switched off
- Format > Text: overline, shadow, outline font effect and small capitals (painted as upstream,
  in the Character dialog, read and written in ODT and DOCX), and Change Case: UPPERCASE,
  lowercase, Sentence case, Capitalize Every Word, tOGGLE cASE, Cycle Case, half-width,
  full-width, Hiragana and Katakana, keeping the text's formatting
- Format > Lists: promote and demote with subpoints, move items up and down (with or without
  subpoints), jump to the next or previous item on the same level, insert unnumbered entry and
  add to list
- Format > Align Text > Top, Center, Bottom: the vertical alignment of table cells, or of the
  selected object
- Format > Image: Crop (the handles crop instead of resizing), Replace Image, Save Image and
  Compress Image (JPEG quality or lossless, new resolution)
- Format > Rotate or Flip: images rotate in quarter turns about their centre (laid out by their
  rotated bounds) and flip; shapes flip. Rotation, mirroring and the Alt Text dialog's title and
  description are kept in ODT and DOCX. Format > Name and Alt Text dialogs
- Format > Wrap: Wrap First Paragraph (`style:number-wrapped-paragraphs`) and Text Wrap
- Format > Image > Filter: Invert, Smooth, Sharpen, Remove Noise, Charcoal Sketch, Mosaic, Relief,
  Posterize, Pop Art, Aging and Solarization, ported from vcl's bitmap filters with the cui
  dialogs' parameters
- Format > Rotate or Flip > Rotate: the handles of a shape or image turn it about its centre
- Format > Spotlight: character direct formatting, paragraph styles and character styles marked
  in their style's colour (sfx2's ColorHash) with the style's number, and named in the tooltip
