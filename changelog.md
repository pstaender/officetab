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
- An accessible mirror of the document for screen readers, with caret announcements
- Pinch zoom on the document zooms the document instead of the page
- Splash screen while the app and the last document load

### Fixed

- Dialogs now return keyboard focus to the document when they close
- Printing now includes table borders and backgrounds
- ODT export no longer writes an extra nested list for siblings at deeper list levels
