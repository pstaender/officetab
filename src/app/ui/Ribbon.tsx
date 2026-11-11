import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../controller.ts';
import { OPTIMIZE_TABLE, dispatch } from '../commands.ts';
import { t } from '../i18n.ts';
import {
  AnchorBox, BORDER_PRESETS, DocTitle, FontColorPick, GrafSpin, HighlightPick, LINE_WIDTHS, MenuItems, ParaStyleBox, ToolButton, ToolColor, ToolPopup,
  isImplemented, twipsToPt,
} from './Bars.tsx';
import { FontNameBox, FontSizeBox } from './FontBoxes.tsx';
import { menuLabel, menubar, notebookbar, toolbars, tooltip, type RibbonTab } from './labels.ts';

/**
 * The context of the topmost shell, as sfx2's ContextChangeEventMultiplexer reports it to the
 * notebookbar (vcl::EnumContext): a selected draw object, OLE object, graphic or frame, a shape's
 * text being edited, a table, else text.
 */
function shellContext(c: Controller): string {
  const sh = c.sh;
  if (sh.IsFrameSelected()) {
    const fmt = sh.GetFlyFrameFormat();
    return fmt?.m_pShape ? 'Draw' : fmt?.m_pMath ? 'OLE' : fmt?.graphic !== undefined ? 'Graphic' : 'Frame';
  }
  const cur = sh.GetCurrFlyName();
  if (cur && sh.GetFlyFrameFormat(cur)?.m_pShape) return 'DrawText';
  return sh.IsCursorInTable() ? 'Table' : 'Text';
}

const hasContext = (tab: RibbonTab, ctx: string) => tab.contexts.includes(ctx);

/** The commands of a tab that work, with the controls the shell draws itself. */
const SPECIAL = new Set([
  '.uno:CharFontName', '.uno:FontHeight', '.uno:StylesPreview', '.uno:Color', '.uno:CharBackColor', '.uno:AnchorMenu',
  '.uno:TableCellBackgroundColor', '.uno:FrameLineColor', '.uno:SetBorderStyle', '.uno:LineStyle', '.uno:OptimizeTable',
  '.uno:GrafMode', '.uno:GrafTransparence', '.uno:GrafLuminance', '.uno:GrafContrast', '.uno:GrafGamma',
]);
const shown = (cmd: string) => SPECIAL.has(cmd) || isImplemented(cmd);
const tabGroups = (tab: RibbonTab) => tab.groups.map((g) => g.filter(shown)).filter((g) => g.length);
/** Tabs without any working command (Form, Extension, Tools …) are left out. */
const TABS = notebookbar.filter((tab) => tabGroups(tab).length);

