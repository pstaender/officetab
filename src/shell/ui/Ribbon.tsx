// Menu > Ribbon, shared by the apps: the tabbed notebookbar of the app (its upstream-ui.json's
// notebookbar), with the quick access toolbox, the tabs and the context's tabs. The app draws its
// own controls and names its context through its registry's RibbonConfig.
import type { ReactNode, RefObject } from 'react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnyController as Controller } from '../appcontroller.ts';
import { t } from '../i18n.ts';
import { iconClass, iconUrl } from '../icons.ts';
import { DocTitle, MenuItems, ToolButton, isImplemented } from './Bars.tsx';
import type { RibbonTab } from './labels.ts';
import { appRegistry, dispatch, menuLabel, menubar, notebookbar, shortcutText, toolbars, type RibbonConfig } from './registry.ts';

const hasContext = (tab: RibbonTab, ctx: string) => tab.contexts.includes(ctx);

/** The search button's magnifier, drawn as the menu button's lines are. */
const SEARCH_ICON = <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12.3 12.3 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
const MENU_ICON = <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;

/** The ribbon's scroll arrows: a chevron to the left or right. */
const ARROW_ICON = (dir: 1 | -1) => <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d={dir > 0 ? 'M8 4l6 6-6 6' : 'M12 4l-6 6 6 6'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Below this many commands, a tab names them beside their icons. */
const LABELED_MAX = 20;

/** sfx2 NotebookBar's quick access toolbox (notebookbarshortcuts.xml); the menu button stands for .uno:Menubar. */
function shortcuts(): string[] {
  const SHORTCUTS = (toolbars().notebookbarshortcuts ?? []).flatMap((i) => (i.cmd && i.visible && i.cmd !== '.uno:Menubar' && isImplemented(i.cmd) ? [i.cmd] : []));
  // The web shell's addition: File > Download (.uno:SaveACopy) after Save.
  SHORTCUTS.splice(SHORTCUTS.indexOf('.uno:Save') + 1, 0, '.uno:SaveACopy');
  return SHORTCUTS;
}

/**
 * The web shell's New button before Open in the quick access toolbox (the File tab's New, which
 * the ribbon leaves out): it offers the app's entries (RibbonConfig.newEntries), as a new document
 * (.uno:AddDirect) or a new template.
 */
function NewButton({ c, entries }: { c: Controller; entries: { cmd: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(() => setOpen(false)).current;
  useDismiss(open, ref, close, c);
  // A plain document: New Document's icon has a plus, which would make the button look like it alone.
  const url = iconUrl('app:New');
  const item = (cmd: string, label: string) => (
    <li role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { close(); dispatch(c, cmd); c.focusEditor(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}>
      <span className="menu-check" />
      <span className="menu-label">{label}</span>
    </li>
  );
  return (
    <div className="ribbon-new" ref={ref}>
      <button className={`tool${open ? ' on' : ''}`} aria-label={t('ribbon.new')} title={t('ribbon.new')} aria-haspopup="menu" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {url ? <img src={url} className={iconClass('app:New')} alt="" draggable={false} /> : <span>{t('ribbon.new')}</span>}
      </button>
      {open && (
        <ul className="menu-popup" role="menu" aria-label={t('ribbon.new')}>
          {entries.map((e) => <Fragment key={e.cmd}>{item(e.cmd, e.label)}</Fragment>)}
        </ul>
      )}
    </div>
  );
}

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

/** A control of a command: the app's own, else a button. */
function Control({ c, cmd, labeled, cfg }: { c: Controller; cmd: string; labeled: boolean; cfg: RibbonConfig }): ReactNode {
  const own = cfg.control(c, cmd, labeled);
  return own === undefined ? <ToolButton c={c} cmd={cmd} labeled={labeled} /> : own;
}

/** The tabs of the app's notebookbar and their commands that work, once per app. */
const tabsOf = new WeakMap<RibbonConfig, { TABS: RibbonTab[]; tabGroups: (tab: RibbonTab) => string[][]; SHORTCUTS: string[] }>();
function ribbonTabs(cfg: RibbonConfig) {
  let r = tabsOf.get(cfg);
  if (r) return r;
  const shown = (cmd: string) => cfg.special.has(cmd) || isImplemented(cmd);
  const tabGroups = (tab: RibbonTab) => tab.groups.map((g) => g.filter(shown)).filter((g) => g.length);
  /**
   * Tabs without any working command (Form, Extension, Tools …) are left out, and so is File: its
   * commands are in the menu and the quick access toolbox (New, Open, Save, Download, Print), so
   * Home is the first tab.
   */
  const TABS = notebookbar().filter((tab) => tab.id !== 'File' && tabGroups(tab).length);
  r = { TABS, tabGroups, SHORTCUTS: shortcuts() };
  tabsOf.set(cfg, r);
  return r;
}

/**
 * Menu > Ribbon: the app's tabbed notebookbar (sfx2 NotebookBar with notebookbar.ui) as a single
 * row of commands per tab, as browser office suites show it. The menu button opens the classic
 * menus. The contextual tabs (Table, Image, Draw, Object) appear with their context, and
 * NotebookbarTabControlBase::SetContext chooses the tab. A tab with fewer than LABELED_MAX
 * commands shows their labels beside the icons (the notebookbar's "both-horiz" toolbar style).
 */
export function Ribbon({ c }: { c: Controller }) {
  const cfg = appRegistry().ribbon!;
  const { TABS, tabGroups, SHORTCUTS } = ribbonTabs(cfg);
  const ctx = cfg.context(c);
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

  // A fade at an edge where commands are scrolled out of sight. Written to the DOM through the
  // ref after every render, since the commands change with the tab and the selection.
  const bar = useRef<HTMLDivElement>(null);
  const updateFade = () => {
    const el = bar.current;
    if (!el) return;
    el.classList.toggle('fade-start', el.scrollLeft > 1);
    el.classList.toggle('fade-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  useLayoutEffect(updateFade);
  /**
   * The arrows' scrolling: the group cut off at that edge comes into view, to the edge's fade; a
   * group wider than the bar moves by most of the bar.
   */
  const scrollBy = (dir: 1 | -1) => {
    const el = bar.current;
    if (!el) return;
    const box = el.getBoundingClientRect(), fade = 48, step = el.clientWidth - 2 * fade;
    const groups = [...el.children].map((g) => g.getBoundingClientRect());
    let to: number;
    if (dir > 0) {
      const cut = groups.find((g) => g.right > box.right - fade + 1);
      to = cut && cut.left - box.left > fade ? cut.left - box.left - fade : step;
    } else {
      const cut = groups.findLast((g) => g.left < box.left + fade - 1);
      to = cut && box.right - cut.right > fade ? cut.right - box.right + fade : -step;
    }
    el.scrollBy({ left: to, behavior: 'smooth' });
  };
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        <div className="ribbon-menu" ref={menuRef}>
          <button className="ribbon-menu-button" aria-label={t('ribbon.menu')} title={t('ribbon.menu')} aria-haspopup="menu" aria-expanded={menuOpen}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setMenuOpen(!menuOpen)}>{MENU_ICON}</button>
          {menuOpen && <MenuItems c={c} items={menubar()} close={closeMenu} label={t('ribbon.menu')} />}
        </div>
        <div className="ribbon-shortcuts" role="toolbar" aria-label="Quick access">
          {SHORTCUTS.map((cmd) => cmd === cfg.newBefore
            ? <Fragment key={cmd}><NewButton c={c} entries={cfg.newEntries()} /><ToolButton c={c} cmd={cmd} /></Fragment>
            : <ToolButton key={cmd} c={c} cmd={cmd} />)}
        </div>
        <div role="tablist" aria-label={t('ribbon.tabs')} className="ribbon-tablist">
          {visible.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === tab.id} className={`ribbon-tab${p.id === tab.id ? ' on' : ''}${hasContext(p, 'any') ? '' : ' contextual'}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { st.current.cur = p.id; rerender((n) => n + 1); }}>{p.label}</button>
          ))}
        </div>
        <div className="ribbon-title"><DocTitle c={c} /></div>
        {/* The web shell's search button: Help > Search Commands, the quickest way to a command in the ribbon. */}
        <button className="ribbon-menu-button ribbon-search" aria-label={menuLabel('.uno:CommandPopup')} title={`${menuLabel('.uno:CommandPopup')} (${shortcutText('.uno:CommandPopup')})`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => dispatch(c, '.uno:CommandPopup')}>{SEARCH_ICON}</button>
      </div>
      {/* Commands that do not fit scroll sideways; so does the mouse wheel over them. */}
      <div className={`ribbon-bar${labeled ? ' labeled' : ''}`} role="toolbar" aria-label={tab.label}>
        {/* A new tab starts scrolled to its beginning. */}
        <div key={tab.id} ref={bar} className="ribbon-scroll" onScroll={updateFade}
          onWheel={(e) => { if (!e.deltaX && e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
          {groups.map((g, i) => (
            <div key={i} className="ribbon-group" role="group">
              {g.map((cmd) => <Control key={cmd} c={c} cmd={cmd} labeled={labeled} cfg={cfg} />)}
            </div>
          ))}
        </div>
        {/* Hidden from the keyboard and screen readers: the commands they reach scroll into view themselves. */}
        <button className="ribbon-arrow start" tabIndex={-1} aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => scrollBy(-1)}>{ARROW_ICON(-1)}</button>
        <button className="ribbon-arrow end" tabIndex={-1} aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => scrollBy(1)}>{ARROW_ICON(1)}</button>
      </div>
    </div>
  );
}
