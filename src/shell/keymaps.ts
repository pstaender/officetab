// Keyboard shortcut maps (Tools > Options > Keyboard Shortcuts), shared by the apps of the suite:
// key names from keyboard events, the browsers' own shortcuts, import and export as JSON, and the
// user's map. Each app has its templates (built from its generated upstream-ui.json, whose
// shortcuts are Accelerators.xcu's global keys and the module's) and keeps its own map, as
// LibreOffice keeps shortcuts per module. No DOM at module level, so that it runs in Node's tests.
//
// A map binds upstream key names (vcl's accelerator names in Accelerators.xcu, `B_MOD1`,
// `F8_SHIFT_MOD1`) to commands. MOD1 is Ctrl, or Cmd on a Mac; MOD2 is Alt (Option); MOD3 is the
// Mac's Control key. Modifiers follow the key in the order SHIFT, MOD1, MOD2, MOD3.

export type Keymap = Record<string, string>;
/** A template's id (`default`, `libreoffice`, an app's own), or `custom`. */
export type KeymapChoice = string;

/**
 * An app's keymap templates: their ids in the order Tools > Options > Keyboard Shortcuts lists
 * them (`default` first, the application's keys) and their maps. Each id needs the shell texts
 * `keys.template.<id>` and `keys.hint.<id>`.
 */
export interface KeymapTemplates { readonly ids: readonly string[]; readonly maps: Readonly<Record<string, Keymap>> }

/**
 * The web shell's changes to LibreOffice's keys, the same in every app: Save As's shortcut belongs
 * to Download As, which replaces it. Save New Version gets Ctrl+Alt+V (V for version), which
 * upstream leaves free; Shift+Ctrl+V is Paste Special. Ctrl+/ (Cmd+/) opens Search Commands
 * besides upstream's Shift+Esc. Shift+Ctrl+R is left to the browser, which reloads the page
 * bypassing its cache. A command binds the key, null unbinds it.
 */
export const SHELL_KEYMAP_EDITS: Readonly<Record<string, string | null>> = { S_SHIFT_MOD1: '.uno:ExportTo', V_MOD1_MOD2: 'app:SaveVersion', DIVIDE_MOD1: '.uno:CommandPopup', R_SHIFT_MOD1: null };

/** A map with changes: a command binds the key, null unbinds it. */
export function overlayKeymap(base: Keymap, o: Readonly<Record<string, string | null>>): Keymap {
  const m: Keymap = { ...base };
  for (const [k, v] of Object.entries(o)) if (v === null) delete m[k]; else m[k] = v;
  return m;
}

export function keymapsEqual(a: Keymap, b: Keymap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
}

/** The template a map is, or custom when it is none of them. */
export function keymapChoiceOf(templates: KeymapTemplates, m: Keymap): KeymapChoice {
  return templates.ids.find((id) => keymapsEqual(m, templates.maps[id]!)) ?? 'custom';
}

// ---------------------------------------------------------------------------------------------
// Key names

/** The keys known by the character they type, wherever the layout puts them. */
const CHAR_KEYS: Record<string, string> = {
  '+': 'ADD', '-': 'SUBTRACT', '*': 'MULTIPLY', '/': 'DIVIDE', '.': 'POINT', ',': 'COMMA', '<': 'LESS', '>': 'GREATER',
  '=': 'EQUAL', '[': 'BRACKETLEFT', ']': 'BRACKETRIGHT', ';': 'SEMICOLON', ':': 'COLON', '#': 'NUMBERSIGN',
  '`': 'QUOTELEFT', "'": 'QUOTERIGHT', '~': 'TILDE',
};
/** The same keys by their place on a US keyboard, for when the character is another (Option on a Mac, Shift). */
const CODE_KEYS: Record<string, string> = {
  Minus: 'SUBTRACT', Equal: 'EQUAL', BracketLeft: 'BRACKETLEFT', BracketRight: 'BRACKETRIGHT', Semicolon: 'SEMICOLON',
  Quote: 'QUOTERIGHT', Backquote: 'QUOTELEFT', Comma: 'COMMA', Period: 'POINT', Slash: 'DIVIDE', IntlBackslash: 'LESS',
  NumpadAdd: 'ADD', NumpadSubtract: 'SUBTRACT', NumpadMultiply: 'MULTIPLY', NumpadDivide: 'DIVIDE', NumpadDecimal: 'POINT',
};
const NAMED_KEYS: Record<string, string> = {
  Enter: 'RETURN', NumpadEnter: 'RETURN', Tab: 'TAB', Space: 'SPACE', Backspace: 'BACKSPACE', Delete: 'DELETE', Insert: 'INSERT',
  Escape: 'ESCAPE', PageUp: 'PAGEUP', PageDown: 'PAGEDOWN', Home: 'HOME', End: 'END',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN', ContextMenu: 'CONTEXTMENU',
};

