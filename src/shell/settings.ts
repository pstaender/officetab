// Where the suite keeps its settings in the browser (local storage). LibreOffice keeps some
// settings for the whole suite (the user's name, the icon theme, fonts, LanguageTool, the security
// options, AutoCorrect, the user dictionary) and others per module (the UI mode, keyboard shortcuts,
// view options): the first are kept under `officetab:<name>` (suiteKey), the second under
// `<app>:<name>` (`writer:keymap`).
//
// Before the suite had a second app, every setting was Writer's (`writer:<name>`): a suite key reads
// that one once, takes it over and removes it, so nothing is lost and it cannot come back later.

const SUITE = 'officetab:';
const LEGACY = 'writer:';
const migrated = new Set<string>();

/** The local storage key of a suite-wide setting, taking over Writer's old key on first use. */
export function suiteKey(name: string): string {
  const key = SUITE + name;
  if (!migrated.has(name)) {
    migrated.add(name);
    try {
      if (localStorage.getItem(key) === null) {
        const old = localStorage.getItem(LEGACY + name);
        if (old !== null) {
          localStorage.setItem(key, old);
          localStorage.removeItem(LEGACY + name);
        }
      }
    } catch { /* storage may be unavailable */ }
  }
  return key;
}

/** The local storage key of a setting an app keeps for itself (`writer:ui-mode`). */
export const appKey = (app: string, name: string): string => `${app}:${name}`;
