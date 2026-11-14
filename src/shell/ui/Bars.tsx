// The shared parts of the menus and toolbars: the menu bar and its menus, context menus, the
// document's title, and the toolbar's buttons and simple controls. The app's command table, menus
// and labels come from its registry (registry.ts); its own bars (Writer's ToolBar, StatusBar) use
// these.
import type { CSSProperties, Ref } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnyController as Controller } from '../appcontroller.ts';
import { iconClass, iconUrl } from '../icons.ts';
import { t } from '../i18n.ts';
import type { MenuEntry } from './labels.ts';
import { appRegistry, buttonLabel, commandOf, dispatch, menuLabel, menubar, popupmenus, shortcutText, tooltip } from './registry.ts';

export { iconUrl };

export const isImplemented = (cmd: string) => cmd.split('?')[0]! in appRegistry().commands;

export function isEnabled(c: Controller, cmd: string): boolean {
  const k = commandOf(cmd);
  return !!k && (!k.enabled || k.enabled(c));
}

const hasImplemented = (e: MenuEntry): boolean => (e.items ? e.items.some(hasImplemented) : !!e.cmd && isImplemented(e.cmd));

export function MenuItems({ c, items, close, style, label, listRef }: { c: Controller; items: MenuEntry[]; close: () => void; style?: CSSProperties; label?: string; listRef?: Ref<HTMLUListElement> }) {
  return (
    <ul className="menu-popup" role="menu" style={style} aria-label={label} ref={listRef}>
      {items.map((it, i) => {
        if (it.sep || !it.cmd) return <li key={i} className="menu-sep" role="separator" />;
        if (it.items) {
          return (
            <li key={i} className={`menu-item has-sub${hasImplemented(it) ? '' : ' disabled'}`} role="menuitem" aria-haspopup="menu" tabIndex={-1}>
              <span className="menu-label">{menuLabel(it.cmd)}</span>
              <MenuItems c={c} items={it.items} close={close} />
            </li>
          );
        }
        // A popup menu controller's command: the submenu it fills (HeaderMenuController and the like).
        const popup = appRegistry().popupControllers?.[it.cmd];
        if (popup) {
          const entries = popup(c);
          return (
            <li key={i} className={`menu-item has-sub${entries.length ? '' : ' disabled'}`} role="menuitem" aria-haspopup="menu" tabIndex={-1}>
              <span className="menu-label">{menuLabel(it.cmd)}</span>
              <ul className="menu-popup" role="menu">
                {entries.map((e, k) => e.sep ? <li key={k} className="menu-sep" role="separator" /> : (
                  <li key={k} role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={e.checked} tabIndex={-1} className="menu-item"
                    onClick={(ev) => { ev.stopPropagation(); close(); e.run?.(); }}>
                    <span className="menu-check">{e.checked ? '✓' : ''}</span>
                    <span className="menu-label">{e.label}</span>
                    <span className="menu-key" />
                  </li>
                ))}
              </ul>
            </li>
          );
        }
        const enabled = isEnabled(c, it.cmd);
        const cmd = it.cmd;
        const checked = commandOf(cmd)?.checked?.(c);
        return (
          <li key={i} role="menuitem" tabIndex={-1} aria-disabled={!enabled} className={`menu-item${enabled ? '' : ' disabled'}`}
            title={isImplemented(cmd) ? undefined : 'Not ported yet'}
            onClick={() => { if (enabled) { close(); dispatch(c, cmd); c.focusEditor(); } }}>
            <span className="menu-check">{checked ? '✓' : ''}</span>
            <span className="menu-label">{menuLabel(cmd)}</span>
            <span className="menu-key">{shortcutText(cmd)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A context menu's entries as vcl shows them (MenuFlags::HideDisabledEntries, as framework sets it
 * for context menus unless DontHideDisabledEntry): without disabled and unported commands, without
 * empty submenus, and without separators at either end or next to each other.
 */
export function VisibleEntries(c: Controller, items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (it.sep || !it.cmd) { if (out.length && !out[out.length - 1]!.sep) out.push({ sep: true }); continue; }
    if (it.items) {
      const sub = VisibleEntries(c, it.items);
      if (sub.length) out.push({ cmd: it.cmd, items: sub });
    } else if (isImplemented(it.cmd) && isEnabled(c, it.cmd)) out.push(it);
  }
  while (out.length && out[out.length - 1]!.sep) out.pop();
  return out;
}

/**
 * SfxDispatcher::ExecutePopup: the context menu a shell registers (RegisterPopupMenu), at a point
 * of the window; it stays within the window and closes on a click elsewhere or Escape.
 */
export function ContextMenu({ c, name, x, y, close }: { c: Controller; name: string; x: number; y: number; close: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const items = VisibleEntries(c, popupmenus()[name] ?? []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); c.focusEditor(); return; }
      // Up and Down move between the entries, Enter runs one, Right opens its submenu.
      const list = ref.current;
      if (!list) return;
      const all = [...list.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((el) => el.offsetParent !== null);
      const i = all.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length] ?? all[0];
        next?.focus();
      } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); all[i]!.click(); }
      else if (e.key === 'ArrowRight' && i >= 0) {
        const sub = all[i]!.querySelector<HTMLElement>('.menu-popup [role="menuitem"]');
        if (sub) { e.preventDefault(); all[i]!.classList.add('open'); sub.focus(); }
      } else if (e.key === 'ArrowLeft') {
        const parent = (document.activeElement as HTMLElement | null)?.parentElement?.closest('.has-sub') as HTMLElement | null;
        if (parent) { e.preventDefault(); parent.classList.remove('open'); parent.focus(); }
      }
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); };
  }, [c, close]);
  if (!items.length) return null;
  return <div className="context-menu" onContextMenu={(e) => e.preventDefault()}><MenuItems c={c} items={items} close={close} listRef={ref} label={t('contextmenu.label')} style={{ position: 'fixed', left: pos.left, top: pos.top }} /></div>;
}

