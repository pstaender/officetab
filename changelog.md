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
- Format > Bullets and Numbering: the Unordered, Ordered and Outline examples (the bullet library
  and the en_US locale's numberings and outlines), Position (followed by, tab stop, alignment,
  aligned at, indent at) and Customize (number, start, before, after, sublevels, character) for one
  level or all; Remove takes the selection out of its list
- Format > Title Page: convert existing pages or insert new ones at the document start or a page,
  a second title page with the Index page style, page numbering reset after the title pages and
  set on the first; one undo step. Radio buttons in dialogs no longer stretch to full width
- Format > Watermark: a turned, transparent Fontwork text centred on every page, in each page
  style's headers; kept in ODT (`draw:text-path`) and DOCX (VML text path, so Word's own text
  watermarks open too). Shapes draw their fill transparency on screen and in print
- File > Properties: the General page (type, size, created, modified, last printed, editing time,
  revision, Apply user data, Reset Properties, preferred image resolution) and the Description
  page. Document properties are kept in ODT `meta.xml` and DOCX `docProps/core.xml` and `app.xml`
  (they were dropped before); saving records the modification, revision and editing time, and
  printing the print date, as LibreOffice does. Images are inserted at the preferred resolution
- Format > Image > Graphic Size Check: lists the images with too few or too many pixels for their
  size at the preferred resolution, to mark or open their properties. BMP and WebP image sizes are
  now read from their headers
