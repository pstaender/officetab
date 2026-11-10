import ui from '../generated/upstream-ui.json';

export interface MenuEntry { sep?: boolean; cmd?: string; items?: MenuEntry[] }
export interface ToolEntry { sep?: boolean; cmd?: string; visible?: boolean }

export const menubar = ui.menubar as MenuEntry[];
export const toolbars = ui.toolbars as Record<string, ToolEntry[]>;
const labels = ui.labels as Record<string, { label?: string; context?: string; popup?: string; tooltip?: string }>;
const shortcuts = ui.shortcuts as Record<string, string>;

const clean = (s: string) => s.replace(/~/g, '');
const base = (cmd: string) => cmd.split('?')[0]!;

/** Mirrors vcl's choice: a popup label wins in menus, then the module's context label. */
export function menuLabel(cmd: string): string {
  const l = labels[base(cmd)];
  return clean(l?.popup ?? l?.context ?? l?.label ?? cmd.replace('.uno:', ''));
}

export function tooltip(cmd: string): string {
  const l = labels[base(cmd)];
  return clean(l?.tooltip ?? l?.label ?? cmd.replace('.uno:', ''));
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Upstream key names look like `B_MOD1` or `F8_SHIFT_MOD1`. */
export function eventKeyName(e: KeyboardEvent): string {
  const code = e.code;
  let key = code.startsWith('Key') ? code.slice(3)
    : code.startsWith('Digit') ? code.slice(5)
    : /^F\d+$/.test(code) ? code
    : { Enter: 'RETURN', Tab: 'TAB', Space: 'SPACE', Backspace: 'BACKSPACE', Delete: 'DELETE', Insert: 'INSERT', Escape: 'ESCAPE', PageUp: 'PAGEUP', PageDown: 'PAGEDOWN', Home: 'HOME', End: 'END', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN' }[code] ?? '';
  if (!key) return '';
  if (e.shiftKey) key += '_SHIFT';
  if (isMac ? e.metaKey : e.ctrlKey) key += '_MOD1';
  if (e.altKey) key += '_MOD2';
  return key;
}

export const commandForKey = (name: string): string | undefined => shortcuts[name];

const reverse = new Map<string, string>();
for (const [k, c] of Object.entries(shortcuts)) {
  const cur = reverse.get(c);
  if (!cur || k.length < cur.length) reverse.set(c, k);
}

export function shortcutText(cmd: string): string {
  const k = reverse.get(base(cmd));
  if (!k) return '';
  const [key, ...mods] = k.split('_');
  const m = mods.map((x) => (x === 'MOD1' ? (isMac ? '⌘' : 'Ctrl') : x === 'MOD2' ? (isMac ? '⌥' : 'Alt') : isMac ? '⇧' : 'Shift'));
  return [...m, key].join(isMac ? '' : '+');
}

export { isMac };
