// Calc's bars: the classic toolbars (standardbar and formatobjectbar, with their own controls),
// the formula bar (ScInputWindow: the Name Box, the function buttons and the input line), and the
// status bar (the sheet, the selection's functions, the zoom).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { autoFunc, dispatch, BORDER_PRESETS, LINE_WIDTHS } from '../commands.ts';
import { ToolButton, ToolColor, ToolPopup, isImplemented } from '@shell/ui/Bars.tsx';
import { FontNameBox as ShellFontNameBox, FontSizeBox as ShellFontSizeBox } from '@shell/ui/FontBoxes.tsx';
import { ColorControl as ShellColorControl } from '@shell/ui/ColorWindow.tsx';
import { t } from '@shell/i18n.ts';
import { toolbars, tooltip } from './labels.ts';
import { SfxStyleFamily } from '@lo/sc/inc/stlsheet.ts';
import { ScAddress, ScRange, ScRefFlags } from '@lo/sc/inc/address.ts';
import { ScFollowMode } from '@lo/sc/source/ui/view/viewdata.ts';
import { IsFormulaText } from '@lo/sc/source/ui/app/inputhdl.ts';
import { GetStatusFunctionValues, STATUS_FUNCS } from '../status.ts';

export { ContextMenu, DocTitle, MenuBar, MenuItems, ToolButton, VisibleEntries, isEnabled, isImplemented } from '@shell/ui/Bars.tsx';

const twipsToPt = (t: number) => Math.round((t / 20) * 10) / 10;

export function FontNameBox({ c }: { c: Controller }) {
  const font = c.view.GetSelectionPattern().GetItem('ATTR_FONT');
  return <ShellFontNameBox c={c} font={font} families={c.fonts.listFonts([font, ...c.documentFonts()])} onApply={(name) => c.view.ApplyAttributes({ ATTR_FONT: name })} />;
}

export function FontSizeBox({ c }: { c: Controller }) {
  const size = twipsToPt(c.view.GetSelectionPattern().GetItem('ATTR_FONT_HEIGHT'));
  return <ShellFontSizeBox c={c} size={size} onApply={(pt) => c.view.ApplyAttributes({ ATTR_FONT_HEIGHT: Math.round(pt * 20) })} />;
}

/** The colours the spreadsheet uses: its cell styles' (for the colour window). */
function usedColors(c: Controller, kind: 'font' | 'highlight'): string[] {
  const out = new Set<string>();
  for (const s of c.sh.GetDocument().GetStyleSheetPool().GetStyles()) {
    const v = kind === 'font' ? s.GetItem('ATTR_FONT_COLOR') : s.GetItem('ATTR_BACKGROUND');
    if (v) out.add(v.toLowerCase());
  }
  return [...out].slice(0, 16);
}

/** The font colour (.uno:Color) and the cell background (.uno:BackgroundColor) controls. */
export function FontColorPick({ c }: { c: Controller }) {
  return <ShellColorControl c={c} kind="font" value={c.view.GetSelectionPattern().GetItem('ATTR_FONT_COLOR')} used={() => usedColors(c, 'font')} />;
}
export function BackgroundColorPick({ c }: { c: Controller }) {
  return <ShellColorControl c={c} kind="highlight" value={c.view.GetSelectionPattern().GetItem('ATTR_BACKGROUND')} used={() => usedColors(c, 'highlight')}
    command={{ cmd: '.uno:BackgroundColor', arg: 'BackgroundColor' }} />;
}