export interface KeyEventLike { code: string; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

const mods = (e: KeyEventLike, mac: boolean, shift: boolean): string =>
  (shift && e.shiftKey ? '_SHIFT' : '') + ((mac ? e.metaKey : e.ctrlKey) ? '_MOD1' : '') + (e.altKey ? '_MOD2' : '') + (mac && e.ctrlKey ? '_MOD3' : '');

/**
 * The key names a key event may stand for, the likeliest first; none for a modifier alone. Letters,
 * digits and other keys are named by their place; characters like "/" and ">" by the character the
 * layout gives (vcl's KEY_DIVIDE, KEY_GREATER), where the Shift it may take does not count, and
 * then by their place on a US keyboard, with Shift. A digit key typing such a character is named
 * by its place first, then by the character.
 */
export function eventKeyNames(e: KeyEventLike, mac: boolean): string[] {
  if (!mac && e.metaKey) return [];
  const code = e.code;
  const key = code.startsWith('Key') ? code.slice(3)
    : code.startsWith('Digit') ? code.slice(5)
    : /^Numpad\d$/.test(code) ? code.slice(6)
    : /^F\d+$/.test(code) ? code
    : NAMED_KEYS[code];
  const byChar = CHAR_KEYS[e.key] && CHAR_KEYS[e.key] + mods(e, mac, false);
  // A digit key may type a character too: "/" is Shift+7 on a German keyboard.
  if (key) return byChar ? [key + mods(e, mac, true), byChar] : [key + mods(e, mac, true)];
  const names: string[] = [];
  if (byChar) names.push(byChar);
  const byCode = CODE_KEYS[code];
  if (byCode && !names.includes(byCode + mods(e, mac, true))) names.push(byCode + mods(e, mac, true));
  return names;
}

/** The command a key event runs in a map, and the key name it matched. */
export function commandForEvent(m: Keymap, e: KeyEventLike, mac: boolean): { key: string; cmd: string } | undefined {
  for (const k of eventKeyNames(e, mac)) if (m[k]) return { key: k, cmd: m[k] };
  return undefined;
}

const KEY_TEXT: Record<string, string> = {
  ADD: '+', SUBTRACT: '-', MULTIPLY: '*', DIVIDE: '/', POINT: '.', COMMA: ',', LESS: '<', GREATER: '>', EQUAL: '=',
  BRACKETLEFT: '[', BRACKETRIGHT: ']', SEMICOLON: ';', COLON: ':', NUMBERSIGN: '#', QUOTELEFT: '`', QUOTERIGHT: "'", TILDE: '~',
  RETURN: 'Enter', TAB: 'Tab', SPACE: 'Space', BACKSPACE: 'Backspace', DELETE: 'Del', INSERT: 'Ins', ESCAPE: 'Esc',
  PAGEUP: 'PgUp', PAGEDOWN: 'PgDn', HOME: 'Home', END: 'End', LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓', CONTEXTMENU: 'Menu',
};
const MAC_KEY_TEXT: Record<string, string> = { RETURN: '↩', TAB: '⇥', BACKSPACE: '⌫', DELETE: '⌦', ESCAPE: '⎋', PAGEUP: '⇞', PAGEDOWN: '⇟', HOME: '↖', END: '↘' };

/** A key name as menus show it: Shift+Ctrl+S, or ⇧⌘S on a Mac. */
export function keyText(name: string, mac: boolean): string {
  const [key, ...ms] = name.split('_');
  const m = ms.map((x) => (x === 'MOD1' ? (mac ? '⌘' : 'Ctrl') : x === 'MOD2' ? (mac ? '⌥' : 'Alt') : x === 'MOD3' ? (mac ? '⌃' : 'Ctrl') : mac ? '⇧' : 'Shift'));
  const k = (mac && MAC_KEY_TEXT[key!]) || KEY_TEXT[key!] || key!;
  return [...m, k].join(mac ? '' : '+');
}

/** Whether a string is a key name: a key and modifiers in their order. */
export const isKeyName = (s: string): boolean => /^(?:[A-Z0-9]+)(?:_SHIFT)?(?:_MOD1)?(?:_MOD2)?(?:_MOD3)?$/.test(s);

// The keys menus show: the shortest, but never a dedicated key (Sun keyboards' PASTE, COPY, UNDO …)
// that most keyboards lack.
const DEDICATED_KEYS = new Set(['PASTE', 'COPY', 'CUT', 'UNDO', 'REPEAT', 'FIND', 'OPEN', 'PROPERTIES', 'FRONT', 'HELP', 'CONTEXTMENU']);
/** Each command's key to show in menus. */
export function menuKeys(m: Keymap, mac: boolean): Map<string, string> {
  const reverse = new Map<string, string>();
  for (const [k, c] of Object.entries(m)) {
    if (DEDICATED_KEYS.has(k.split('_')[0]!)) continue;
    // A Mac's Control key cannot be pressed elsewhere.
    if (!mac && k.endsWith('_MOD3')) continue;
    const cur = reverse.get(c);
    if (!cur || k.length < cur.length) reverse.set(c, k);
  }
  return reverse;
}

/** The keys bound to a command, in the map's order. */
export const keysOf = (m: Keymap, cmd: string): string[] => Object.keys(m).filter((k) => m[k] === cmd);

// ---------------------------------------------------------------------------------------------
// The browsers' own keys

export type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
export const BROWSER_NAMES: Record<Browser, string> = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', other: '' };

export function detectBrowser(userAgent: string): Browser {
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS\//.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

interface BrowserKey {
  /** The action, a key of `keys.browser.*` in the shell's texts. */
  action: string;
  /** Mac only, or everywhere else only; both when absent. */
  mac?: boolean;
  /** The browsers using the key; all when absent. */
  browsers?: Browser[];
  /** The browser handles the key itself and never passes it to the page. */
  blocked?: boolean;
}
const CHROMIUM: Browser[] = ['chrome', 'edge'];
/** The browsers' own keys (their documented keyboard shortcuts) that a document may lose to them. */
const BROWSER_KEYS: Record<string, BrowserKey[]> = {
  T_MOD1: [{ action: 'newTab', blocked: true }],
  T_SHIFT_MOD1: [{ action: 'reopenTab', blocked: true }],
  N_MOD1: [{ action: 'newWindow', blocked: true }],
  N_SHIFT_MOD1: [{ action: 'privateWindow', browsers: [...CHROMIUM, 'safari'], blocked: true }, { action: 'reopenWindow', browsers: ['firefox'], blocked: true }],
  P_SHIFT_MOD1: [{ action: 'privateWindow', browsers: ['firefox'], blocked: true }],
  W_MOD1: [{ action: 'closeTab', blocked: true }],
  W_SHIFT_MOD1: [{ action: 'closeWindow', blocked: true }],
  F4_MOD1: [{ action: 'closeTab', mac: false, blocked: true }],
  F4_MOD2: [{ action: 'closeWindow', mac: false, blocked: true }],
  Q_MOD1: [{ action: 'quit', mac: true, blocked: true }],
  Q_SHIFT_MOD1: [{ action: 'quit', mac: false, browsers: CHROMIUM, blocked: true }],
  H_MOD1: [{ action: 'hide', mac: true, blocked: true }, { action: 'history', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  M_MOD1: [{ action: 'minimize', mac: true, blocked: true }],
  COMMA_MOD1: [{ action: 'preferences', mac: true }],
  TAB_MOD1: [{ action: 'switchTab', blocked: true }],
  TAB_SHIFT_MOD1: [{ action: 'switchTab', blocked: true }],
  PAGEUP_MOD1: [{ action: 'switchTab', mac: false, blocked: true }],
  PAGEDOWN_MOD1: [{ action: 'switchTab', mac: false, blocked: true }],
  ...Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => [`${d}_MOD1`, [{ action: 'switchTab', blocked: true }]])),
  ...Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => [`${d}_MOD2`, [{ action: 'switchTab', mac: false, browsers: ['firefox'] as Browser[] }]])),
  R_MOD1: [{ action: 'reload' }],
  R_SHIFT_MOD1: [{ action: 'hardReload' }],
  F5: [{ action: 'reload', mac: false }],
  F5_MOD1: [{ action: 'hardReload', mac: false }],
  F5_SHIFT: [{ action: 'hardReload', mac: false }],
  L_MOD1: [{ action: 'addressBar' }],
  D_MOD2: [{ action: 'addressBar', mac: false }],
  F6: [{ action: 'addressBar' }],
  E_MOD1: [{ action: 'searchBar', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  K_MOD1: [{ action: 'searchBar', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  D_MOD1: [{ action: 'bookmark' }],
  D_SHIFT_MOD1: [{ action: 'bookmarkAll' }],
  B_SHIFT_MOD1: [{ action: 'bookmarksBar', browsers: [...CHROMIUM, 'firefox'] }],
  O_SHIFT_MOD1: [{ action: 'bookmarksManager', browsers: [...CHROMIUM, 'firefox'] }],
  B_MOD1_MOD2: [{ action: 'bookmarksManager', mac: true, browsers: CHROMIUM }],
  J_MOD1: [{ action: 'downloads', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  J_SHIFT_MOD1: [{ action: 'downloads', mac: true, browsers: [...CHROMIUM, 'firefox'] }, { action: 'devTools', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  Y_MOD1: [{ action: 'history', mac: true, browsers: CHROMIUM }],
  Y_SHIFT_MOD1: [{ action: 'downloads', mac: false, browsers: ['firefox'] }],
  H_SHIFT_MOD1: [{ action: 'history', browsers: ['firefox'] }, { action: 'homePage', mac: true, browsers: ['safari'] }],
  HOME_MOD2: [{ action: 'homePage', mac: false }],
  I_SHIFT_MOD1: [{ action: 'devTools', mac: false }],
  C_SHIFT_MOD1: [{ action: 'devTools', mac: false }],
  K_SHIFT_MOD1: [{ action: 'devTools', mac: false, browsers: ['firefox'] }],
  E_SHIFT_MOD1: [{ action: 'devTools', mac: false, browsers: ['firefox'] }],
  F12: [{ action: 'devTools', mac: false }],
  I_MOD1_MOD2: [{ action: 'devTools', mac: true }],
  J_MOD1_MOD2: [{ action: 'devTools', mac: true }],
  C_MOD1_MOD2: [{ action: 'devTools', mac: true }],
  U_MOD1: [{ action: 'viewSource', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  U_MOD1_MOD2: [{ action: 'viewSource', mac: true }],
  DELETE_SHIFT_MOD1: [{ action: 'clearData', mac: false }],
  BACKSPACE_SHIFT_MOD1: [{ action: 'clearData', mac: true }],
  A_SHIFT_MOD1: [{ action: 'tabSearch', browsers: CHROMIUM }, { action: 'addons', browsers: ['firefox'] }],
  M_SHIFT_MOD1: [{ action: 'profiles', browsers: CHROMIUM }, { action: 'responsive', mac: false, browsers: ['firefox'] }],
  F11: [{ action: 'fullScreen', mac: false }],
  F_MOD1_MOD3: [{ action: 'fullScreen', mac: true }],
  LEFT_MOD2: [{ action: 'back', mac: false }],
  RIGHT_MOD2: [{ action: 'forward', mac: false }],
  BRACKETLEFT_MOD1: [{ action: 'back', mac: true }],
  BRACKETRIGHT_MOD1: [{ action: 'forward', mac: true }],
  LEFT_MOD1: [{ action: 'back', mac: true, browsers: ['chrome', 'edge', 'firefox'] }],
  RIGHT_MOD1: [{ action: 'forward', mac: true, browsers: ['chrome', 'edge', 'firefox'] }],
  F1: [{ action: 'help', mac: false, browsers: CHROMIUM }],
  F3: [{ action: 'findNext', mac: false }],
  G_MOD1: [{ action: 'findNext' }],
  F_MOD1: [{ action: 'find' }],
  EQUAL_MOD1: [{ action: 'zoom' }], ADD_MOD1: [{ action: 'zoom' }], SUBTRACT_MOD1: [{ action: 'zoom' }], '0_MOD1': [{ action: 'zoom' }],
  F7: [{ action: 'caretBrowsing', mac: false, browsers: [...CHROMIUM, 'firefox'] }],
  F10: [{ action: 'menu', mac: false }],
};

/** The browser's own uses of a key on this platform (all browsers' when the browser is unknown). */
export function browserUses(name: string, browser: Browser, mac: boolean): { action: string; blocked: boolean }[] {
  return (BROWSER_KEYS[name] ?? [])
    .filter((u) => (u.mac === undefined || u.mac === mac) && (!u.browsers || browser === 'other' || u.browsers.includes(browser)))
    .map((u) => ({ action: u.action, blocked: !!u.blocked }));
}

// ---------------------------------------------------------------------------------------------
// Files

const FILE_TYPE = 'libreoffice-web-keymap';

/** A map as a JSON file. */
export function exportKeymap(m: Keymap, template: KeymapChoice): string {
  const shortcuts = Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]!]));
  return `${JSON.stringify({ type: FILE_TYPE, version: 1, template, shortcuts }, null, 2)}\n`;
}

/** A map from a JSON file (ours, or a plain object of key names and commands); throws on anything else. */
export function importKeymap(text: string): Keymap {
  const j: unknown = JSON.parse(text);
  if (!j || typeof j !== 'object') throw new Error('not a keymap');
  const o = j as { type?: unknown; shortcuts?: unknown };
  const src = o.type === FILE_TYPE ? o.shortcuts : o;
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('not a keymap');
  const m: Keymap = {};
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (k === 'type' || k === 'version' || k === 'template') continue;
    if (!isKeyName(k) || typeof v !== 'string' || !/^(?:\.uno|app):[A-Za-z0-9.]+$/.test(v)) throw new Error('not a keymap');
    m[k] = v;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// The user's map

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/**
 * The map in use, kept in the browser under the app's key (`writer:keymap`): none stored means the
 * default template. The last custom map is kept too (`writer:keymap.custom`), so that choosing
 * Custom again after a template brings it back.
 */
export class KeymapStore {
  private m: Keymap;
  private custom: Keymap | null;
  private storage: KeyValueStorage | null;
  private listeners = new Set<() => void>();
  readonly templates: KeymapTemplates;
  private readonly ACTIVE: string;
  private readonly CUSTOM: string;

  constructor(storage: KeyValueStorage | null, templates: KeymapTemplates, key: string) {
    this.storage = storage;
    this.templates = templates;
    this.ACTIVE = key;
    this.CUSTOM = `${key}.custom`;
    this.m = this.read(this.ACTIVE) ?? templates.maps.default!;
    this.custom = this.read(this.CUSTOM);
  }

  private read(k: string): Keymap | null {
    try { const s = this.storage?.getItem(k); return s ? importKeymap(s) : null; } catch { return null; }
  }
  private write(k: string, m: Keymap | null): void {
    try { if (m) this.storage?.setItem(k, JSON.stringify(m)); else this.storage?.removeItem(k); } catch { /* storage unavailable */ }
  }

  get map(): Keymap { return this.m; }
  get choice(): KeymapChoice { return keymapChoiceOf(this.templates, this.m); }
  get hasCustom(): boolean { return this.custom !== null || this.choice === 'custom'; }

  subscribe(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }

  /** Uses a map; one that is no template becomes the custom map. */
  set(m: Keymap): void {
    this.m = m;
    const choice = keymapChoiceOf(this.templates, m);
    this.write(this.ACTIVE, choice === 'default' ? null : m);
    if (choice === 'custom') { this.custom = m; this.write(this.CUSTOM, m); }
    for (const f of this.listeners) f();
  }

  /** Chooses a template, or the last custom map. */
  choose(c: KeymapChoice): void {
    if (c === 'custom') { if (this.custom) this.set(this.custom); return; }
    this.set({ ...this.templates.maps[c]! });
  }

  /** Binds a key to a command, taking it from the command it had; returns that command. */
  bind(key: string, cmd: string): string | undefined {
    const was = this.m[key];
    this.set({ ...this.m, [key]: cmd });
    return was !== cmd ? was : undefined;
  }

  unbind(key: string): void {
    const m = { ...this.m };
    delete m[key];
    this.set(m);
  }
}
