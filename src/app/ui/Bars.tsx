import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../controller.ts';
import { COMMANDS, dispatch } from '../commands.ts';
import icons from '../generated/icons.json';
import { menuLabel, menubar, shortcutText, toolbars, tooltip, type MenuEntry } from './labels.ts';

const FONT_FAMILIES = ['Liberation Serif', 'Liberation Sans', 'Liberation Mono', 'Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana'];
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const iconUrl = (cmd: string) => {
  const svg = (icons as Record<string, string>)[cmd];
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null;
};

const isImplemented = (cmd: string) => cmd.split('?')[0]! in COMMANDS;

function isEnabled(c: Controller, cmd: string): boolean {
  const k = COMMANDS[cmd.split('?')[0]!];
  return !!k && (!k.enabled || k.enabled(c));
}

const hasImplemented = (e: MenuEntry): boolean => (e.items ? e.items.some(hasImplemented) : !!e.cmd && isImplemented(e.cmd));

function MenuItems({ c, items, close }: { c: Controller; items: MenuEntry[]; close: () => void }) {
  return (
    <ul className="menu-popup" role="menu">
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
        const enabled = isEnabled(c, it.cmd);
        const cmd = it.cmd;
        const checked = COMMANDS[cmd.split('?')[0]!]?.checked?.(c);
        return (
          <li key={i} role="menuitem" aria-disabled={!enabled} className={`menu-item${enabled ? '' : ' disabled'}`}
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
      {menubar.map((m, i) => (
        <div key={m.cmd} className={`menu-root${open === i ? ' open' : ''}`} onMouseEnter={() => { if (open !== null) setOpen(i); }}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={open === i} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(open === i ? null : i)}>
            {menuLabel(m.cmd!)}
          </button>
          {open === i && m.items && <MenuItems c={c} items={m.items} close={() => setOpen(null)} />}
        </div>
      ))}
      <span className="doc-title" title="Rename document" onDoubleClick={() => { const n = prompt('Document name', c.name); if (n !== null) c.rename(n.trim()); }}>{c.title}</span>
    </div>
  );
}

function ToolButton({ c, cmd }: { c: Controller; cmd: string }) {
  const k = COMMANDS[cmd]!;
  const url = iconUrl(cmd);
  const pressed = k.checked?.(c) ?? false;
  const text = tooltip(cmd);
  const key = shortcutText(cmd);
  return (
    <button className={`tool${pressed ? ' on' : ''}`} aria-label={text} aria-pressed={k.checked ? pressed : undefined} title={key ? `${text} (${key})` : text}
      disabled={!isEnabled(c, cmd)} onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, cmd)}>
      {url ? <img src={url} alt="" draggable={false} /> : <span>{text}</span>}
    </button>
  );
}

const twipsToPt = (t: number) => Math.round((t / 20) * 10) / 10;

export function ToolBar({ c }: { c: Controller }) {
  const sh = c.sh;
  // Only commands that work are shown: unlike the menus, the toolbar stays minimal.
  const items = (name: string) => toolbars[name]!.filter((t) => t.sep || (t.visible && t.cmd && isImplemented(t.cmd)));
  const tidy = (list: typeof toolbars[string]) => list.filter((t, i) => !t.sep || (i > 0 && !list[i - 1]!.sep));
  const font = sh.GetAttr('RES_CHRATR_FONT');
  const size = twipsToPt(sh.GetAttr('RES_CHRATR_FONTSIZE'));
  const families = FONT_FAMILIES.includes(font) ? FONT_FAMILIES : [font, ...FONT_FAMILIES];
  const color = sh.GetAttr('RES_CHRATR_COLOR') ?? '#000000';
  const back = sh.GetAttr('RES_CHRATR_BACKGROUND') ?? '#ffff00';
  const render = (list: typeof toolbars[string]) => tidy(list).map((t, i) => (t.sep ? <span key={i} className="tool-sep" /> : <ToolButton key={t.cmd} c={c} cmd={t.cmd!} />));
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {render(items('standardbar'))}
      <span className="tool-sep" />
      <select aria-label="Paragraph style" data-testid="style-select" value={sh.GetCurTextFormatColl()} onChange={(e) => { sh.SetTextFormatColl(e.target.value); c.focusEditor(); }}>
        {[...sh.m_pDoc.m_aTextFormatColls.keys()].map((n) => <option key={n}>{n}</option>)}
      </select>
      <select aria-label="Font name" value={font} onChange={(e) => { sh.SetCharAttr({ RES_CHRATR_FONT: e.target.value }); c.focusEditor(); }}>
        {families.map((f) => <option key={f}>{f}</option>)}
      </select>
      <input aria-label="Font size" className="font-size" list="font-sizes" key={`${size}`} defaultValue={size} onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const v = parseFloat(e.currentTarget.value);
        if (v > 0 && v <= 999) sh.SetCharAttr({ RES_CHRATR_FONTSIZE: Math.round(v * 20) });
        c.focusEditor();
      }} />
      <datalist id="font-sizes">{FONT_SIZES.map((s) => <option key={s} value={s} />)}</datalist>
      <span className="tool-sep" />
      {render(items('textobjectbar'))}
      <span className="tool-sep" />
      <label className="tool colorpick" title="Font color">
        <span style={{ borderBottomColor: color }}>A</span>
        <input type="color" aria-label="Font color" value={color} onChange={(e) => sh.SetCharAttr({ RES_CHRATR_COLOR: e.target.value })} />
      </label>
      <label className="tool colorpick" title="Character highlighting color">
        <span style={{ background: back }}>ab</span>
        <input type="color" aria-label="Character highlighting color" value={back} onChange={(e) => sh.SetCharAttr({ RES_CHRATR_BACKGROUND: e.target.value })} />
      </label>
    </div>
  );
}

export function StatusBar({ c }: { c: Controller }) {
  const sh = c.sh;
  const { words, chars } = sh.GetWordCount();
  return (
    <div className="statusbar" role="status">
      <span data-testid="page-status">Page {sh.GetPageNumber()} of {sh.m_pRoot.pages.length}</span>
      <span>{words} words, {chars} characters</span>
      <span>{sh.GetCurTextFormatColl()}</span>
      <span className="spacer" />
      <button aria-label="Zoom out" onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomMinus')}>−</button>
      <input aria-label="Zoom" type="range" min={20} max={400} value={Math.round(c.zoom * 100)} onChange={(e) => c.setZoom(Number(e.target.value) / 100)} />
      <button aria-label="Zoom in" onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomPlus')}>+</button>
      <span className="zoom-value">{Math.round(c.zoom * 100)}%</span>
    </div>
  );
}
