// Texts of the web shell itself (not upstream's labels, which come from LibreOffice's UI files), in
// the browser's language. Add a language by adding a catalogue; missing entries fall back to English.

type Catalogue = Record<string, string>;

const en: Catalogue = {
  'shape.drag': 'Drag on the page to draw the shape, or click for a shape of the default size. Escape cancels.',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'docs.clearAll': 'Delete all',
  'docs.clearAllConfirm': 'Delete all {count} documents stored in this browser? The open document is kept.',
  'docs.cleared': '{count} documents deleted.',
  'shape.title': 'Shape',
  'shape.areaLine': 'Area and Line',
  'shape.fill': 'Fill',
  'shape.fillColor': 'Fill colour',
  'shape.line': 'Line',
  'shape.lineColor': 'Line colour',
  'shape.lineWidth': 'Line width (pt, 0 is a hairline)',
  'shape.rotate': 'Rotation (degrees)',
  'options.title': 'Options',
  'options.user': 'User Data',
  'options.name': 'Name',
  'options.namePlaceholder': 'Shown as the author of your comments and changes',
  'options.stored': 'Stored in this browser only.',
  'options.writing': 'Writing Aids',
  'options.autospell': 'Check spelling while typing',
  'options.autospellHint': 'Choose the language of the text in the status bar; its dictionary is downloaded once and kept for offline use.',
  'fonts.title': 'Fonts',
  'fonts.tab.profiles': 'Replacement Profiles',
  'fonts.tab.defaults': 'Default Fonts',
  'fonts.tab.list': 'Font List',
  'fonts.defaultsHint': 'Fonts the profile does not replace are drawn with the default font of their kind when the system lacks them.',
  'fonts.profile': 'Font replacement profile',
  'fonts.profileHint': 'A font the system does not have is drawn with its replacement; fonts the profile does not know use its default for their kind. Web fonts are loaded when a document uses them and kept for offline use.',
  'fonts.copyOf': 'Copy of {name}',
  'fonts.imported': 'Imported profile',
  'fonts.importError': 'This is not a font profile file.',
  'fonts.name': 'Profile name',
  'fonts.duplicate': 'Duplicate',
  'fonts.delete': 'Delete',
  'fonts.import': 'Import…',
  'fonts.export': 'Export…',
  'fonts.builtinHint': 'Built-in profiles cannot be changed: duplicate one to edit it.',
  'fonts.font': 'Font',
  'fonts.replacement': 'Replacement',
  'fonts.add': 'Add replacement',
  'fonts.remove': 'Remove',
  'fonts.sans': 'Sans-serif',
  'fonts.serif': 'Serif',
  'fonts.mono': 'Monospace',
  'fonts.always': 'Use the replacements even for fonts the system has (the same look on every computer)',
  'fonts.showAll': 'Show all available fonts in the font list (about 2000 Google Fonts)',
  'fonts.showAllHint': 'Otherwise the list shows a selection, the common system fonts and the fonts the document uses.',
};

const de: Catalogue = {
  'shape.drag': 'Ziehen Sie auf der Seite, um die Form zu zeichnen, oder klicken Sie für eine Form in Standardgröße. Escape bricht ab.',
  'common.ok': 'OK',
  'common.cancel': 'Abbrechen',
  'docs.clearAll': 'Alle löschen',
  'docs.clearAllConfirm': 'Alle {count} in diesem Browser gespeicherten Dokumente löschen? Das geöffnete Dokument bleibt erhalten.',
  'docs.cleared': '{count} Dokumente gelöscht.',
  'shape.title': 'Form',
  'shape.areaLine': 'Fläche und Linie',
  'shape.fill': 'Füllung',
  'shape.fillColor': 'Füllfarbe',
  'shape.line': 'Linie',
  'shape.lineColor': 'Linienfarbe',
  'shape.lineWidth': 'Linienbreite (pt, 0 ist eine Haarlinie)',
  'shape.rotate': 'Drehung (Grad)',
  'options.title': 'Optionen',
  'options.user': 'Benutzerdaten',
  'options.name': 'Name',
  'options.namePlaceholder': 'Wird als Autor Ihrer Kommentare und Änderungen angezeigt',
  'options.stored': 'Nur in diesem Browser gespeichert.',
  'options.writing': 'Linguistik',
  'options.autospell': 'Rechtschreibung während der Eingabe prüfen',
  'options.autospellHint': 'Wählen Sie die Sprache des Textes in der Statusleiste; ihr Wörterbuch wird einmal geladen und für die Offline-Nutzung gespeichert.',
  'fonts.title': 'Schriftarten',
  'fonts.tab.profiles': 'Ersetzungsprofile',
  'fonts.tab.defaults': 'Standardschriftarten',
  'fonts.tab.list': 'Schriftartenliste',
  'fonts.defaultsHint': 'Schriftarten, die das Profil nicht ersetzt, werden durch die Standardschriftart ihrer Art dargestellt, wenn das System sie nicht hat.',
  'fonts.profile': 'Profil für Ersatzschriftarten',
  'fonts.profileHint': 'Eine Schriftart, die das System nicht hat, wird durch ihre Ersatzschriftart dargestellt; Schriftarten, die das Profil nicht kennt, durch seine Standardschriftart ihrer Art. Webschriftarten werden geladen, wenn ein Dokument sie verwendet, und für die Offline-Nutzung gespeichert.',
  'fonts.copyOf': 'Kopie von {name}',
  'fonts.imported': 'Importiertes Profil',
  'fonts.importError': 'Diese Datei ist kein Schriftartenprofil.',
  'fonts.name': 'Name des Profils',
  'fonts.duplicate': 'Duplizieren',
  'fonts.delete': 'Löschen',
  'fonts.import': 'Importieren…',
  'fonts.export': 'Exportieren…',
  'fonts.builtinHint': 'Mitgelieferte Profile lassen sich nicht ändern: Duplizieren Sie eines, um es zu bearbeiten.',
  'fonts.font': 'Schriftart',
  'fonts.replacement': 'Ersatz',
  'fonts.add': 'Ersatz hinzufügen',
  'fonts.remove': 'Entfernen',
  'fonts.sans': 'Serifenlos',
  'fonts.serif': 'Mit Serifen',
  'fonts.mono': 'Nichtproportional',
  'fonts.always': 'Ersatzschriftarten auch für Schriftarten verwenden, die das System hat (überall gleiches Aussehen)',
  'fonts.showAll': 'Alle verfügbaren Schriftarten in der Liste zeigen (etwa 2000 Google Fonts)',
  'fonts.showAllHint': 'Sonst zeigt die Liste eine Auswahl, die üblichen Systemschriftarten und die Schriftarten des Dokuments.',
};

const CATALOGUES: Record<string, Catalogue> = { en, de };

/** The language the shell is shown in: the first of the browser's languages there is a catalogue for. */
export function uiLanguage(): string {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const l of langs) { const p = l.split('-')[0]!.toLowerCase(); if (CATALOGUES[p]) return p; }
  return 'en';
}

/** A text of the shell by key, with {name} placeholders filled in. */
export function t(key: string, vars: Record<string, string | number> = {}, lang = uiLanguage()): string {
  const s = CATALOGUES[lang]?.[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** For tests: every key of a catalogue exists in English. */
export const catalogues = CATALOGUES;
