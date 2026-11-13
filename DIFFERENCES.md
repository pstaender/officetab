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
| — | **File > Download without Version History**, after Download: the document as Download gives it, but an ODT (or template, OTT) without its versions (File > Versions); the document keeps them. Enabled only for an ODT or OTT document with versions, as other formats never carry them. | Autosave and Save add versions quickly; a file to pass on should not carry every earlier state. |
| — | **File > Clear Data…**, last in the File menu: after a warning, deletes every document stored in the browser with its versions, all settings, the user dictionary and the downloaded fonts and dictionaries, then reloads. Files on the computer are not touched. | The browser's storage is the application's; without this, clearing it takes the browser's site settings. |
| File > Export… (another format) | **File > Download As…**, moved up after Download: a dialog for the file name and type (ODT, DOCX, TXT, Markdown), then a download. It has Save As's shortcut, Shift+Ctrl+S. | |
| File > Save As… | **File > Save to Computer…**, after Download As, only in browsers with a save dialog that gives a writable file (Chromium-based ones): the file is written and stays attached, so Save writes there afterwards. Elsewhere the entry is not shown. It has no shortcut. | Only the File System Access API can keep a file to write back to. |
| File > Open… shows the system's file dialog. | File > Open shows the documents stored in the browser as a table of name, last change and size (in MB), with a button to open a file from the computer. | Documents are stored in the browser first; the size shows what takes up the browser's storage. |
| A text template (.ott) is made with File > Templates > Save as Template and kept in the template manager. | The ribbon's **New > New Template** starts a blank template. It is stored in the browser as a template and saved and downloaded as .ott (Download As offers .ott too); opening an .ott starts a new, untitled document from it, as in LibreOffice. | There is no template manager yet; this is the quickest way to make a template. |
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