/** The cell style list (StyleApply's box of the formatting bar). */
export function CellStyleBox({ c }: { c: Controller }) {
  const styles = c.sh.GetDocument().GetStyleSheetPool().GetStyles(SfxStyleFamily.Para).map((s) => s.GetName());
  const cur = c.view.GetSelectionPattern().GetStyleName() ?? 'Default';
  return (
    <select className="cell-style-box" aria-label={tooltip('.uno:StyleApply')} title={tooltip('.uno:StyleApply')} value={cur}
      onChange={(e) => { c.view.SetStyleSheetToMarked(e.target.value); c.focusEditor(); }}>
      {styles.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/** A ribbon or toolbar entry `.uno:StyleApply?Style:string=Good&…`: a button applying that cell style. */
export function StyleApplyButton({ c, cmd }: { c: Controller; cmd: string }) {
  const style = decodeURIComponent(/Style:string=([^&]*)/.exec(cmd)?.[1] ?? 'Default');
  const cur = c.view.GetSelectionPattern().GetStyleName();
  const s = c.sh.GetDocument().GetStyleSheetPool().Find(style);
  return (
    <button className={`tool style-apply${cur === style ? ' on' : ''}`} aria-pressed={cur === style} title={style}
      style={{ background: s?.GetItem('ATTR_BACKGROUND') ?? undefined, color: s?.GetItem('ATTR_FONT_COLOR') ?? undefined, fontWeight: s?.GetItem('ATTR_FONT_WEIGHT') ? 600 : undefined }}
      onMouseDown={(e) => e.preventDefault()} onClick={() => { c.view.SetStyleSheetToMarked(style); c.focusEditor(); }}>{style}</button>
  );
}

/** Toolbar commands drawn as their own controls rather than buttons. */
export function toolControl(c: Controller, cmd: string): ReactNode | undefined {
  switch (cmd) {
    case '.uno:CharFontName': return <FontNameBox key={cmd} c={c} />;
    case '.uno:FontHeight': return <FontSizeBox key={cmd} c={c} />;
    case '.uno:Color': return <FontColorPick key={cmd} c={c} />;
    case '.uno:BackgroundColor': return <BackgroundColorPick key={cmd} c={c} />;
    case '.uno:StyleApply': return <CellStyleBox key={cmd} c={c} />;
    case '.uno:SetBorderStyle': return <ToolPopup key={cmd} c={c} cmd={cmd} options={BORDER_PRESETS} />;
    case '.uno:LineStyle': return <ToolPopup key={cmd} c={c} cmd={cmd} options={LINE_WIDTHS} />;
    case '.uno:FrameLineColor': return <ToolColor key={cmd} c={c} cmd={cmd} value="#000000" />;
    default:
      if (cmd.startsWith('.uno:StyleApply?')) return <StyleApplyButton key={cmd} c={c} cmd={cmd} />;
      return undefined;
  }
}
export const TOOL_CONTROLS = new Set(['.uno:CharFontName', '.uno:FontHeight', '.uno:Color', '.uno:BackgroundColor', '.uno:StyleApply', '.uno:SetBorderStyle', '.uno:LineStyle', '.uno:FrameLineColor']);

export function ToolBar({ c }: { c: Controller }) {
  // Only commands that work are shown: unlike the menus, the toolbar stays minimal.
  const items = (name: string) => toolbars[name]!.filter((tb) => tb.sep || (tb.visible && tb.cmd && (TOOL_CONTROLS.has(tb.cmd) || isImplemented(tb.cmd))));
  const tidy = (list: typeof toolbars[string]) => list.filter((tb, i) => !tb.sep || (i > 0 && !list[i - 1]!.sep && i < list.length - 1));
  const render = (list: typeof toolbars[string]) => tidy(list).map((tb, i) => (tb.sep ? <span key={i} className="tool-sep" /> : toolControl(c, tb.cmd!) ?? <ToolButton key={tb.cmd} c={c} cmd={tb.cmd!} />));
  return (
    <div className="toolbar" role="toolbar" aria-label={t('calc.toolbar')}>
      {render(items('standardbar'))}
      <span className="tool-sep" />
      {render(items('formatobjectbar'))}
    </div>
  );
}

/** ScPosWnd: the Name Box, showing the cursor or the selection, and going to a reference or name typed. */
function NameBox({ c }: { c: Controller }) {
  const ref = useRef<HTMLInputElement>(null);
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const { rRange } = v.GetSimpleArea();
  const text = (() => {
    if (c.edit) return new ScAddress(c.edit.nCol, c.edit.nRow, c.edit.nTab).Format(ScRefFlags.VALID, rDoc);
    const r = rRange;
    if (r.aStart.equals(r.aEnd) || !v.GetMarkData().IsMarked()) return new ScAddress(v.GetCurX(), v.GetCurY(), v.GetTabNo()).Format(ScRefFlags.VALID, rDoc);
    return `${r.aStart.Format(ScRefFlags.VALID, rDoc)}:${r.aEnd.Format(ScRefFlags.VALID, rDoc)}`;
  })();
  useEffect(() => { c.focusNameBox = () => { ref.current?.focus(); ref.current?.select(); }; }, [c]);
  /** ScPosWnd::DoEnter: a reference, a sheet's reference, or a named range. */
  const go = (s: string) => {
    const name = s.trim();
    if (!name) return;
    const aRange = new ScRange();
    let nFlags = aRange.Parse(name, rDoc);
    if (!(nFlags & ScRefFlags.VALID)) {
      const aAddr = new ScAddress();
      nFlags = aAddr.Parse(name, rDoc);
      if (nFlags & ScRefFlags.VALID) { aRange.aStart.Set(aAddr.Col(), aAddr.Row(), aAddr.Tab()); aRange.aEnd.Set(aAddr.Col(), aAddr.Row(), aAddr.Tab()); }
    }
    if (nFlags & ScRefFlags.VALID) {
      if (!(nFlags & ScRefFlags.TAB_3D)) { aRange.aStart.SetTab(v.GetTabNo()); aRange.aEnd.SetTab(v.GetTabNo()); }
    } else {
      // a named range (the sheet's, then the document's)
      const pData = rDoc.GetRangeName(v.GetTabNo())?.findByUpperName(name.toUpperCase()) ?? rDoc.GetRangeName()?.findByUpperName(name.toUpperCase());
      const r = pData?.IsValidReference();
      if (!r) { c.setMessage(t('calc.invalidReference', { name })); return; }
      aRange.aStart.Set(r.aStart.Col(), r.aStart.Row(), r.aStart.Tab());
      aRange.aEnd.Set(r.aEnd.Col(), r.aEnd.Row(), r.aEnd.Tab());
    }
    if (c.edit) c.commitEdit('none');
    if (aRange.aStart.equals(aRange.aEnd)) {
      c.view.SetTabNo(aRange.aStart.Tab());
      c.view.MoveCursorAbs(aRange.aStart.Col(), aRange.aStart.Row(), ScFollowMode.SC_FOLLOW_JUMP, false, false);
    } else c.view.MarkRange(aRange);
    c.focusEditor();
  };
  return (
    <input ref={ref} className="name-box" data-testid="name-box" aria-label={t('calc.nameBox')} title={t('calc.nameBox')} key={text} defaultValue={text} spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); go(e.currentTarget.value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = text; c.focusEditor(); }
      }}
      onBlur={(e) => { e.currentTarget.value = text; }} />
  );
}

