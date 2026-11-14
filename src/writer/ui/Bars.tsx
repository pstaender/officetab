import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DICTIONARIES, findDictionary, languageName } from '@shell/spell.ts';
import { LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import type { Controller } from '../controller.ts';
import { OPTIMIZE_TABLE, dispatch } from '../commands.ts';
import { GrafSpin, ToolButton, ToolColor, ToolPopup, isEnabled, isImplemented } from '@shell/ui/Bars.tsx';
import { iconUrl } from '@shell/icons.ts';
import { RndStdIds } from '@lo/sw/inc/frmfmt.ts';
import { t } from '@shell/i18n.ts';
import { FontNameBox, FontSizeBox, opensList } from './FontBoxes.tsx';
import { ColorControl } from './ColorWindow.tsx';
import { menuLabel, toolbars, tooltip } from './labels.ts';

export { iconUrl };
export { ContextMenu, DocTitle, GrafSpin, MenuBar, MenuItems, ToolButton, ToolColor, ToolPopup, VisibleEntries, isEnabled, isImplemented } from '@shell/ui/Bars.tsx';

export const twipsToPt = (t: number) => Math.round((t / 20) * 10) / 10;

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
/** svx SvxFrameWindow_Impl's arrangements for Writer, 1 … 12. */
export const BORDER_PRESETS: [number, string][] = [
  [1, 'No Borders'], [2, 'Left Border'], [3, 'Right Border'], [4, 'Left and Right Borders'], [5, 'Top Border'], [6, 'Bottom Border'],
  [7, 'Top and Bottom Borders'], [8, 'Outer Border'], [9, 'Top and Bottom Borders, and All Horizontal Lines'],
  [10, 'Outer Border and Horizontal Lines'], [11, 'Outer Border and Vertical Lines'], [12, 'Outer Border and All Inner Lines'],
];
/** SvxLineStyleToolBoxControl's widths, reduced to solid lines (twips). */
export const LINE_WIDTHS: [number, string][] = [[1, 'Hairline (0.05 pt)'], [10, 'Very thin (0.5 pt)'], [15, 'Thin (0.75 pt)'], [30, 'Medium (1.5 pt)'], [45, 'Thick (2.25 pt)'], [90, 'Extra thick (4.5 pt)']];

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

/** The selected object's anchor (SwView's .uno:AnchorMenu as a list). */
export function AnchorBox({ c }: { c: Controller }) {
  const id = c.sh.GetAnchorId();
  const isGraphic = c.sh.GetFlyFrameFormat()?.graphic !== undefined;
  return (
    <select aria-label="Anchor" value={id ?? ''} onChange={(e) => { c.sh.ChgAnchor(Number(e.target.value) as RndStdIds); c.notify(); c.focusEditor(); }}>
      <option value={RndStdIds.FLY_AT_PAGE}>To Page</option>
      <option value={RndStdIds.FLY_AT_PARA}>To Paragraph</option>
      <option value={RndStdIds.FLY_AT_CHAR}>To Character</option>
      {isGraphic && <option value={RndStdIds.FLY_AS_CHAR}>As Character</option>}
    </select>
  );
}

/**
 * The paragraph style list (StyleApply's box). It opens the shell's own list rather than the
 * native popup, whose entries tell nothing of the pointer: with text selected, the entry under the
 * pointer (or chosen with the arrow keys) is previewed on the selected paragraphs until the list
 * closes or the pointer leaves it.
 */
export function ParaStyleBox({ c }: { c: Controller }) {
  const sh = c.sh;
  const box = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const names = [...sh.m_pDoc.m_aTextFormatColls.keys()];
  const apply = (name: string) => {
    c.endParaStylePreview();
    setOpen(false);
    sh.SetTextFormatColl(name);
    c.focusEditor();
  };
  return (
    <div className="para-style-box">
      <select ref={box} aria-label="Paragraph style" data-testid="style-select" value={sh.GetCurTextFormatColl()} aria-expanded={open}
        onChange={(e) => apply(e.target.value)}
        onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); box.current?.focus(); setOpen(!open); } }}
        onKeyDown={(e) => { if (opensList(e, true)) { e.preventDefault(); setOpen(true); } }}>
        {names.map((n) => <option key={n}>{n}</option>)}
      </select>
      {open && <StyleList c={c} anchor={box.current!} names={names} current={sh.GetCurTextFormatColl()}
        onPick={apply} onClose={() => { c.endParaStylePreview(); setOpen(false); box.current?.focus(); }} />}
    </div>
  );
}

