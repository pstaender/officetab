# Differences from LibreOffice Writer

Where this application deliberately works or looks different from desktop LibreOffice Writer,
because it runs in a browser tab. Features that are simply not ported yet are listed in the
README (Status, Known limitations), not here.

## Files and storage

| LibreOffice | Here | Why |
| --- | --- | --- |
| Documents live in files on disk. | Every document is stored in the browser (IndexedDB). A file on disk is attached only when it was opened through the browser's file picker or saved with Save to Computer. | A web page has no general access to the file system. |
| File > Save writes the file. | **File > Autosave** (on by default, an extra entry after Save All) stores every change in the browser at once. With autosave on, **Save (and Ctrl+S) saves a new version** (File > Versions) without asking for a comment, and writes the attached file on disk, if any; without a change since the document was opened or since its last version, it makes none. With autosave off, Save stores the document in the browser (and in the attached file), as in LibreOffice. | With autosave, there is nothing left for Save to store, and autosave overwrites the document with every change: Save is the quick way to keep a state to go back to. Versions with a comment are made in File > Versions. |
| — | Ctrl+S never falls through to the browser's "Save Page As". | |
| File > Save a Copy | **File > Download**: the document, in its own format (its file's on disk, otherwise ODT), straight into the browser's downloads, without a dialog. Like Save a Copy, the document keeps its name, file and modified state. | A copy for the user's computer is a download in a browser. |
| — | **File > Download without Version History**, after Download: the document as Download gives it, but an ODT without its versions (File > Versions); the document keeps them. Enabled only for an ODT document with versions, as other formats never carry them. | Autosave and Save add versions quickly; a file to pass on should not carry every earlier state. |
| — | **File > Clear Data…**, last in the File menu: after a warning, deletes every document stored in the browser with its versions, all settings, the user dictionary and the downloaded fonts and dictionaries, then reloads. Files on the computer are not touched. | The browser's storage is the application's; without this, clearing it takes the browser's site settings. |
| File > Export… (another format) | **File > Download As…**, moved up after Download: a dialog for the file name and type (ODT, DOCX, TXT, Markdown), then a download. It has Save As's shortcut, Shift+Ctrl+S. | |
| File > Save As… | **File > Save to Computer…**, after Download As, only in browsers with a save dialog that gives a writable file (Chromium-based ones): the file is written and stays attached, so Save writes there afterwards. Elsewhere the entry is not shown. It has no shortcut. | Only the File System Access API can keep a file to write back to. |
| File > Open… shows the system's file dialog. | File > Open shows the documents stored in the browser, with a button to open a file from the computer. | Documents are stored in the browser first. |
| — | A document with content the filters do not support, and any Word document (.docx, .doc), opens **as a copy**: a notice lists what is missing and offers Download As. Saving can never overwrite the original file. | Saving would otherwise lose that content. |
| File > New opens a new window. | File > New replaces the document in the tab (asking first, without autosave, when there are unsaved changes). | One document per tab. |
| Closing a modified document asks to save. | Leaving the tab warns when changes are not yet in the attached file, or (without autosave) not yet in the browser. | |

## Versions (File > Versions)

Versions are stored in the ODT as LibreOffice stores them (`VersionList.xml` and `Versions/`), so
both read each other's.

| LibreOffice | Here | Why |
| --- | --- | --- |
| Versions are made only by Save New Version, or on closing with "Always save a new version on closing". | With autosave on, Save makes a version too (see Files and storage), and the document as it was opened is kept as an "Automatically saved version" when its first change is stored, unless the newest version is less than 10 minutes older than that state. | Autosave overwrites the stored document with every change; without these versions, the state before a session would be lost. The 10 minutes keep reloads in one sitting from adding a version each. |
| Open shows the version read-only in a new window. | The version replaces the document in the tab as an editable copy (changing it leaves the document and its versions alone), with a "Back to the document" button and Download As. | One document per tab, and there is no read-only mode. |
| Compare compares the version with the document. | Compare is disabled. | Comparing documents is not ported yet (LibreOffice also disables it when comparing is unavailable). |
| Versions are deleted one at a time. | **Delete All** deletes every version, after a confirmation in the dialog. | Automatic versions and Save add up; clearing them one by one is tedious. |
| CMIS shows a server's versions (experimental mode). | Not shown. | No CMIS servers, as in LibreOffice without experimental mode. |

## Menus, toolbars and look

| LibreOffice | Here | Why |
| --- | --- | --- |
| Classic menus and toolbars by default. | The **ribbon** (Writer's tabbed notebookbar with contextual tabs) is the default; Menu > Classic switches to the menus and toolbars. The choice is kept. | |
| Window menu | **Menu** menu: Classic or Ribbon. | A browser tab has one window. |
| The ribbon's quick access toolbox: Menu, Open, Save, Undo, Redo, Print. | Open, Save, **Download**, Undo, Redo, Print. | Download is the usual way to get the file. |
| File > Print Preview, Printer Settings, Exit | Removed. | The browser's print dialog has its own preview and printer settings; the tab is closed instead. |
| Colibre (or the platform's) icon theme. | Fluent UI System Icons by default; Colibre, Keyline and Material Line under Tools > Options > View. Colibre has no download icon, so Download's is drawn in its colours. | |
| Commands that are not available are hidden or disabled by context. | Commands that are not ported yet are shown greyed out ("Not ported yet"). | Coverage stays visible. |
| Left-to-Right and Right-to-Left Mark (Insert > Formatting Mark) appear with complex text layout enabled. | Always shown. | There is no complex text layout option. |

## Printing and PDF

| LibreOffice | Here | Why |
| --- | --- | --- |
| File > Export as PDF | Switched off for now; a PDF comes from the print dialog's "Save as PDF" (pages are painted as SVG with the document's fonts). | The ported PDF export only knew the 14 standard PDF fonts. |

## Fonts, spelling, clipboard

| LibreOffice | Here | Why |
| --- | --- | --- |
| Installed fonts, replaced through the font replacement table. | A font profile under Tools > Options (LibreOffice's metric-compatible table, Google Fonts (default), or your own); web fonts are downloaded when a document uses them and kept for offline use. | Browsers expose few installed fonts. |
| Installed spelling dictionaries. | Downloaded on demand when a language is chosen, then kept offline; the user dictionary stays in this browser. | |
| Edit > Copy, Cut, Paste through any key or menu. | Copy, cut and paste shortcuts stay the browser's own; only native events may use the clipboard. Pasting takes plain text and images. | Browser clipboard security. |
