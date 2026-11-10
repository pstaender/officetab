// Texts of the web shell itself (not upstream's labels, which come from LibreOffice's UI files), in
// the browser's language. Add a language by adding a catalogue; missing entries fall back to English.

type Catalogue = Record<string, string>;

const en: Catalogue = {
  'shape.drag': 'Drag on the page to draw the shape, or click for a shape of the default size. Escape cancels.',
};

const de: Catalogue = {
  'shape.drag': 'Ziehen Sie auf der Seite, um die Form zu zeichnen, oder klicken Sie für eine Form in Standardgröße. Escape bricht ab.',
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