/** ParaStyleBox's list, placed as FontNameBox's: under the box, or above it without room below. */
function StyleList({ c, anchor, names, current, onPick, onClose }: {
  c: Controller; anchor: HTMLElement; names: string[]; current: string; onPick: (name: string) => void; onClose: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [cur, setCur] = useState(() => Math.max(0, names.indexOf(current)));
  const typed = useRef({ text: '', at: 0 });
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    const below = innerHeight - r.bottom - 8, above = r.top - 8;
    return below >= Math.min(300, above) ? { left: r.left, top: r.bottom + 2, maxHeight: Math.min(480, below), minWidth: r.width } : { left: r.left, bottom: innerHeight - r.top + 2, maxHeight: Math.min(480, above), minWidth: r.width };
  });
  useLayoutEffect(() => {
    const ul = list.current!;
    // The box may be at the window's right edge (the end of the ribbon): the list stays in the window.
    const r = ul.getBoundingClientRect();
    if (r.right > innerWidth - 8) ul.style.left = `${Math.max(8, innerWidth - 8 - r.width)}px`;
    ul.focus();
    const away = (e: MouseEvent) => { if (!ul.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away, true);
    return () => { document.removeEventListener('mousedown', away, true); c.endParaStylePreview(); };
  }, []);
  useLayoutEffect(() => { list.current?.querySelector(`[data-index="${cur}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cur]);
  const show = (i: number) => { setCur(i); c.previewParaStyle(names[i]!); };
  const onKey = (e: ReactKeyboardEvent) => {
    const n = names.length, page = 10;
    const to = (i: number) => { e.preventDefault(); show(Math.max(0, Math.min(n - 1, i))); };
    if (e.key === 'ArrowDown') to(cur + 1);
    else if (e.key === 'ArrowUp') { if (e.altKey) { e.preventDefault(); onPick(names[cur]!); } else to(cur - 1); }
    else if (e.key === 'PageDown') to(cur + page);
    else if (e.key === 'PageUp') to(cur - page);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(n - 1);
    // The keys are the list's: Enter must not reach the text, Escape must not close a dialog.
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onPick(names[cur]!); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: the letters typed in a row find the next style starting with them.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = names.findIndex((s) => s.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) to(i);
    } else {
      // Any other key (a shortcut such as Save) sees the document without the preview.
      c.endParaStylePreview();
    }
  };
  return createPortal(
    <ul ref={list} className="font-list style-list" role="listbox" aria-label={t('parastyle.list')} tabIndex={-1} style={pos}
      aria-activedescendant={`style-entry-${cur}`} onKeyDown={onKey} onMouseLeave={() => c.endParaStylePreview()}>
      {names.map((s, i) => (
        <li key={s} id={`style-entry-${i}`} role="option" data-index={i} aria-selected={i === cur}
          onMouseEnter={() => show(i)}
          onClick={() => onPick(s)}>{s}</li>
      ))}
    </ul>,
    document.body,
  );
}

/** The font colour and character highlighting controls (.uno:Color, .uno:CharBackColor). */
export const FontColorPick = ({ c }: { c: Controller }) => <ColorControl c={c} kind="font" />;
export const HighlightPick = ({ c }: { c: Controller }) => <ColorControl c={c} kind="highlight" />;
/** Toolbar commands drawn as their own controls rather than buttons. */
const CONTROLS: Record<string, (c: Controller) => ReactNode> = {
  '.uno:Color': (c) => <FontColorPick key=".uno:Color" c={c} />,
  '.uno:CharBackColor': (c) => <HighlightPick key=".uno:CharBackColor" c={c} />,
};

/** frameobjectbar, shown instead of the text bars while an object is selected (SwView's shell switch). */
function FrameBar({ c, render, items }: { c: Controller; render: (l: typeof toolbars[string]) => ReactNode; items: (n: string) => typeof toolbars[string] }) {
  const isGraphic = c.sh.GetFlyFrameFormat()?.graphic !== undefined;
  return (
    <>
      <AnchorBox c={c} />
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
  const render = (list: typeof toolbars[string]) => tidy(list).map((t, i) => (t.sep ? <span key={i} className="tool-sep" /> : CONTROLS[t.cmd!]?.(c) ?? <ToolButton key={t.cmd} c={c} cmd={t.cmd!} />));
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {render(items('standardbar'))}
      <span className="tool-sep" />
      {sh.IsFrameSelected() ? <FrameBar c={c} render={render} items={items} /> : <>
      <ParaStyleBox c={c} />
      <FontNameBox c={c} font={font} families={families} />
      <FontSizeBox c={c} size={size} />
      <span className="tool-sep" />
      {render(items('textobjectbar'))}
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