- Image colour: the image toolbar (graphicobjectbar) with Image Mode (grayscale, black/white,
  watermark) and Transparency, and Format > Image > Color's colorbar (red, green, blue, brightness,
  contrast, gamma). Painted with drawinglayer's colour modifiers on screen and in print; kept in ODT
  (`draw:color-mode`, `draw:luminance`, … `draw:image-opacity`) and DOCX (`a:grayscl`, `a:biLevel`,
  `a:lum`, `a:alphaModFix`, Word's washout as the watermark mode)
- Tables, cell selection and structure: a selection from one cell to another selects the
  rectangle of cells between them (SwTable::CreateSelection), painted as whole cells; formatting,
  paragraph styles, deleting and copying act on the selected cells. Table > Select > Cell, Row and
  Column; Merge Cells (with vertical merges, PrepareMerge); Split Cells into rows or columns; Merge
  Table and Split Table (with the four heading options); Insert > Rows and Columns dialogs
- Tables, sizes and properties: Table > Size (row height, minimal, optimal and distributed rows;
  column width, minimal, optimal and distributed columns, ported from AdjustCellWidth over the
  table's column borders), fixed row heights (content is clipped), Repeat Heading Rows, Allow Row
  to Break, Protect Cells and Unprotect (protected cells refuse edits), and Table Properties with
  its Table, Text Flow, Columns, Borders (SetTabBorders) and Background pages. The table toolbar
  shows in tables. Fixed heights, row split, table spacing and flow, and cell protection are kept
  in ODT; fixed heights and row split in DOCX
- Tables, converting, sorting and styles: Table > Convert > Text to Table (tabs, semicolons,
  paragraphs or another character; heading rows, don't split) and Table to Text; Table > Sort
  (up to three keys, numeric or alphanumeric, ascending or descending, rows or columns, below a
  repeated heading); Table > AutoFormat Styles with LibreOffice's built-in styles, read from
  `autotbl.fmt` at build time by a port of SwTableAutoFormatTable::Load (`npm run upstream:gen`).
  The applied style's name is kept in ODT (`table:template-name`)
- Tables, numbers and formulas: number formats for cells (a reduced SvNumberFormatter working on
  format codes: numbers, currency, percent, scientific, dates, times, booleans and text, with the
  language's notation through Intl), Table > Number Format with categories, options and the code,
  the number format toolbar buttons, Number Recognition (typed numbers, dates, percentages and
  currency amounts become values once the cursor leaves the cell), and table formulas: Edit
  Formula and AutoSum in the formula bar, SwCalc's operators and functions, cell references and
  ranges, also of other tables, recalculated when a cell changes. Values, number formats (as ODF
  data styles) and formulas are kept in ODT
- Tables across pages: a row that does not fit breaks at the page bottom and continues on the next
  page below the repeated heading rows (a follow row), unless it may not break, has a fixed
  height or is part of a vertical merge; a table that may not split moves to the next page whole
  when it fits there
- The table toolbar's Optimize, Borders, Border Style and Border Color popups
- Insert > Caption for tables: the caption paragraph above or below the table in the category's
  paragraph style (Caption, Illustration, Table, Text, Drawing, Figure), with a number range field
  numbered in document order in the chosen numbering; number ranges are kept in ODT
  (`text:sequence`) and DOCX (`SEQ`), and imported from both
- TIFF images: a reduced port of vcl's TIFF import (its own baseline decoder in place of libtiff:
  strips and tiles, uncompressed, LZW, PackBits and Deflate, the horizontal predictor, bilevel,
  grey, RGB, palette and CMYK with alpha), shown, printed and saved unchanged in DOCX and ODT
- DOCX: text boxes take theme colours for fill and outline, and their outline is centred on the
  shape's edge; pictures anchored to a character are placed beside it; objects positioned against
  the paragraph start below the previous paragraph's spacing (GetTopForObjPos); text without a size
  in the styles is 10 pt as in Word; cells' own margins (`w:tcMar`) are read
- Fonts: a name without a replacement of its own uses its family's (getMapName: "Cambria Math" is
  drawn with Cambria's replacement, Caladea)
- Text frames with vertical text (bottom to top or top to bottom): laid out along the frame's
  height and turned onto the page, with caret and mouse; from DOCX `wps:bodyPr vert` and ODT
  `style:writing-mode`, and saved in both
- Printing: content clipped and then rotated (vertical text in cells and frames) keeps its clip;
  the SVG clip goes on a group, since an element's own clip-path turns with its transform
- Formulas (LibreOffice Math): a port of starmath's parser (SmParser5), node tree and layout
  (Prepare and Arrange, SmRect), drawing (SmDrawingVisitor) and filters. Formulas are objects
  anchored as characters, aligned to the line's baseline (MathBaselineAlignment). Word equations
  (`m:oMath`, `m:oMathPara` with its justification) are read with SmOoxmlImport and written with
  SmOoxmlExport; ODT keeps them as embedded formula objects, read from their MathML (the StarMath
  annotation, or the presentation MathML Word writes) and written by SmXMLExport.
  Insert > Object > Formula Object opens a formula editor with the commands, a preview and the
  common elements; a double click on a formula edits it. OpenSymbol is drawn with STIX Two Math
- Linked text frames: Format > Frame and Object > Link Frames (then a click on an empty frame)
  and Unlink Frames, with SwDoc::Chainable's rules; the first frame's text flows through the
  chain, each frame taking the lines that fit (the first frame gets a fixed height). Chains are
  kept through renaming and deleting frames, in ODT (`draw:chain-next-name`) and DOCX
  (`wps:txbx` ids and `wps:linkedTxbx`)
- Contour wrap: Format > Wrap > Contour (and the object dialog's Contour and Outside only) wraps
  text around a graphic's contour, traced from it the first time (Bitmap::GetContour from the alpha
  mask, or from its edges, CreateAutoContour); Edit Contour edits it (AutoContour, moving, adding
  and deleting points). Contours are kept in ODT (`draw:contour-polygon`) and DOCX (`wp:wrapTight`
  and `wp:wrapThrough` with `wp:wrapPolygon`)
- Bookmarks (a reduced port of the MarkManager): positions that follow editing, with undo; kept in
  ODT (`text:bookmark`, `-start`, `-end`) and DOCX (`w:bookmarkStart`, `w:bookmarkEnd`, names as
  Word allows them). Ctrl/Cmd+click on a link into the document (`#name`) jumps to its bookmark,
  heading (`|outline`), table or frame (SwView::JumpToSwMark).
- Table of contents: entries link to their headings' cross-reference bookmarks in the "Index Link"
  style, as Writer's default index does. A Word index imports as an index (Update Index works), its
  entries without Word's Hyperlink character style, so they are black and not underlined.
- DOCX: a page break alone in its paragraph moves to the next paragraph, which loses its upper
  spacing (deferred breaks, as writerfilter does); table styles' shading and cell borders, with
  their banded rows and columns and first and last row and column formats (tblLook); tables with an
  automatic width are as wide as their grid, aligned as `w:jc` says.
- DOCX, checked against two sample documents: page and column breaks inside a paragraph split it
  there (the rest breaking before); a table style's paragraph and character properties, also those
  of its conditional formats, apply to cell paragraphs whose own style does not set them
  (ApplyParagraphPropertiesFromTableStyle); percentage table widths are relative widths (also in
  ODT and DOCX export); a continuous section break stays on the page unless the orientation
  changes, and an empty paragraph holding only section properties goes
- Layout: proportional line spacing below 100% shrinks a paragraph's first line too
  (PROP_LINE_SPACING_SHRINKS_FIRST_LINE, kept in ODT settings); objects positioned from the page or
  its margins are in place for all of their page's text, also above their anchor paragraph
- Character borders (`w:bdr`, `fo:border` on text): one line around the text, merged between
  neighbouring runs
- Hyperlinks: hovering one shows "Ctrl-click to open hyperlink" with its target, and Tools >
  Options > Writing has LibreOffice's "Ctrl-click required to open hyperlinks" (off: a plain click
  follows links)
- DOCX: up to Word 2010, a table's indent is to its first cell's text (the table starts that
  cell's margin further left); `overrideTableStyleFontSizeAndJustification` is honoured
- Font size box: Enter applies the typed size and returns to the text without a new paragraph;
  its list offers LibreOffice's standard sizes (FontList::aStdSizeAry, 6 to 96 pt) with the same
  arrow and popup as the font name box, and the chosen size shows at once; Up and Down step
  through the sizes, Alt+Down opens the list, Escape restores the size
- Font name box: previews of fonts (Tools > Options > Fonts), each name drawn in its font, with the
  five fonts chosen last at the top, type-ahead and keyboard navigation; off with all fonts listed
- The font name and size boxes, with their lists and previews, also in Format > Character, the
  paragraph style dialog, Format > Watermark and the font replacement options
- Tables are resized with the mouse, as in Writer: over a column border or the table's right edge
  the pointer becomes a column resizer, over a row's bottom border a row resizer, and dragging
  shows a guide line. A column border moves on its own; with Shift the columns to its right move
  with it, with Ctrl (Cmd on macOS) they are resized proportionally. A row gets the dragged height
  as its minimum. Escape cancels, and Edit > Undo takes it back. The table's left edge cannot be
  dragged yet
- File > Autosave: on (the default), every change is stored in the browser at once instead of
  after a pause; off, only File > Save stores it, and opening or creating another document first
  asks to save the changes (sfx2's "Save Document?" query), as does closing the tab. The setting is
  kept for every document opened later
- File menu without Print Preview, Printer Settings and Exit, which the browser provides itself
- Insert > Formatting Mark complete: non-breaking hyphen, soft hyphen, narrow no-break space,
  zero-width space, word joiner and the left-to-right and right-to-left marks besides the no-break
  space. Line breaking follows them (SwTextFormatter::NewPortion): a soft hyphen has no width and
  shows as a shaded hyphen where the line breaks, a non-breaking hyphen shows as a hyphen and never
  breaks, a zero-width space allows a break (shown as a small slash with formatting marks on), a
  word joiner forbids one. DOCX writes them as `w:noBreakHyphen` and `w:softHyphen`
- Table borders: a wider area around a column or row border turns the pointer into a resizer
- Menu (in place of Window, which a browser tab does not need) chooses between Classic, the menu
  bar and toolbars, and Ribbon: Writer's tabbed notebookbar (`notebookbar.ui`, generated like the
  menus) as one row of commands per tab, with LibreOffice's quick access buttons (Save, Undo, Redo,
  Print) beside the tabs and the classic menus behind a menu button. The Table, Image, Draw and
  Object tabs appear with their context and are selected as NotebookbarTabControl::SetContext does.
  A tab with fewer than 20 commands names them beside their icons; commands that do not fit scroll
  sideways, also with the mouse wheel, and fade out at the edge where more are hidden. The choice is
  kept for later sessions
- The document name is a field beside the tabs (or in the menu bar): always shown, renamed by typing
  in it
- The shell's own texts and language names follow the language the menus exist in (English), not the
  browser's first language, so a German browser no longer mixes German dialogs into English menus
- Context menus: right-click (or Shift+F10 and the menu key) opens the context menu of what is
  under the pointer, generated from Writer's own popup menus (`sw/uiconfig/swriter/popupmenu`): the
  text's, a table's, an image's, a frame's, a shape's, a shape's text and a formula's. As in
  Writer, the object under the pointer is selected first, the cursor moves there unless it is over
  the selection, misspelled words keep their spelling menu, and disabled entries are hidden
- Windows metafiles: WMF and EMF pictures display, print and are saved as they are. emfio's
  WmfReader and EmfReader (reduced) read them through MtfTools into a GDIMetaFile, which is drawn
  as SVG (vector in print), with the XOR paint trick of old WMF logos recognised. DOCX pictures
  and VML pictures (`v:imagedata`, also the preview of an embedded object) of `.wmf` and `.emf`,
  ODT pictures of `image/x-wmf` and `image/x-emf`; EMF+ records are skipped in favour of the EMF
  ones. Found with the header logo and licence badge of `specs/writer/math.docx`. SVG pictures now
  also decode in browsers whose `createImageBitmap` does not read SVG
