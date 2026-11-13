# Differences from LibreOffice Writer

Where this application deliberately works or looks different from desktop LibreOffice Writer,
because it runs in a browser tab. Features that are simply not ported yet are listed in the
README (Status, Known limitations), not here.

## Files and storage

| LibreOffice | Here | Why |
| --- | --- | --- |
| Documents live in files on disk. | Every document is stored in the browser (IndexedDB). A file on disk is attached only when it was opened through the browser's file picker or saved with Save to Computer. | A web page has no general access to the file system. |
| File > Save writes the file. | **File > Autosave** (on by default, an extra entry after Save All) stores every change in the browser at once. With autosave on, **Save (and Ctrl+S) saves a new version** (File > Versions) without asking for a comment, and writes the attached file on disk, if any; without a change since the document was opened or since its last version, it makes none. With autosave off, Save stores the document in the browser (and in the attached file), as in LibreOffice. | With autosave, there is nothing left for Save to store, and autosave overwrites the document with every change: Save is the quick way to keep a state to go back to. Versions with a comment are made with Save New Version (Ctrl+Alt+V) or in File > Versions. |
| — | Ctrl+S never falls through to the browser's "Save Page As". | |
| — | **File > Save New Version…** (Ctrl+Alt+V, on a Mac Cmd+Option+V), after Save: asks for a comment (the Insert Version Comment dialog of File > Versions, which Ctrl+Enter confirms), then saves the document and keeps its state as a new version, even when nothing changed since the last one. | With autosave, a version with a comment is the save that keeps a state on purpose. Ctrl+Alt+V is free in LibreOffice (Shift+Ctrl+V is Paste Special). |
| File > Save a Copy | **File > Download**: the document, in its own format (its file's on disk, otherwise ODT), straight into the browser's downloads, without a dialog. Like Save a Copy, the document keeps its name, file and modified state. | A copy for the user's computer is a download in a browser. |
| — | **File > Clear Data…**, last in the File menu: after a warning, deletes every document and template stored in the browser with its versions, all settings, the user dictionary and the downloaded fonts and dictionaries, then reloads. Files on the computer are not touched. | The browser's storage is the application's; without this, clearing it takes the browser's site settings. |
| File > Export… (another format) | **File > Download As…**, moved up after Download: a dialog for the file name and type (ODT, DOCX, TXT, Markdown), then a download. It has Save As's shortcut, Shift+Ctrl+S. For an ODT or OTT of a document with versions, **Include version history (N versions)** (on by default) chooses whether the file carries them (File > Versions); either way the document keeps them. | Autosave and Save add versions quickly; a file to pass on should not have to carry every earlier state. |
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
| The template manager remembers its last category and view for the session's next opening. | Kept in the browser's settings across reloads. | |

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
| File > Print Preview, Printer Settings, Exit | Removed. | The browser's print dialog has its own preview and printer settings; the tab is closed instead. |
| Colibre (or the platform's) icon theme. | Fluent UI System Icons by default; Colibre, Keyline and Material Line under Tools > Options > View. Colibre has no download icon, so Download's is drawn in its colours. | |
| Commands that are not available are hidden or disabled by context. | Commands that are not ported yet are shown greyed out ("Not ported yet"). | Coverage stays visible. |
| Left-to-Right and Right-to-Left Mark (Insert > Formatting Mark) appear with complex text layout enabled. | Always shown. | There is no complex text layout option. |

## Printing and PDF

| LibreOffice | Here | Why |
| --- | --- | --- |
| File > Export as PDF | Switched off for now; a PDF comes from the print dialog's "Save as PDF" (pages are painted as SVG with the document's fonts). | The ported PDF export only knew the 14 standard PDF fonts. |

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
| Edit > Copy, Cut, Paste through any key or menu. | Copy, cut and paste shortcuts stay the browser's own; only native events may use the clipboard. Pasting takes plain text and images. | Browser clipboard security. |
| A copied object (image, formula, shape, frame) goes to the system clipboard as an embedded object, in LibreOffice's own formats. | The object stays in the tab; the system clipboard gets HTML (an image's picture, a formula's or frame's text) and plain text, and pasting uses the object only while that HTML is still on the clipboard. Pasted into another tab or application, an object arrives as that HTML or text. | Browsers allow only a few clipboard formats. |
| The mouse pointer changes over an object that a click selects. | The object also gets a thin grey frame while the pointer is over it, unless it is already selected. | It shows which of several close or overlapping objects a click would select. |