/** The functions of the sum button's menu (ScInputWindow's SID_INPUT_SUM drop-down). */
const SUM_FUNCS: [string, string][] = [['SUM', 'Sum'], ['AVERAGE', 'Average'], ['MIN', 'Min'], ['MAX', 'Max'], ['COUNT', 'Count'], ['COUNTA', 'CountA'], ['PRODUCT', 'Product'], ['STDEV', 'Stdev'], ['VAR', 'Var']];

/**
 * ScInputWindow: the Name Box, the Function Wizard's place (here: inserting "="), the sum
 * button with its functions, and the input line, which edits the cell together with the cell's
 * editor (both show the same text).
 */
export function FormulaBar({ c }: { c: Controller }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [sumOpen, setSumOpen] = useState(false);
  const e = c.edit;
  const shown = e ? e.text : c.inputLineText();
  useEffect(() => { c.focusInputLine = () => inputRef.current?.focus(); }, [c]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.value !== shown) el.value = shown;
    if (e && e.where === 'bar' && document.activeElement === el && (el.selectionStart !== e.selStart || el.selectionEnd !== e.selEnd)) el.setSelectionRange(e.selStart, e.selEnd);
  });
  const sum = (name: string) => {
    setSumOpen(false);
    if (c.edit) c.commitEdit('none');
    autoFunc(c, name);
  };
  return (
    <div className="formula-bar" role="toolbar" aria-label={t('calc.formulaBar')}>
      <NameBox c={c} />
      <div className="formula-buttons">
        <div className="sum-button">
          <button className="tool" title={tooltip('.uno:AutoSum')} aria-label={tooltip('.uno:AutoSum')} onMouseDown={(ev) => ev.preventDefault()} onClick={() => sum('SUM')}>Σ</button>
          <button className="tool sum-caret" aria-label={t('calc.functions')} aria-haspopup="menu" aria-expanded={sumOpen} onMouseDown={(ev) => ev.preventDefault()} onClick={() => setSumOpen(!sumOpen)}>▾</button>
          {sumOpen && (
            <ul className="menu-popup" role="menu">
              {SUM_FUNCS.map(([f, label]) => (
                <li key={f} role="menuitem" tabIndex={-1} className="menu-item" onMouseDown={(ev) => ev.preventDefault()} onClick={() => sum(f)}>
                  <span className="menu-check" /><span className="menu-label">{label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {e ? <>
          <button className="tool" title={t('common.cancel')} aria-label={t('common.cancel')} onMouseDown={(ev) => ev.preventDefault()} onClick={() => c.cancelEdit()}>✕</button>
          <button className="tool" title={t('calc.accept')} aria-label={t('calc.accept')} onMouseDown={(ev) => ev.preventDefault()} onClick={() => c.commitEdit('none')}>✓</button>
        </> : (
          <button className="tool" title={t('calc.formula')} aria-label={t('calc.formula')} onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => { c.startEdit('=', 'bar'); c.focusInputLine(); }}>=</button>
        )}
      </div>
      <textarea ref={inputRef} className={`input-line${expanded ? ' expanded' : ''}`} data-testid="input-line" aria-label={t('calc.inputLine')} spellCheck={false} rows={1}
        onFocus={(ev) => { if (!c.edit) { c.startEdit(undefined, 'bar', ev.currentTarget.selectionStart); } else if (c.edit.where !== 'bar') { c.edit.where = 'bar'; c.notify(); } }}
        onInput={(ev) => { const el = ev.currentTarget; if (!c.edit) c.startEdit(el.value, 'bar', el.selectionStart); else c.setEditText(el.value, el.selectionStart, el.selectionEnd, (ev.nativeEvent as InputEvent).inputType === 'insertText'); }}
        onSelect={(ev) => { const el = ev.currentTarget; if (c.edit && c.edit.where === 'bar' && el.value === c.edit.text) { c.edit.selStart = el.selectionStart; c.edit.selEnd = el.selectionEnd; c.edit.refSel = null; } }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && !ev.altKey && !ev.ctrlKey) { ev.preventDefault(); c.commitEdit(ev.shiftKey ? 'shift-enter' : 'enter'); }
          else if (ev.key === 'Enter') {
            ev.preventDefault();
            const el = ev.currentTarget;
            const s = el.value.slice(0, el.selectionStart) + '\n' + el.value.slice(el.selectionEnd);
            c.setEditText(s, el.selectionStart + 1);
          } else if (ev.key === 'Tab') { ev.preventDefault(); c.commitEdit(ev.shiftKey ? 'shift-tab' : 'tab'); }
          else if (ev.key === 'Escape') { ev.preventDefault(); c.cancelEdit(); }
          else if (ev.key === 'F4' && c.edit && IsFormulaText(c.edit.text)) { ev.preventDefault(); dispatch(c, '.uno:ToggleRelative'); }
        }} />
      <button className="tool expand" title={t('calc.expandInputLine')} aria-label={t('calc.expandInputLine')} aria-expanded={expanded} onMouseDown={(ev) => ev.preventDefault()} onClick={() => setExpanded(!expanded)}>{expanded ? '▴' : '▾'}</button>
    </div>
  );
}

/** The status bar: the sheet, the selection's functions (StatusBarFunc, chosen in its menu), the zoom. */
export function StatusBar({ c }: { c: Controller }) {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const values = GetStatusFunctionValues(c);
  const mask = c.appOptions.GetStatusFunc();
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  return (
    <div className="statusbar" role="status">
      <span data-testid="sheet-status">{t('calc.sheetOf', { n: v.GetTabNo() + 1, count: rDoc.GetTableCount() })}</span>
      <span>{c.view.GetSelectionPattern().GetStyleName() ?? 'Default'}</span>
      <span className="spacer" />
      <button className="status-link status-funcs" data-testid="status-funcs" title={t('calc.statusFuncs')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
        {values.length ? values.map((x) => `${x.label}: ${x.value}`).join('; ') : t('calc.statusFuncsNone')}
      </button>
      {menu && (
        <ul className="menu-popup status-menu" role="menu" style={{ position: 'fixed', left: menu.x, bottom: window.innerHeight - menu.y + 6 }} onMouseDown={(e) => e.stopPropagation()}>
          {STATUS_FUNCS.map((f) => {
            const on = (mask & (1 << f.id)) !== 0;
            return (
              <li key={f.id} role="menuitemcheckbox" aria-checked={on} tabIndex={-1} className="menu-item"
                onClick={() => { c.appOptions.SetStatusFunc(f.id === 0 ? (on ? 0 : 1) : (mask & ~1) ^ (1 << f.id)); c.saveOptions(); }}>
                <span className="menu-check">{on ? '✓' : ''}</span><span className="menu-label">{t(`calc.func.${f.key}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <button aria-label={t('calc.zoomOut')} onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomMinus')}>−</button>
      <input aria-label={t('calc.zoom')} data-testid="zoom-slider" type="range" min={20} max={400} value={Math.round(v.GetZoomX() * 100)} onChange={(e) => c.setZoom(Number(e.target.value) / 100)} />
      <button aria-label={t('calc.zoomIn')} onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:ZoomPlus')}>+</button>
      <span className="zoom-value">{Math.round(v.GetZoomX() * 100)}%</span>
    </div>
  );
}
