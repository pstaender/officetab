import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DICTIONARIES, findDictionary, languageName } from '../spell.ts';
import { LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import type { Controller } from '../controller.ts';
import { COMMANDS, OPTIMIZE_TABLE, dispatch } from '../commands.ts';
import icons from '../generated/icons.json';
import { RndStdIds } from '@lo/sw/inc/frmfmt.ts';
import { t } from '../i18n.ts';
import { menuLabel, menubar, shortcutText, toolbars, tooltip, type MenuEntry } from './labels.ts';

/** FontList::aStdSizeAry (svtools ctrltool.cxx): the sizes the font size box offers, in points. */
const FONT_SIZES = [6, 7, 8, 9, 10, 10.5, 11, 12, 13, 14, 15, 16, 18, 20, 21, 22, 24, 26, 28, 32, 36, 40, 42, 44, 48, 54, 60, 66, 72, 80, 88, 96];

/**
 * SvxFontSizeBox_Base (the font size box of the formatting bar): type a size and press Enter, or
 * pick one of the standard sizes; Up and Down step through them, Escape restores the size.
 */
function FontSizeBox({ c, size }: { c: Controller; size: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(size));
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { setText(String(size)); }, [size]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    const sel = listRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null;
    sel?.scrollIntoView({ block: 'nearest' });
    return () => window.removeEventListener('pointerdown', close);
  }, [open, active]);
  const apply = (v: number) => {
    // FontSizeBox: sizes from 1 to 999.9 pt, in tenths.
    if (v >= 1 && v <= 999.9) c.sh.SetCharAttr({ RES_CHRATR_FONTSIZE: Math.round(v * 20) });
    setOpen(false);
    c.notify();
    c.focusEditor();
  };
  const step = (dir: 1 | -1) => {
    const cur = parseFloat(text.replace(',', '.'));
    const i = dir > 0 ? FONT_SIZES.findIndex((s) => s > cur) : FONT_SIZES.length - 1 - [...FONT_SIZES].reverse().findIndex((s) => s < cur);
    if (i >= 0 && i < FONT_SIZES.length) { setText(String(FONT_SIZES[i])); setActive(i); }
  };
  return (
    <div className="font-size-box" ref={box}>
      <input aria-label="Font size" className="font-size" role="combobox" aria-expanded={open} aria-controls="font-size-list" value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // The key is the box's: it must not reach the text as a new paragraph.
            e.preventDefault();
            e.stopPropagation();
            apply(open && active >= 0 ? FONT_SIZES[active]! : parseFloat(text.replace(',', '.')));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(String(size));
            setOpen(false);
            c.focusEditor();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (e.altKey) { setOpen(!open); return; }
            step(e.key === 'ArrowDown' ? 1 : -1);
          }
        }} />
      <button type="button" className="font-size-drop" tabIndex={-1} aria-label={t('fontsize.list')} onClick={() => { setActive(FONT_SIZES.indexOf(size)); setOpen(!open); }}>▾</button>
      {open && (
        <ul className="font-size-list" id="font-size-list" role="listbox" aria-label={t('fontsize.list')} ref={listRef}>
          {FONT_SIZES.map((s, i) => (
            <li key={s} role="option" aria-selected={i === active || (active < 0 && s === size)} onPointerDown={(e) => { e.preventDefault(); apply(s); }}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

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

/**
 * svx grafctrl.cxx ImplGrafControl: an image colour attribute's icon and spin field, which
 * dispatches its command with the value on Enter or when the field loses the focus.
 */
function GrafSpin({ c, cmd, value, min, max, step = 1, unit = '%' }: { c: Controller; cmd: string; value: number; min: number; max: number; step?: number; unit?: string }) {
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
      {url ? <img src={url} alt="" draggable={false} /> : null}
      <input type="number" aria-label={label} min={min} max={max} step={step} key={`${cmd}:${value}`} defaultValue={value} disabled={!isEnabled(c, cmd)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); c.focusEditor(); } }} onBlur={(e) => commit(e.currentTarget)} />
      {unit && <span className="graf-unit">{unit}</span>}
    </label>
  );
}

/** graphicobjectbar's own controls (GrafMode's list, GrafTransparence's field) and the colorbar. */
function GraphicControls({ c, render, items }: { c: Controller; render: (l: typeof toolbars[string]) => ReactNode; items: (n: string) => typeof toolbars[string] }) {
  const a = c.sh.GetGrfAttr();
  const SPECIAL = new Set(['.uno:GrafMode', '.uno:GrafTransparence']);
  const bar = items('graphicobjectbar');
  const pieces: ReactNode[] = [];
  let run: typeof bar = [];
  const flush = () => { if (run.length) pieces.push(<span key={`r${pieces.length}`} className="tool-run">{render(run)}</span>); run = []; };
  for (const tb of toolbars.graphicobjectbar!) {
    if (tb.cmd === '.uno:GrafMode') {
      flush();
      pieces.push(
        <select key="mode" aria-label={tooltip('.uno:GrafMode')} title={tooltip('.uno:GrafMode')} value={a.m_eDrawMode ?? 0} disabled={!isEnabled(c, '.uno:GrafMode')}
          onChange={(e) => { dispatch(c, '.uno:GrafMode', { GrafMode: Number(e.target.value) }); c.focusEditor(); }}>
          {(['standard', 'greys', 'mono', 'watermark'] as const).map((m, i) => <option key={m} value={i}>{t(`grafmode.${m}`)}</option>)}
        </select>,
      );
    } else if (tb.cmd === '.uno:GrafTransparence') {
      flush();
      pieces.push(<GrafSpin key="transp" c={c} cmd=".uno:GrafTransparence" value={a.m_nTransparency ?? 0} min={0} max={100} />);
    } else if (tb.sep || (tb.cmd && !SPECIAL.has(tb.cmd) && bar.includes(tb))) run.push(tb);
  }
  flush();
  return (
    <>
      <span className="tool-sep" />
      {pieces}
      {c.showColorBar && <>
        <span className="tool-sep" />
        <span role="group" aria-label={t('colorbar.title')} className="tool-run">
          <GrafSpin c={c} cmd=".uno:GrafRed" value={a.m_nChannelR ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafGreen" value={a.m_nChannelG ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafBlue" value={a.m_nChannelB ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafLuminance" value={a.m_nLuminance ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafContrast" value={a.m_nContrast ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafGamma" value={a.m_fGamma ?? 1} min={0.1} max={10} step={0.01} unit="" />
        </span>
      </>}
    </>
  );
}

/** tableobjectbar, shown while the cursor is in a table (SwTableShell); the cell background is a colour field. */
/** A toolbar popup as a list: its icon, and the choice dispatched as the command's argument. */
function ToolPopup({ c, cmd, options }: { c: Controller; cmd: string; options: [number, string][] }) {
  const url = iconUrl(cmd), label = tooltip(cmd);
  return (
    <label className="tool tool-popup" title={label}>
      {url ? <img src={url} alt="" draggable={false} /> : <span>{label}</span>}
      <select aria-label={label} value="" disabled={!isEnabled(c, cmd)} onChange={(e) => { if (e.target.value) { dispatch(c, cmd, { [cmd.slice(5)]: Number(e.target.value) }); c.focusEditor(); } }}>
        <option value="" disabled>{label}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** A toolbar colour control: the colour dispatched as 0xRRGGBB. */
function ToolColor({ c, cmd, value }: { c: Controller; cmd: string; value: string }) {
  const url = iconUrl(cmd), label = tooltip(cmd);
  return (
    <label className="tool colorpick" title={label}>
      {url ? <img src={url} alt="" draggable={false} style={{ borderBottom: `3px solid ${value}` }} /> : <span style={{ background: value }}>■</span>}
      <input type="color" aria-label={label} value={value} disabled={!isEnabled(c, cmd)} onChange={(e) => dispatch(c, cmd, { [cmd.slice(5)]: parseInt(e.target.value.slice(1), 16) })} />
    </label>
  );
}

/** svx SvxFrameWindow_Impl's arrangements for Writer, 1 … 12. */
const BORDER_PRESETS: [number, string][] = [
  [1, 'No Borders'], [2, 'Left Border'], [3, 'Right Border'], [4, 'Left and Right Borders'], [5, 'Top Border'], [6, 'Bottom Border'],
  [7, 'Top and Bottom Borders'], [8, 'Outer Border'], [9, 'Top and Bottom Borders, and All Horizontal Lines'],
  [10, 'Outer Border and Horizontal Lines'], [11, 'Outer Border and Vertical Lines'], [12, 'Outer Border and All Inner Lines'],
];
/** SvxLineStyleToolBoxControl's widths, reduced to solid lines (twips). */
const LINE_WIDTHS: [number, string][] = [[1, 'Hairline (0.05 pt)'], [10, 'Very thin (0.5 pt)'], [15, 'Thin (0.75 pt)'], [30, 'Medium (1.5 pt)'], [45, 'Thick (2.25 pt)'], [90, 'Extra thick (4.5 pt)']];

/** tableobjectbar, shown while the cursor is in a table (SwTableShell); its popups are lists and colour fields. */
function TableBar({ c, render, items }: { c: Controller; render: (l: typeof toolbars[string]) => ReactNode; items: (n: string) => typeof toolbars[string] }) {
  const bar = items('tableobjectbar');
  const bg = c.sh.GetBoxBackground() ?? '#ffffff';
  const special: Record<string, () => ReactNode> = {
    '.uno:TableCellBackgroundColor': () => <ToolColor key="bg" c={c} cmd=".uno:TableCellBackgroundColor" value={bg} />,
    '.uno:FrameLineColor': () => <ToolColor key="lc" c={c} cmd=".uno:FrameLineColor" value="#000000" />,
    '.uno:SetBorderStyle': () => <ToolPopup key="bs" c={c} cmd=".uno:SetBorderStyle" options={BORDER_PRESETS} />,
    '.uno:LineStyle': () => <ToolPopup key="ls" c={c} cmd=".uno:LineStyle" options={LINE_WIDTHS} />,
    '.uno:OptimizeTable': () => <ToolPopup key="opt" c={c} cmd=".uno:OptimizeTable" options={OPTIMIZE_TABLE.map((k, i) => [i, menuLabel(k)])} />,
  };
  const pieces: ReactNode[] = [];
  let run: typeof bar = [];
  const flush = () => { if (run.length) pieces.push(<span key={`r${pieces.length}`} className="tool-run">{render(run)}</span>); run = []; };
  for (const tb of bar) {
    const sp = tb.cmd ? special[tb.cmd] : undefined;
    if (sp) { flush(); pieces.push(sp()); } else run.push(tb);
  }
  flush();
  return (
    <>
      <span className="tool-sep" />
      <span role="group" aria-label="Table" className="tool-run">{pieces}</span>
    </>
  );
}

/** frameobjectbar, shown instead of the text bars while an object is selected (SwView's shell switch). */
function FrameBar({ c, render, items }: { c: Controller; render: (l: typeof toolbars[string]) => ReactNode; items: (n: string) => typeof toolbars[string] }) {
  const id = c.sh.GetAnchorId();
  const isGraphic = c.sh.GetFlyFrameFormat()?.graphic !== undefined;
  return (
    <>
      <select aria-label="Anchor" value={id ?? ''} onChange={(e) => { c.sh.ChgAnchor(Number(e.target.value) as RndStdIds); c.notify(); c.focusEditor(); }}>
        <option value={RndStdIds.FLY_AT_PAGE}>To Page</option>
        <option value={RndStdIds.FLY_AT_PARA}>To Paragraph</option>
        <option value={RndStdIds.FLY_AT_CHAR}>To Character</option>
        {isGraphic && <option value={RndStdIds.FLY_AS_CHAR}>As Character</option>}
      </select>
      {render(items('frameobjectbar'))}
      <ToolButton c={c} cmd={isGraphic ? '.uno:GraphicDialog' : '.uno:FrameDialog'} />
      {isGraphic && <GraphicControls c={c} render={render} items={items} />}
    </>
  );
}

export function ToolBar({ c }: { c: Controller }) {
  const sh = c.sh;
  // Only commands that work are shown: unlike the menus, the toolbar stays minimal.
  const items = (name: string) => toolbars[name]!.filter((t) => t.sep || (t.visible && t.cmd && isImplemented(t.cmd)));
  const tidy = (list: typeof toolbars[string]) => list.filter((t, i) => !t.sep || (i > 0 && !list[i - 1]!.sep));
  const font = sh.GetAttr('RES_CHRATR_FONT');
  const size = twipsToPt(sh.GetAttr('RES_CHRATR_FONTSIZE'));
  // The offered and system fonts and those the document uses; all web fonts on request (Tools > Options > Fonts).
  const families = c.fonts.listFonts([font, ...c.documentFonts()]);
  const color = sh.GetAttr('RES_CHRATR_COLOR') ?? '#000000';
  const back = sh.GetAttr('RES_CHRATR_BACKGROUND') ?? '#ffff00';
  const render = (list: typeof toolbars[string]) => tidy(list).map((t, i) => (t.sep ? <span key={i} className="tool-sep" /> : <ToolButton key={t.cmd} c={c} cmd={t.cmd!} />));
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {render(items('standardbar'))}
      <span className="tool-sep" />
      {sh.IsFrameSelected() ? <FrameBar c={c} render={render} items={items} /> : <>
      <select aria-label="Paragraph style" data-testid="style-select" value={sh.GetCurTextFormatColl()} onChange={(e) => { sh.SetTextFormatColl(e.target.value); c.focusEditor(); }}>
        {[...sh.m_pDoc.m_aTextFormatColls.keys()].map((n) => <option key={n}>{n}</option>)}
      </select>
      <select aria-label="Font name" value={font} onChange={(e) => { sh.SetCharAttr({ RES_CHRATR_FONT: e.target.value }); c.focusEditor(); }}>
        {families.map((f) => <option key={f}>{f}</option>)}
      </select>
      <FontSizeBox c={c} size={size} />
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
      {sh.IsCursorInTable() && <TableBar c={c} render={render} items={items} />}
      </>}
    </div>
  );
}

/**
 * The status bar's language field (SwView::StateStatusLine for SID_LANGUAGE_STATUS): the text
 * language at the cursor; choosing another sets it for the selection, or all text, and loads that
 * language's spelling dictionary.
 */
function LanguageSelect({ c }: { c: Controller }) {
  const lang = c.sh.GetAttr('RES_CHRATR_LANGUAGE');
  const options = useMemo(() => DICTIONARIES.map((d) => ({ locale: d.locale, name: languageName(d.locale) })).sort((a, b) => a.name.localeCompare(b.name)), []);
  const own = options.some((o) => o.locale === lang) || lang === LANGUAGE_NONE ? [] : [{ locale: lang, name: languageName(lang) }];
  const state = (loc: string) => { const d = findDictionary(loc); const st = d && c.dictionaries.get(d.locale); return st === 'loading' ? ' (loading…)' : st === 'error' ? ' (unavailable)' : ''; };
  return (
    <select className="status-select" aria-label="Text language" title="Text language (spelling)" value={lang} onChange={(e) => { c.setLanguage(e.target.value); c.focusEditor(); }}>
      <option value={LANGUAGE_NONE}>[None] (Do not check spelling)</option>
      {[...own, ...options].map((o) => <option key={o.locale} value={o.locale}>{o.name}{state(o.locale)}</option>)}
    </select>
  );
}

export function StatusBar({ c }: { c: Controller }) {
  const sh = c.sh;
  const { words, chars } = sh.GetWordCount();
  return (
    <div className="statusbar" role="status">
      <span data-testid="page-status">Page {sh.GetPageNumber()} of {sh.m_pRoot.pages.length}</span>
      <span>{words} words, {chars} characters</span>
      {/* SwView's page style field: shows the page's style and opens Format > Page Style. */}
      <button className="status-link" title="Page style" onMouseDown={(e) => e.preventDefault()} onClick={() => c.setDialog('page')}>{sh.GetCurPageDesc().m_aName}</button>
      <span>{sh.GetCurTextFormatColl()}</span>
      <LanguageSelect c={c} />
      {sh.IsRedlineOn() && <span title="Changes are recorded">Track Changes</span>}
      <span className="spacer" />
      <button aria-label="Zoom out" onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomMinus')}>−</button>
      <input aria-label="Zoom" type="range" min={20} max={400} value={Math.round(c.zoom * 100)} onChange={(e) => c.setZoom(Number(e.target.value) / 100)} />
      <button aria-label="Zoom in" onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomPlus')}>+</button>
      <span className="zoom-value">{Math.round(c.zoom * 100)}%</span>
    </div>
  );
}

/** The input window's Formula menu (sw inputwinmenu.ui): functions and operators to insert. */
const FORMULA_ITEMS: [string, string][] = [
  ['sum', 'Sum'], ['round', 'Round'], ['phd', 'Percent'], ['sqrt', 'Square Root'], ['pow', 'Power'], ['|', 'List Separator'],
  ['eq', 'Equal'], ['neq', 'Not Equal'], ['leq', 'Less Than or Equal'], ['geq', 'Greater Than or Equal'], ['l', 'Less'], ['g', 'Greater'],
  ['or', 'Boolean Or'], ['xor', 'Boolean Xor'], ['and', 'Boolean And'], ['not', 'Boolean Not'],
  ['mean', 'Mean'], ['min', 'Minimum'], ['max', 'Maximum'], ['count', 'Count'], ['product', 'Product'], ['average', 'Average'],
  ['sin', 'Sine'], ['cos', 'Cosine'], ['tan', 'Tangent'], ['asin', 'Arcsine'], ['acos', 'Arccosine'], ['atan', 'Arctangent'],
  ['abs', 'Absolute Value'], ['sign', 'Sign'], ['int', 'Integer'], ['mod', 'Modulo'],
];

/**
 * SwInputWindow: the box name, the Formula menu, Cancel and Apply and the formula; Enter applies
 * the formula to the selected boxes (SwInputWindow::ApplyFormula), Escape cancels. Formulas
 * outside tables (formula fields) are not ported.
 */
export function FormulaBar({ c }: { c: Controller }) {
  const ref = useRef<HTMLInputElement>(null);
  const bar = c.formulaBar;
  useEffect(() => { if (bar) { ref.current?.focus(); const n = ref.current?.value.length ?? 0; ref.current?.setSelectionRange(n, n); } }, [bar]);
  if (!bar || !c.sh.IsCursorInTable()) return null;
  const close = () => { c.formulaBar = null; c.notify(); c.focusEditor(); };
  const apply = () => {
    let sEdit = (ref.current?.value ?? '').trim();
    if (sEdit.length > 1 && sEdit[0] === '=') sEdit = sEdit.slice(1);
    if (sEdit && sEdit !== '=') c.sh.SetTableBoxFormulaAttrs({ formula: sEdit });
    close();
  };
  const insertToken = (tok: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const ins = tok === '|' ? '|' : ` ${tok} `;
    el.value = el.value.slice(0, a) + ins + el.value.slice(b);
    el.focus();
    el.setSelectionRange(a + ins.length, a + ins.length);
  };
  return (
    <div className="formula-bar" role="toolbar" aria-label="Formula">
      <span className="formula-pos" aria-label="Position">{c.sh.GetBoxName()}</span>
      <select aria-label="Formula" value="" onChange={(e) => { if (e.target.value) insertToken(e.target.value); }}>
        <option value="">ƒx</option>
        {FORMULA_ITEMS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <button className="tool" aria-label="Cancel" title="Cancel" onClick={close}>✕</button>
      <button className="tool" aria-label="Apply" title="Apply" onClick={apply}>✓</button>
      <input ref={ref} aria-label="Formula text" key={bar.text} defaultValue={bar.text} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
    </div>
  );
}
