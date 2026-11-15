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

// --- Default settings (defaultSettings.json) and the settings as JSON ---
//
// Anyone deploying the suite (or running it locally) can change its defaults in `defaultSettings.json` at
// the suite's root (public/defaultSettings.json): a setting the user has not changed reads its default
// from there. Names are the storage names (`ui-mode`), or the friendlier aliases below
// (`menuBarStyle`). A name at the top level is the suite's (`officetab:<name>`) and the default of
// every app; in an app's object (`{ "writer": { … } }`) it is that app's own:
//
//   { "menuBarStyle": "ribbon", "writer": { "menuBarStyle": "classic" }, "calc": { "autoSave": false } }
//
// Strings are stored as they are, other values as JSON (`true` as `true`, objects as their JSON),
// which is how the settings are kept in local storage. Keys starting with `//` or `$` are comments.
// Workspace > Export Settings as JSON writes the user's settings in the same form.

/** Friendly names of settings, for defaultSettings.json and the exported settings: name → storage name. */
export const SETTING_ALIASES: Readonly<Record<string, string>> = {
  menuBarStyle: 'ui-mode',
  iconTheme: 'icon-theme',
  autoSave: 'autosave',
  ctrlClickHyperlink: 'ctrlclick',
  languageTool: 'languagetool',
  autoSpellcheck: 'autospell',
  userDictionary: 'userwords',
  viewOptions: 'viewoptions',
  fontProfiles: 'fontprofiles',
  fontProfile: 'fontprofile',
};
const STORAGE_TO_ALIAS = new Map(Object.entries(SETTING_ALIASES).map(([a, s]) => [s, a]));
/** Settings that belong to documents rather than to the user: not in the exported settings JSON. */
const DOCUMENT_STATE = new Set(['view-positions']);

/** The suite's apps by id (given by the app's start: this module imports nothing). */
let appIds: readonly string[] = ['writer', 'calc'];
/** The app reading the settings: its own defaults win over the suite's. */
let currentApp: string | null = null;
/** The defaults of defaultSettings.json, by storage key (`officetab:ui-mode`, `writer:ui-mode`). */
let defaults = new Map<string, string>();

const SUITE_SCOPE = SUITE.slice(0, -1);
const storageName = (name: string): string => SETTING_ALIASES[name] ?? name;
const encode = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isComment = (k: string) => k.startsWith('//') || k.startsWith('$');

/** The storage keys and values of settings in defaultSettings.json's form. */
export function parseSettingsJson(json: unknown, apps: readonly string[] = appIds): Map<string, string> {
  if (!isPlainObject(json)) throw new Error('The settings are not a JSON object.');
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(json)) {
    if (isComment(k) || v === null || v === undefined) continue;
    if (apps.includes(k) && isPlainObject(v)) {
      for (const [n, w] of Object.entries(v)) if (!isComment(n) && w !== null && w !== undefined) out.set(appKey(k, storageName(n)), encode(w));
      continue;
    }
    out.set(SUITE + storageName(k), encode(v));
  }
  return out;
}

/** Sets the default settings (defaultSettings.json's) and the app that reads them. */
export function setDefaultSettings(json: unknown, app: string | null, apps: readonly string[] = appIds): void {
  appIds = apps;
  currentApp = app;
  defaults = parseSettingsJson(json, apps);
}

/**
 * Loads defaultSettings.json (`url`, at the suite's root) before the app reads its settings. A missing or
 * broken file leaves the built-in defaults.
 */
export async function loadDefaultSettings(url: string, app: string, apps: readonly string[]): Promise<void> {
  appIds = apps;
  currentApp = app;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) setDefaultSettings(await res.json(), app, apps);
  } catch (e) {
    console.warn('defaultSettings.json could not be read:', e);
  }
}

/** The default of a setting by its storage key: the app's own, then the suite's; null for none. */
export function settingDefault(key: string): string | null {
  const colon = key.indexOf(':');
  if (colon < 0) return null;
  const scope = key.slice(0, colon), name = key.slice(colon + 1);
  const app = scope === SUITE_SCOPE ? currentApp : scope;
  return (app ? defaults.get(appKey(app, name)) : undefined) ?? defaults.get(SUITE + name) ?? null;
}

/**
 * A setting as the user set it, else its default. An app's setting the user has not set takes its
 * app's default, then the suite-wide setting of the same name (`officetab:ui-mode`, imported as
 * `menuBarStyle`), then the suite's default.
 */
export function readSetting(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch { /* storage may be unavailable */ }
  const colon = key.indexOf(':');
  const scope = colon < 0 ? '' : key.slice(0, colon);
  if (scope && scope !== SUITE_SCOPE && appIds.includes(scope)) {
    const own = defaults.get(key);
    if (own !== undefined) return own;
    try {
      const suite = localStorage.getItem(SUITE + key.slice(colon + 1));
      if (suite !== null) return suite;
    } catch { /* storage may be unavailable */ }
  }
  return settingDefault(key);
}

/** A stored value as JSON shows it: strings as they are, values stored as JSON as those. */
function decode(v: string): unknown {
  try {
    const parsed = JSON.parse(v) as unknown;
    return typeof parsed === 'string' ? v : parsed;
  } catch { return v; }
}

/**
 * The user's settings in defaultSettings.json's form (the suite's at the top, each app's under its id),
 * as Workspace > Export Settings as JSON writes them; `documentState` adds what
 * belongs to documents (where each was left), as the work environment's archive keeps it.
 */
export function exportSettings(documentState = false): Record<string, unknown> {
  const suite: Record<string, unknown> = {};
  const perApp: Record<string, Record<string, unknown>> = {};
  let keys: string[] = [];
  try { keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter(Boolean).sort(); } catch { /* none */ }
  for (const key of keys) {
    const colon = key.indexOf(':');
    if (colon < 0) continue;
    const scope = key.slice(0, colon), name = key.slice(colon + 1);
    if (!documentState && DOCUMENT_STATE.has(name)) continue;
    if (scope !== SUITE_SCOPE && !appIds.includes(scope)) continue;
    let v: string | null = null;
    try { v = localStorage.getItem(key); } catch { /* storage may be unavailable */ }
    if (v === null) continue;
    const out = scope === SUITE_SCOPE ? suite : (perApp[scope] ??= {});
    out[STORAGE_TO_ALIAS.get(name) ?? name] = decode(v);
  }
  return { ...suite, ...perApp };
}

/** Settings in defaultSettings.json's form, with the suite's and only `apps`' own. */
export function filterSettings(json: Record<string, unknown>, apps: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(json).filter(([k]) => !appIds.includes(k) || apps.includes(k)));
}

/** Stores settings given in defaultSettings.json's form (Workspace > Import); how many. */
export function importSettings(json: unknown): number {
  const entries = parseSettingsJson(json);
  for (const [k, v] of entries) localStorage.setItem(k, v);
  return entries.size;
}
