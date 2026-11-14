// Tools > Options > Keyboard Shortcuts: a template (the application's keys, LibreOffice's, Word's
// for Windows or for Mac) or the user's own map, each command's keys with ways to add and remove
// them, warnings for keys the browser uses, and import and export as JSON.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Controller } from '../controller.ts';
import { COMMANDS } from '../commands.ts';
import { t } from '../i18n.ts';
import {
  BROWSER_NAMES, KEYMAP_TEMPLATES, detectBrowser, browserUses, eventKeyNames, exportKeymap, importKeymap, keyText, keysOf,
  type KeymapChoice,
} from '../keymaps.ts';
import { isMac, keymap, menuLabel, menubar, tooltip, type MenuEntry } from './labels.ts';

const browser = detectBrowser(navigator.userAgent);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn', 'OS']);

/** What the browser does with a key, as a warning; '' when it leaves the key alone. */
export function browserWarning(key: string): string {
  const uses = browserUses(key, browser, isMac);
  if (!uses.length) return '';
  const name = BROWSER_NAMES[browser] || t('keys.yourBrowser');
  const actions = [...new Set(uses.map((u) => t(`keys.browser.${u.action}`)))].join(', ');
  return t(uses.some((u) => u.blocked) ? 'keys.blocked' : 'keys.reserved', { key: keyText(key, isMac), browser: name, action: actions });
}

/** Where each command is in the menus (Format ▸ Text), the first place it appears. */
function menuPaths(): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (items: MenuEntry[] | undefined, path: string[]) => {
    for (const i of items ?? []) {
      if (!i.cmd) continue;
      if (i.items) walk(i.items, [...path, menuLabel(i.cmd).replace(/\.\.\.$|…$/, '')]);
      else if (!paths.has(i.cmd.split('?')[0]!)) paths.set(i.cmd.split('?')[0]!, path.join(' ▸ '));
    }
  };
  walk(menubar, []);
  return paths;
}

export function KeyboardSettings({ c }: { c: Controller }) {
  const [, refresh] = useState(0);
  useEffect(() => keymap.subscribe(() => { refresh((n) => n + 1); c.notify(); }), [c]);
  const [filter, setFilter] = useState('');
  const [onlyBound, setOnlyBound] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const m = keymap.map;
  const choice = keymap.choice;

  // The commands the application runs, by label, with their place in the menus (or their tooltip,
  // for those only on toolbars) to tell apart commands of the same name.
  const commands = useMemo(() => {
    const paths = menuPaths();
    return Object.keys(COMMANDS)
      .map((cmd) => {
        const label = menuLabel(cmd).replace(/\.\.\.$|…$/, '');
        const tip = cmd.startsWith('app:') ? '' : tooltip(cmd);
        return { cmd, label, where: paths.get(cmd) ?? (tip !== label ? tip : '') };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.where.localeCompare(b.where));
  }, []);
  const q = filter.trim().toLowerCase();
  const rows = commands.filter((r) => {
    const keys = keysOf(m, r.cmd);
    if (onlyBound && !keys.length) return false;
    return !q || r.label.toLowerCase().includes(q) || r.where.toLowerCase().includes(q) || r.cmd.toLowerCase().includes(q) || keys.some((k) => keyText(k, isMac).toLowerCase().includes(q));
  });

  const record = (cmd: string, e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (MODIFIER_KEYS.has(e.key)) return;
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Tab moves on, Escape stops recording; with a modifier both are keys to record.
    if (plain && e.key === 'Tab') { setCapture(null); return; }
    e.preventDefault();
    e.stopPropagation();
    if (plain && e.key === 'Escape') { setCapture(null); return; }
    const key = eventKeyNames(e.nativeEvent, isMac)[0];
    if (!key) return;
    setCapture(null);
    const was = keymap.bind(key, cmd);
    const out: { text: string; warn: boolean }[] = [{ text: t('keys.assigned', { key: keyText(key, isMac), command: menuLabel(cmd) }), warn: false }];
    if (was) out.push({ text: t('keys.reassigned', { command: menuLabel(was) }), warn: true });
    const w = browserWarning(key);
    if (w) out.push({ text: w, warn: true });
    setNotice(out);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportKeymap(m, choice)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `keyboard-shortcuts-${choice}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const upload = (f: File) => void f.text().then((s) => {
    keymap.set(importKeymap(s));
    setNotice([{ text: t('keys.imported', { name: t(`keys.template.${keymap.choice}`) }), warn: false }]);
  }).catch(() => setNotice([{ text: t('keys.importError'), warn: true }]));

  const choices: KeymapChoice[] = [...KEYMAP_TEMPLATES, 'custom'];
  return (
    <div className="keyboard-settings">
      <h3>{t('keys.title')}</h3>
      <label className="field"><span>{t('keys.scheme')}</span>
        <select value={choice} onChange={(e) => { keymap.choose(e.target.value as KeymapChoice); setNotice([]); }}>
          {choices.map((id) => <option key={id} value={id} disabled={id === 'custom' && !keymap.hasCustom}>{t(`keys.template.${id}`)}</option>)}
        </select>
      </label>
      <p className="muted">{t(`keys.hint.${choice}`)}</p>
      <div className="button-row">
        <button type="button" onClick={() => fileRef.current?.click()}>{t('keys.import')}</button>
        <button type="button" onClick={download}>{t('keys.export')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) upload(f);
        }} />
      </div>
      <div className="keys-filter">
        <input type="search" aria-label={t('keys.filter')} placeholder={t('keys.filter')} value={filter} onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        <label className="check"><input type="checkbox" checked={onlyBound} onChange={(e) => setOnlyBound(e.target.checked)} /> {t('keys.onlyBound')}</label>
      </div>
      <div className="keys-notice" role="status" aria-live="polite">
        {notice.map((n, k) => <p key={k} className={n.warn ? 'warn' : undefined}>{n.warn ? '⚠ ' : ''}{n.text}</p>)}
      </div>
      <table className="keys-table">
        <thead><tr><th>{t('keys.command')}</th><th>{t('keys.keys')}</th></tr></thead>
        <tbody>
          {rows.map(({ cmd, label, where }) => (
            <tr key={cmd}>
              <td title={cmd}>{label}{where && <span className="muted keys-where">{where}</span>}</td>
              <td>
                <span className="keys-list">
                  {keysOf(m, cmd).map((k) => {
                    const w = browserWarning(k);
                    return (
                      <span key={k} className={w ? 'key-chip warn' : 'key-chip'} title={w || undefined}>
                        {w && <span aria-hidden="true">⚠ </span>}<kbd>{keyText(k, isMac)}</kbd>
                        <button type="button" aria-label={t('keys.remove', { key: keyText(k, isMac), command: label })} onClick={() => { keymap.unbind(k); setNotice([]); }}>×</button>
                      </span>
                    );
                  })}
                  {capture === cmd
                    ? <button type="button" className="key-capture" autoFocus onKeyDown={(e) => record(cmd, e)} onBlur={() => setCapture(null)}>{t('keys.press')}</button>
                    : <button type="button" className="key-add" aria-label={t('keys.add', { command: label })} title={t('keys.add', { command: label })} onClick={() => setCapture(cmd)}>+</button>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
