# Differences from LibreOffice

Where this application deliberately works or looks different from desktop LibreOffice (Writer,
and Calc in its own section below),
because it runs in a browser tab. Features that are simply not ported yet are listed in the
README (Status, Known limitations), not here.

## The suite and the Start Center

| LibreOffice | Here | Why |
| --- | --- | --- |
| One program: the Start Center opens when no document is open, and each module (Writer, Calc, Impress) opens documents in a window of its own. | The suite's address shows the **Start Center**, which lists the apps; each app is a page of its own below it (Writer at `writer/`), installable on its own. The Start Center has no recent documents or templates yet: Writer's File > Open lists its stored documents. | In a browser each app is a page; a page per app keeps an app's download to what it needs. |

## Files and storage

| LibreOffice | Here | Why |
| --- | --- | --- |
| Documents live in files on disk. | Every document is stored in the browser (IndexedDB). A file on disk is attached only when it was opened through the browser's file picker or saved with Save to Computer. | A web page has no general access to the file system. |
| File > Save writes the file. | **File > Autosave** (on by default, an extra entry after Save All) stores every change in the browser at once (in a long document, whose storing takes a while, once typing pauses for a second, and at least every ten seconds while typing goes on, and at once when the tab is hidden or closed). With autosave on, **Save (and Ctrl+S) saves a new version** (File > Versions) without asking for a comment, and writes the attached file on disk, if any; without a change since the document was opened or since its last version, it makes none. With autosave off, Save stores the document in the browser (and in the attached file), as in LibreOffice. | With autosave, there is nothing left for Save to store, and autosave overwrites the document with every change: Save is the quick way to keep a state to go back to. Versions with a comment are made with Save New Version (Ctrl+Alt+V) or in File > Versions. |
| A document opens at the cursor position stored in it at its last save (settings.xml's view settings), only when the user's name is the document's last author (Load > ViewPositionForAnyUser off). | A document opens **where it was left**: the cursor and the scroll position when the tab was hidden or closed, or another document opened, are kept in the browser, even without a change since the last store. Files keep the position of their last store in settings.xml, as LibreOffice writes and reads it, for any author. | In a browser, closing the tab is how a session ends; reopening a document should go back to where one was working, whoever wrote it. |
| — | Ctrl+S never falls through to the browser's "Save Page As". | |
| — | **File > Save New Version…** (Ctrl+Alt+V, on a Mac Cmd+Option+V), after Save: asks for a comment (the Insert Version Comment dialog of File > Versions, which Ctrl+Enter confirms), then saves the document and keeps its state as a new version, even when nothing changed since the last one. | With autosave, a version with a comment is the save that keeps a state on purpose. Ctrl+Alt+V is free in LibreOffice (Shift+Ctrl+V is Paste Special). |
| File > Save a Copy | **File > Download**: the document, in its own format (its file's on disk, otherwise ODT), straight into the browser's downloads, without a dialog. Like Save a Copy, the document keeps its name, file and modified state. | A copy for the user's computer is a download in a browser. |
| — | **File > Clear Data…**, last in the File menu: after a warning, deletes every document and template stored in the browser with its versions, all settings, the user dictionary and the downloaded fonts and dictionaries, then reloads. Files on the computer are not touched. | The browser's storage is the application's; without this, clearing it takes the browser's site settings. |
| File > Export… (another format) | **File > Download As…**, moved up after Download: a dialog for the file name and type (ODT, OTT, DOCX, TXT, Markdown, HTML), then a download. It has Save As's shortcut, Shift+Ctrl+S. For an ODT or OTT of a document with versions, **Include version history (N versions)** (on by default) chooses whether the file carries them (File > Versions); either way the document keeps them. | Autosave and Save add versions quickly; a file to pass on should not have to carry every earlier state. |
| — | **File > Create Copy…**, after Download As: asks for a name (the document's, with "(Copy)"), then stores the document as it is now as a new document in the browser, without its versions. The document stays open; a message offers to open the copy, which File > Open also lists. | Documents are stored in the browser: a copy under another name, as Save As makes one on disk, belongs there too. |
| File > Save As… | **File > Save to Computer…**, after Download As, only in browsers with a save dialog that gives a writable file (Chromium-based ones): the file is written and stays attached, so Save writes there afterwards. Elsewhere the entry is not shown. It has no shortcut. | Only the File System Access API can keep a file to write back to. |
| File > Open… shows the system's file dialog. | File > Open shows the documents stored in the browser as a table of name, last change and size (in MB), with a button to open a file from the computer. | Documents are stored in the browser first; the size shows what takes up the browser's storage. |
| — | The ribbon's **New > New Template** starts a blank template. It is stored in the browser as a template and saved and downloaded as .ott (Download As offers .ott too); opening an .ott starts a new, untitled document from it, as in LibreOffice. | The quickest way to make a template from scratch; Save as Template makes one from a document. |
| — | A document with content the filters do not support, and any Word document (.docx, .doc), opens **as a copy**: a notice lists what is missing and offers Download As. Saving can never overwrite the original file. | Saving would otherwise lose that content. |
| File > New opens a new window. | File > New replaces the document in the tab (asking first, without autosave, when there are unsaved changes). | One document per tab. |
| Closing a modified document asks to save. | Leaving the tab warns when changes are not yet in the attached file, or (without autosave) not yet in the browser. | |

## Templates (File > Templates)

The template manager, Save as Template, Edit Template and Styles > Load Styles from Template work
as in LibreOffice, with these differences:

| LibreOffice | Here | Why |
| --- | --- | --- |
| Templates are files in the template folders; a category is a folder. | The user's templates are stored in the browser with their category; empty categories are kept in the browser's settings. LibreOffice's own Writer templates (business letters, business card, CV, resume, the Default, Modern and Simple styles, Chinese and Japanese Normal) come with the application and, as in LibreOffice, cannot be renamed or deleted. | A web page has no template folders. |
| The template manager filters by application (Text Documents, Spreadsheets, ...) and offers Extensions. | There is no application filter, no Extensions entry, and Manage offers only "Reset Default Text Document". | Only text documents exist here; extensions are not ported. |
| Export asks for a folder and writes the templates there. | Export downloads each template as an .ott file. | Browsers give no folder to write to. |
| Import copies template files (.ott, .stw, .oth, .dotx, .dot, ...) into the category. | Import takes .ott, .dotx and .dot; Word templates are converted to an OpenDocument template on import. | The template is stored as ODF, the format this application keeps; .stw and .oth are not supported. |
| Edit opens one of LibreOffice's own templates read-only. | It opens as a template to edit; once changed, the copy is stored in My Templates. | There is no read-only mode; the built-in template itself cannot change. |
| Move of one of LibreOffice's own templates fails and offers to copy it. | It is copied without asking. | The built-in templates cannot move. |
| A document made from a template records the template's file URL, and LibreOffice offers to update its styles when the template changes. | The template's name is recorded (meta:template, its href the name with .ott); there is no style update on loading. | A stored template has no file URL; the update query is not ported yet. |
| Edit Template... opens the file dialog in the template folder. | It opens the browser's file picker for an .ott file, which opens as the template itself (not as a new document); Save writes back to it where the browser can. | |
| Insert > Content from Document... opens the file dialog, with a choice of file type and, for files with versions, of the version to insert. | It opens the browser's file picker; the file type follows from the file's name, and the current state of the file is inserted. | A web page has no file dialog of its own. |
| The template manager remembers its last category and view for the session's next opening. | Kept in the browser's settings across reloads. | |

## HTML

HTML is read and written by the port of LibreOffice's "HTML Document (Writer)" filter
(`sw/source/filter/html`).

| LibreOffice | Here | Why |
| --- | --- | --- |
| An HTML file opens in Writer/Web, the HTML editing mode with its own menus and toolbars. | An HTML file opens as an ordinary text document, as with LibreOffice's "HTML Document (Writer)" filter; saving writes HTML again. An .xhtml file opens as a copy, since it is written back as HTML. | Writer/Web is not ported; the text document keeps all of Writer's commands. |
| HTML export writes each image to a file of its own next to the page (unless the filter option EmbedImages is given). | Images are always embedded in the page as `data:` URLs (EmbedImages). | A download is one file; images in separate files would be lost. |
| Lengths in the style sheet and STYLE options are written in the unit of Tools > Options > Writer > General (inches or centimetres). | Lengths are written in points. | Points are exact to the twip, so a page written and read again keeps every spacing and indent. |
| Tracked changes are written as plain text: deleted text appears as if it were not deleted. | Insertions are written as INS, deletions as DEL, with the author and date. | The page shows which text was changed, as the Markdown export does. |
| The sectioning elements of HTML5 (SECTION, ARTICLE, ASIDE, NAV, MAIN, HEADER, FOOTER, FIGURE, FIGCAPTION, DETAILS, SUMMARY, HGROUP) are unknown tags: their text runs on into the paragraph around them. | They are read as DIV: their content starts a paragraph of its own. | Today's pages use these elements for most of their blocks. |

## Versions (File > Versions)

Versions are stored in the ODT as LibreOffice stores them (`VersionList.xml` and `Versions/`), so
both read each other's.

| LibreOffice | Here | Why |
| --- | --- | --- |
| Versions are made only by Save New Version, or on closing with "Always save a new version on closing". | With autosave on, Save makes a version too (see Files and storage), and the document as it was opened is kept as an "Automatically saved version" when its first change is stored, unless the newest version is less than 10 minutes older than that state. | Autosave overwrites the stored document with every change; without these versions, the state before a session would be lost. The 10 minutes keep reloads in one sitting from adding a version each. |
| Open shows the version read-only in a new window. | The version replaces the document in the tab as an editable copy (changing it leaves the document and its versions alone), with a "Back to the document" button and Download As. | One document per tab, and there is no read-only mode. |
| Compare compares the version with the document. | Compare is disabled. | Comparing documents is not ported yet (LibreOffice also disables it when comparing is unavailable). |
| Versions are deleted one at a time. | **Delete All** deletes every version at once, without asking. | Automatic versions and Save add up; clearing them one by one is tedious. |
| CMIS shows a server's versions (experimental mode). | Not shown. | No CMIS servers, as in LibreOffice without experimental mode. |

## Menus, toolbars and look

| LibreOffice | Here | Why |
| --- | --- | --- |
| Classic menus and toolbars by default. | The **ribbon** (Writer's tabbed notebookbar with contextual tabs) is the default; Menu > Classic switches to the menus and toolbars. The choice is kept. | |
| Window menu | **Menu** menu: Classic or Ribbon. | A browser tab has one window. |
| The ribbon's quick access toolbox: Menu, Open, Save, Undo, Redo, Print. | **New** (a popup: New Document, New Template), Open, Save, **Download**, Undo, Redo, Print. | Download is the usual way to get the file; New replaces the File tab's New. |
| The ribbon's first tab is File (New, Open, Save, Export, Print, Properties, Signatures). | **No File tab**: Home is the first tab. | The File tab repeats the menu and the quick access toolbox and pushed the editing tabs to the right. |
| View > Navigator (F5) opens the Navigator as a floating window (or as a deck of the sidebar). | The Navigator is a panel to the right of the document, and it stays open in the next session if it was open. Previous and Next stay available when Navigate By is Page and go to the previous and next page. Going past the last (or first) element of a type shows a passing notice that the search continued from the start (or the end), where LibreOffice shows it in the Find toolbar. | The browser tab has no floating windows and no sidebar; a fixed panel beside the page needs no window management. |
| In the Navigator, a double-click (or Enter) goes to an entry; a click only selects it (Navigate on select is off by default). | **A click goes to the entry** (a heading, table, image …), and so do the arrow keys, the focus staying in the Navigator; a double-click goes there with the document focused. | A click on a heading is expected to go there, as in a web page's table of contents. |
| The tabbed notebookbar lays each tab out in several rows of groups. | The ribbon has **one row** per tab; commands that do not fit **scroll sideways** in one row; the edges where commands are out of sight fade out. With a mouse, **arrow buttons** over those edges scroll to the next group (so does the mouse wheel), and no scroll bar shows; on a touch screen the row is swiped. | One row keeps the document high on the screen, as in browser office suites. |
| The ribbon's paragraph style box applies a style when it is picked. | With text selected, the style under the pointer in the paragraph style list (or chosen with the arrow keys) is **previewed on the selected paragraphs**; leaving the list or closing it (Escape) restores them, and only a click (or Enter) applies the style, as one undo step. The preview is not an edit: it is not in undo and does not mark the document modified. The classic toolbar's style box does the same. | Seeing the style on one's own text is the quickest way to choose one. |
| The ribbon's Home tab has Clear Direct Formatting in its font group. | It also has **Clear Direct Formatting right after the paragraph style box**. | Direct formatting hides what a style does; clearing it is often the step that goes with choosing a style. |
| Help > Search Commands (Shift+Esc) lists the commands found by their label alone. | It opens with **Ctrl+/ (Cmd+/ on a Mac)** too, from anywhere in the window (also with the focus in the ribbon), and the ribbon has a search button beside the document name. Each command found shows the menu it is in (for example File ▸ Templates) and its shortcut, and a label with every word typed, in any order, is found too ("save template" finds Save as Template); Escape closes the search at once. Ctrl+/ no longer inserts a zero-width space (Insert > Formatting Mark > Zero-width Space still does). | The ribbon shows only part of the commands; finding the rest by name is the quickest way, and Ctrl+/ is the shortcut web applications use for it. The menu shows where the command is the next time. |
| View > Normal (Normal View in the ribbon) and View > Web (Web View). | **View > Paper View** and **View > Screen View**, also in the ribbon and in Search Commands. Paper View is still the default. | The names say what the text is laid out for, paper pages or the screen; in a web application "Web View" says nothing, and "Normal" says nothing about the difference. |
| The horizontal ruler is shown by default (View > Rulers). | The rulers are **hidden** by default; View > Rulers > Rulers shows the horizontal ruler (and the vertical one if it is chosen). The choice is kept. | A cleaner first view of the page; the rulers are one click away. |
| View > Rulers > Rulers has the shortcut Shift+Ctrl+R. | It has **no shortcut** in the default set. | Shift+Ctrl+R (Shift+Cmd+R) is the browsers' reload bypassing the cache, which a web application must not take. The LibreOffice set under Tools > Options > Keyboard Shortcuts keeps it. |
| Keyboard shortcuts are changed in Tools > Customize > Keyboard, for LibreOffice or for Writer, and saved and loaded as `.cfg` files. | **Tools > Options > Keyboard Shortcuts**: a shortcut set, **Defaults** (LibreOffice's, with this application's changes), **LibreOffice** (unchanged), **MS Office for Windows** or **MS Office for Mac** (Microsoft Word's documented shortcuts for the commands Writer has, over the defaults), or **Custom**: any change to a set's shortcut makes it Custom, and the last custom set can be chosen again. Each command lists its keys; a key is added by pressing it and removed with ×. A key the browser uses (reload, new tab, bookmarks …) is marked with a warning naming the browser and what it does there, and a key the browser keeps for itself is said not to reach the document. Sets are exported and imported as JSON files. They are kept in the browser. | Users coming from Word expect its shortcuts, and in a browser some keys belong to the browser: the warnings say which before a shortcut silently fails. JSON files carry a set to another browser. |
| File > Print Preview, Printer Settings, Exit | Removed. | The browser's print dialog has its own preview and printer settings; the tab is closed instead. |
| Colibre (or the platform's) icon theme. | Fluent UI System Icons by default; Colibre, Keyline and Material Line under Tools > Options > View. Colibre has no download icon, so Download's is drawn in its colours. | |
| Commands that are not available are hidden or disabled by context. | Commands that are not ported yet are shown greyed out ("Not ported yet"). | Coverage stays visible. |
| Left-to-Right and Right-to-Left Mark (Insert > Formatting Mark) appear with complex text layout enabled. | Always shown. | There is no complex text layout option. |
| The page style dialog's Header and Footer tabs have a **More…** button that opens the Border / Background dialog on top of it; unchecking "Header on" asks before deleting the header. | The Header and Footer tabs show the **border and background fields in place** (the header/footer button's Border and Background… opens them on their own). Unchecking "Header on" there does not ask; Undo brings the header back. | The application shows one dialog at a time. |

## Fields (Insert > Field > More Fields)

| LibreOffice | Here | Why |
| --- | --- | --- |
| The Variables page offers **DDE field**. | The type is not offered; a DDE field in a document keeps its last text, and opening the document reports the field as lost. | A browser has no Dynamic Data Exchange with other applications. |
| A text input field (Functions page, or `FILLIN` from Word) is edited in place in the text; clicking an input field of a variable or user field opens the Input Field dialog. | Clicking any input field opens the **Input Field** dialog, text input fields too. | Fields are single placeholder characters here, without text that could be edited in place. |
| Inserting an input field opens the Input Field dialog on top of the Fields dialog, which stays open. | The Input Field dialog replaces the Fields dialog. | The application shows one dialog at a time. |
| Inserting a user field whose name is new (without clicking the green check mark first) makes a text user field, whatever format is selected. | The new user field is an expression when a number format is selected, and text when Text or Formula is selected. | A value such as `net*1.19` should calculate when it is inserted straight away, as the format chosen asks for. |
| Changing a value in the Input Field dialog cannot be undone. | It can be undone, except for the content of a user field. | The field is replaced like any other change to the text. |

## Index entries and citations (Insert > Table of Contents and Index)

| LibreOffice | Here | Why |
| --- | --- | --- |
| Insert Index Entry and Insert Citation are modeless windows: they stay open after Insert, and the selection in the document can change while they are open. | Both are **modal** dialogs, and **Insert closes them**; Insert Index Entry therefore has no "Update entry from selection" button. | The application shows one dialog at a time, over the document. |
| Insert Citation offers entries from the **Bibliography Database** (Tools > Bibliography Database), its default source. | The Bibliography Database choice is shown but disabled: citations come from the **document's own entries** and new ones made with New…. The Define Bibliography Entry dialog has no Browse button for the local copy. | There is no bibliography database (a Base data source) and no file system to browse in a browser. |
| The phonetic reading fields of Insert Index Entry appear with Asian language support. | They are not shown; marks keep phonetic readings from ODT files. | There is no Asian language support option. |
| An index entry with its own text shows as a shaded space where it is, moving the text after it (with View > Field Shadings). | The shaded space is drawn over the text after it, which stays where it is. | Field shadings only paint; they do not change the layout. |

## Printing and PDF

| LibreOffice | Here | Why |
| --- | --- | --- |
| File > Export as PDF | Writer: switched off for now; a PDF comes from the print dialog's "Save as PDF" (pages are painted as SVG with the document's fonts). | The ported PDF export only knew the 14 standard PDF fonts. |
| Calc: File > Export as PDF shows the PDF Options dialog (general settings, initial view, links, security, signatures). | **Calc's File > Export as PDF** offers only what to export (all sheets, selected sheets or selected cells) and whether to suppress empty pages; **Export Directly as PDF** exports all sheets. The PDF uses the standard PDF fonts (Helvetica, Times, Courier, stretched to the measured widths) in place of the document's fonts, without tagging, bookmarks or links. | The ported PDF writer does not embed fonts; Calc's default font Liberation Sans is metric-compatible with Helvetica, so the pages keep their layout. A PDF with the document's own fonts comes from printing to "Save as PDF". |
| Calc: File > Print opens the print dialog with the printer, pages, copies and Calc's options (all sheets, selected sheets, selected cells; suppress empty pages). | File > Print first asks for **Calc's options** (what to print, empty pages, with the page count), then opens the **browser's print dialog** for the printer, pages and copies; **Print Directly** (.uno:PrintDefault) prints the selected sheets at once. | The browser's dialog cannot show the application's own options. |
| Calc: Edit > Headers and Footers is not recorded for undo. | It is one undo step (Edit Page Style), as the Page Style dialog is. | The same change made through either dialog can be undone. |
| Calc: the header and footer areas are edited with the edit engine: formatted text, and fields shown as their values on grey. | The areas are plain text in which a field is its name in angle brackets (⟨Page⟩, ⟨Pages⟩, ⟨Sheet⟩, ⟨Date⟩, ⟨Time⟩, ⟨Title⟩, ⟨File⟩); an area that is not changed keeps its formatting. The text format buttons and the predefined header and footer lists are not there. | Rich text editing (the edit engine) is not ported for Calc. |
| Calc: View > Page Break switches to the page break zoom (60 %) and allows dragging the page breaks and print ranges with the mouse. | The page break view keeps the zoom; breaks and print ranges are changed with Sheet > Insert/Delete Page Break and Format > Print Ranges. | Dragging breaks is not ported yet. |

## AutoCorrect (Tools > AutoCorrect)

| LibreOffice | Here | Why |
| --- | --- | --- |
| "Bulleted and numbered lists" while typing ([T] on the Options page) is off by default (Office.Writer/AutoFunction/Format/ByInput/ApplyNumbering). | It is **on** by default: a paragraph starting with a number followed by a period (or another numbering such as "ii." or "(1)"), a space and text becomes a numbered list when Enter ends it, and one starting with "- ", "* " or "+ " a bulleted list. Every other option has LibreOffice's default. | Requested for this application: lists while typing are what most users expect from a word processor today. |
| The replacement tables and exception lists are the installation's acor_*.dat files, changed ones are kept in the user profile. | The same lists, built from LibreOffice's sources, are loaded when a document uses a language; a language's changed lists are kept in this browser (Clear Data removes them). The options are kept in this browser too. | There is no user profile. |
| Tools > AutoCorrect > Apply and Edit Changes asks to accept or reject all the changes, or to review them (SwModalRedlineAcceptDlg). | The changes are recorded and Edit > Track Changes > Manage opens. | The changes are reviewed in the dialog that already exists for them. |
| The bullet characters and the quotation marks are chosen in the Special Characters dialog. | They are typed into a one-character field next to their code point; an empty quotation mark field means the language's default. | A character field is quicker in a browser, where any character can be typed or pasted. |
| "Correct accidental use of cAPS LOCK key" corrects the word and turns Caps Lock off. | The word is corrected; Caps Lock stays on. | A web page cannot switch Caps Lock. |
| The word completion tip is a system tooltip; without "Show as tip", the rest of the word is shown as input text in the document. | Both are drawn over the document at the caret. | |

## Fonts, spelling, clipboard

| LibreOffice | Here | Why |
| --- | --- | --- |
| Installed fonts, replaced through the font replacement table. | A font profile under Tools > Options (LibreOffice's metric-compatible table, Google Fonts (default), or your own); web fonts are downloaded when a document uses them and kept for offline use. | Browsers expose few installed fonts. |
| Installed spelling dictionaries. | Downloaded on demand when a language is chosen, then kept offline; the user dictionary stays in this browser. | |
| LanguageTool (Tools > Options > Language Settings > LanguageTool Server) checks grammar through an HTTP server only: LanguageTool's servers or one the user runs. | **Tools > Options > LanguageTool** (its own page) offers LanguageTool **in this browser** (the default) or on a server with upstream's settings (base URL, username, API key, REST protocol). In the browser, LanguageTool itself (ported to TypeScript, with its own rules and dictionaries, downloaded once per language and kept offline) runs in a Web Worker; nothing is sent anywhere. The option to disable SSL certificate verification is not offered. | Checking should not need a server or send the text away; a browser decides about certificates itself. |
| With LanguageTool enabled, Hunspell still checks spelling, and LanguageTool's typo matches are shown as well. | For the languages LanguageTool supports, it **replaces** the spelling dictionaries: its typo matches are the spelling errors (red, with Add to Dictionary and Ignore All, which the user dictionary and ignore list apply to), its other matches grammar (orange) and style (blue) errors; no dictionary is downloaded for those languages. | One check, without double underlines; LanguageTool's spelling knows its own rules' exceptions. |
| Ignore All on a LanguageTool grammar error does nothing (its ignoreRule is empty), so it ignores only that place. | Ignore All ignores the rule for the rest of the session. | What the command says. |
| Each paragraph is sent to the LanguageTool server on its own, as soon as it changes. | Paragraphs are checked once typing pauses; paragraphs of one language are sent together in one request, and requests to the free server are kept below its limit (20 a minute). | The free server refuses more; one request per pause is enough. |
| Edit > Copy, Cut, Paste through any key or menu. | Copy, cut and paste shortcuts stay the browser's own; only native events may use the clipboard. Pasting takes plain text and images. | Browser clipboard security. |
| A copied object (image, formula, shape, frame) goes to the system clipboard as an embedded object, in LibreOffice's own formats. | The object stays in the tab; the system clipboard gets HTML (an image's picture, a formula's or frame's text) and plain text, and pasting uses the object only while that HTML is still on the clipboard. Pasted into another tab or application, an object arrives as that HTML or text. | Browsers allow only a few clipboard formats. |
| The mouse pointer changes over an object that a click selects. | The object also gets a thin grey frame while the pointer is over it, unless it is already selected. | It shows which of several close or overlapping objects a click would select. |

## Calc

| LibreOffice | Here | Why |
| --- | --- | --- |
| Opening a CSV file shows the Text Import dialog (separators, quotes, column types). | A CSV, TSV or text file opens at once, with its separators detected (as the dialog's defaults would); it is kept in the browser as ODS and Save writes the CSV back to an attached file. Download As writes the shown sheet as CSV (UTF-8, comma, quoted text). | The dialog's choices are rarely needed; Download As and Save write the same CSV as LibreOffice's defaults. |
| Alt+Enter while typing fills the selected cells with the entry; Ctrl+Enter inserts a line break in the cell. | **Alt+Enter and Ctrl+Enter insert a line break** in the cell; **Alt+Shift+Enter** fills the selected cells with the entry. | Alt+Enter is the line break in Excel and in browser spreadsheets, and the brief asked for it. |
| A cell is edited with the edit engine in the cell, with rich text (formatted runs within a cell). | A cell is edited in a plain text editor placed over the cell, in the cell's font, growing to the right with the text; the formula bar edits the same text. | The DOM editor gives the browser's text input (IME, spelling, accessibility); rich text in cells is not ported yet. |
| The scroll bars are beside the sheet tabs and step by cells; the sheet tab bar shares the bottom row with the horizontal scroll bar. | The grid has the browser's scroll bars (the view still scrolls by whole rows and columns, as in LibreOffice); the sheet tabs are a row of their own below the grid. | Native scrolling keeps trackpads and the mouse wheel smooth. |
| Window > Split Window and dragging the split boxes split the view in movable panes; View > Freeze Cells freezes them. | Only frozen panes (View > Freeze Cells, also First Row and First Column); unfreezing removes them. | A movable split is little used in a browser tab and not ported. |
| Cut, Copy and Paste from the menus use the system clipboard directly. | From menus and the context menu they use the browser's asynchronous clipboard, which may ask for permission; the keyboard's Ctrl+C, Ctrl+X and Ctrl+V are the browser's own clipboard events. | Only the browser's clipboard events may write and read the clipboard without asking. |
| Paste Special and Paste Only Text/Value/Formula work with anything Calc copied, also in another window. | They work with cells copied in this page; cells from other applications paste as text. | The cells with formulas and formats are kept in the page; the system clipboard carries only text and HTML. |
| The column and row edge drags show the size in a help text and set it on release. | The column or row resizes live while dragging; the change is one undo step on release. | Immediate feedback in place of the help text. |
| Edit > Find & Replace (Ctrl+H) opens a dialog with many options (regular expressions, similarity, search by columns, in comments, all sheets). | Find & Replace is a bar over the grid with the text, its replacement, Previous, Next, Find All, Replace, Replace All, Match case, Entire cells, and searching in formulas or values, in the shown sheet, by rows. | The bar keeps the sheet visible while searching; the dialog's other options are not ported. |
| Tools > Options > LibreOffice Calc has many pages (Defaults, Changes, Compatibility, Grid, Print, Sort Lists …). | The pages General (input settings), View, Calculate and Formula (syntax only) are there, with the shell's own pages. | The other pages belong to features not ported yet. |