/**
 * The document's name, always shown and editable in place: Enter or leaving the field renames
 * the document, Escape restores the name. A dot marks unsaved changes.
 */
export function DocTitle({ c }: { c: Controller }) {
  const modified = c.isModified();
  const commit = (el: HTMLInputElement) => { const n = el.value.trim(); if (n && n !== c.name) c.rename(n); else el.value = c.name; };
  return (
    <span className="doc-title">
      {modified && <span className="doc-modified" title={t('doctitle.modified')} aria-label={t('doctitle.modified')}>●</span>}
      <input key={c.name} aria-label={t('doctitle.label')} title={t('doctitle.label')} defaultValue={c.name} spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); c.focusEditor(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = c.name; c.focusEditor(); }
        }}
        onBlur={(e) => commit(e.currentTarget)} />
    </span>
  );
}

export function MenuBar({ c }: { c: Controller }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); c.focusEditor(); } };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open, c]);
  return (
    <div className="menubar" role="menubar" ref={ref}>
      {menubar().map((m, i) => (
        <div key={m.cmd} className={`menu-root${open === i ? ' open' : ''}`} onMouseEnter={() => { if (open !== null) setOpen(i); }}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={open === i} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(open === i ? null : i)}>
            {menuLabel(m.cmd!)}
          </button>
          {open === i && m.items && <MenuItems c={c} items={m.items} close={() => setOpen(null)} />}
        </div>
      ))}
      <DocTitle c={c} />
    </div>
  );
}

export function ToolButton({ c, cmd, labeled = false }: { c: Controller; cmd: string; labeled?: boolean }) {
  const k = commandOf(cmd)!;
  const url = iconUrl(cmd);
  const pressed = k.checked?.(c) ?? false;
  const text = tooltip(cmd);
  const key = shortcutText(cmd);
  return (
    <button className={`tool${pressed ? ' on' : ''}${labeled && url ? ' labeled' : ''}`} aria-label={text} aria-pressed={k.checked ? pressed : undefined} title={key ? `${text} (${key})` : text}
      disabled={!isEnabled(c, cmd)} onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, cmd)}>
      {url ? <img src={url} className={iconClass(cmd)} alt="" draggable={false} /> : <span>{text}</span>}
      {labeled && url && <span className="tool-label">{buttonLabel(cmd)}</span>}
    </button>
  );
}

/**
 * svx grafctrl.cxx ImplGrafControl: an image colour attribute's icon and spin field, which
 * dispatches its command with the value on Enter or when the field loses the focus.
 */
export function GrafSpin({ c, cmd, value, min, max, step = 1, unit = '%' }: { c: Controller; cmd: string; value: number; min: number; max: number; step?: number; unit?: string }) {
  const url = iconUrl(cmd), label = tooltip(cmd);
  const commit = (el: HTMLInputElement) => {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) { el.value = String(value); return; }
    const clamped = Math.max(min, Math.min(max, v));
    if (clamped !== value) dispatch(c, cmd, { [cmd.slice(5)]: cmd === '.uno:GrafGamma' ? Math.round(clamped * 100) : clamped });
    else el.value = String(value);
  };
  return (
    <label className="graf-spin" title={label}>
      {url ? <img src={url} className={iconClass(cmd)} alt="" draggable={false} /> : null}
      <input type="number" aria-label={label} min={min} max={max} step={step} key={`${cmd}:${value}`} defaultValue={value} disabled={!isEnabled(c, cmd)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); c.focusEditor(); } }} onBlur={(e) => commit(e.currentTarget)} />
      {unit && <span className="graf-unit">{unit}</span>}
    </label>
  );
}

/** A toolbar popup as a list: its icon, and the choice dispatched as the command's argument. */
export function ToolPopup({ c, cmd, options }: { c: Controller; cmd: string; options: [number, string][] }) {
  const url = iconUrl(cmd), label = tooltip(cmd);
  return (
    <label className="tool tool-popup" title={label}>
      {url ? <img src={url} className={iconClass(cmd)} alt="" draggable={false} /> : <span>{label}</span>}
      <select aria-label={label} value="" disabled={!isEnabled(c, cmd)} onChange={(e) => { if (e.target.value) { dispatch(c, cmd, { [cmd.slice(5)]: Number(e.target.value) }); c.focusEditor(); } }}>
        <option value="" disabled>{label}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** A toolbar colour control: the colour dispatched as 0xRRGGBB. */
export function ToolColor({ c, cmd, value }: { c: Controller; cmd: string; value: string }) {
  const url = iconUrl(cmd), label = tooltip(cmd);
  return (
    <label className="tool colorpick" title={label}>
      {url ? <img src={url} className={iconClass(cmd)} alt="" draggable={false} style={{ borderBottom: `3px solid ${value}` }} /> : <span style={{ background: value }}>■</span>}
      <input type="color" aria-label={label} value={value} disabled={!isEnabled(c, cmd)} onChange={(e) => dispatch(c, cmd, { [cmd.slice(5)]: parseInt(e.target.value.slice(1), 16) })} />
    </label>
  );
}