function Control({ c, cmd, labeled }: { c: Controller; cmd: string; labeled: boolean }): ReactNode {
  const sh = c.sh;
  const a = () => sh.GetGrfAttr();
  switch (cmd) {
    case '.uno:CharFontName': {
      const font = sh.GetAttr('RES_CHRATR_FONT');
      return <FontNameBox c={c} font={font} families={c.fonts.listFonts([font, ...c.documentFonts()])} />;
    }
    case '.uno:FontHeight': return <FontSizeBox c={c} size={twipsToPt(sh.GetAttr('RES_CHRATR_FONTSIZE'))} />;
    case '.uno:StylesPreview': return <ParaStyleBox c={c} />;
    case '.uno:Color': return <FontColorPick c={c} />;
    case '.uno:CharBackColor': return <HighlightPick c={c} />;
    case '.uno:AnchorMenu': return sh.IsFrameSelected() ? <AnchorBox c={c} /> : null;
    case '.uno:TableCellBackgroundColor': return <ToolColor c={c} cmd={cmd} value={sh.GetBoxBackground() ?? '#ffffff'} />;
    case '.uno:FrameLineColor': return <ToolColor c={c} cmd={cmd} value="#000000" />;
    case '.uno:SetBorderStyle': return <ToolPopup c={c} cmd={cmd} options={BORDER_PRESETS} />;
    case '.uno:LineStyle': return <ToolPopup c={c} cmd={cmd} options={LINE_WIDTHS} />;
    case '.uno:OptimizeTable': return <ToolPopup c={c} cmd={cmd} options={OPTIMIZE_TABLE.map((k, i) => [i, menuLabel(k)])} />;
    case '.uno:GrafMode':
      return (
        <select aria-label={tooltip(cmd)} title={tooltip(cmd)} value={a().m_eDrawMode ?? 0} onChange={(e) => { dispatch(c, cmd, { GrafMode: Number(e.target.value) }); c.focusEditor(); }}>
          {(['standard', 'greys', 'mono', 'watermark'] as const).map((m, i) => <option key={m} value={i}>{t(`grafmode.${m}`)}</option>)}
        </select>
      );
    case '.uno:GrafTransparence': return <GrafSpin c={c} cmd={cmd} value={a().m_nTransparency ?? 0} min={0} max={100} />;
    case '.uno:GrafLuminance': return <GrafSpin c={c} cmd={cmd} value={a().m_nLuminance ?? 0} min={-100} max={100} />;
    case '.uno:GrafContrast': return <GrafSpin c={c} cmd={cmd} value={a().m_nContrast ?? 0} min={-100} max={100} />;
    case '.uno:GrafGamma': return <GrafSpin c={c} cmd={cmd} value={a().m_fGamma ?? 1} min={0.1} max={10} step={0.01} unit="" />;
    case '.uno:ColorSettings':
      // The colorbar's red, green and blue fields while it is on.
      return <>
        <ToolButton c={c} cmd={cmd} labeled={labeled} />
        {c.showColorBar && <>
          <GrafSpin c={c} cmd=".uno:GrafRed" value={a().m_nChannelR ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafGreen" value={a().m_nChannelG ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafBlue" value={a().m_nChannelB ?? 0} min={-100} max={100} />
        </>}
      </>;
    default: return <ToolButton c={c} cmd={cmd} labeled={labeled} />;
  }
}

const MENU_ICON = <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;

/** Below this many commands, a tab names them beside their icons. */
const LABELED_MAX = 20;

/** sfx2 NotebookBar's quick access toolbox (notebookbarshortcuts.xml); the menu button stands for .uno:Menubar. */
const SHORTCUTS = toolbars.notebookbarshortcuts!.flatMap((i) => (i.cmd && i.visible && i.cmd !== '.uno:Menubar' && isImplemented(i.cmd) ? [i.cmd] : []));

/** Closes a popup on a click outside `ref` or Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void, c: Controller) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); c.focusEditor(); } };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open, ref, close, c]);
}

/**
 * Menu > Ribbon: Writer's tabbed notebookbar (sfx2 NotebookBar with notebookbar.ui) as a single
 * row of commands per tab, as browser office suites show it. The menu button opens the classic
 * menus. The contextual tabs (Table, Image, Draw, Object) appear with their context, and
 * NotebookbarTabControlBase::SetContext chooses the tab. A tab with fewer than LABELED_MAX
 * commands shows their labels beside the icons (the notebookbar's "both-horiz" toolbar style).
 */
export function Ribbon({ c }: { c: Controller }) {
  const ctx = shellContext(c);
  // vcl NotebookbarTabControlBase's state: the current page, the last context, whether it had a tab.
  const st = useRef({ cur: 'Home', last: 'Any', supported: false });
  const [, rerender] = useState(0);
  if (st.current.last !== ctx) {
    const s = st.current;
    const page = TABS.find((p) => p.id === s.cur);
    // Try to stay on the current tab (unless the new context has a special tab).
    let bHandled = !!page && s.last !== 'Any' && hasContext(page, 'any');
    for (const p of TABS) {
      if ((!bHandled || !hasContext(p, 'any')) && hasContext(p, ctx)) { s.cur = p.id; bHandled = true; s.supported = true; }
      if (!bHandled && s.supported && hasContext(p, 'default')) s.cur = p.id;
    }
    s.last = ctx;
  }
  const visible = TABS.filter((p) => hasContext(p, ctx) || hasContext(p, 'any'));
  const tab = visible.find((p) => p.id === st.current.cur) ?? visible[0]!;
  const groups = tabGroups(tab);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useRef(() => setMenuOpen(false)).current;
  useDismiss(menuOpen, menuRef, closeMenu, c);
  // A tab with few commands names them beside their icons.
  const labeled = groups.reduce((n, g) => n + g.length, 0) < LABELED_MAX;

  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        <div className="ribbon-menu" ref={menuRef}>
          <button className="ribbon-menu-button" aria-label={t('ribbon.menu')} title={t('ribbon.menu')} aria-haspopup="menu" aria-expanded={menuOpen}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setMenuOpen(!menuOpen)}>{MENU_ICON}</button>
          {menuOpen && <MenuItems c={c} items={menubar} close={closeMenu} label={t('ribbon.menu')} />}
        </div>
        <div className="ribbon-shortcuts" role="toolbar" aria-label="Quick access">
          {SHORTCUTS.map((cmd) => <ToolButton key={cmd} c={c} cmd={cmd} />)}
        </div>
        <div role="tablist" aria-label={t('ribbon.tabs')} className="ribbon-tablist">
          {visible.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === tab.id} className={`ribbon-tab${p.id === tab.id ? ' on' : ''}${hasContext(p, 'any') ? '' : ' contextual'}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { st.current.cur = p.id; rerender((n) => n + 1); }}>{p.label}</button>
          ))}
        </div>
        <div className="ribbon-title"><DocTitle c={c} /></div>
      </div>
      {/* Commands that do not fit scroll sideways; so does the mouse wheel over them. */}
      <div className={`ribbon-bar${labeled ? ' labeled' : ''}`} role="toolbar" aria-label={tab.label}
        onWheel={(e) => { if (!e.deltaX && e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
        {groups.map((g, i) => (
          <div key={`${tab.id}:${i}`} className="ribbon-group" role="group">
            {g.map((cmd) => <Control key={cmd} c={c} cmd={cmd} labeled={labeled} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
