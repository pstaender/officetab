// View > Navigator (F5): sw's SwNavigationPI with its content tree (navigatorpanel.ui), beside the
// document. Navigate By chooses a content type (or Page), whose previous and next members the
// arrows go to; the tree lists every content type with its members, headings nested by level.
// Double-click or Enter goes to an entry; the heading the cursor is under is selected (outline
// tracking). For a selected heading, the buttons below promote, demote or move it with its
// sub-headings (Shift: without them).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CONTENT_TYPES, ContentTypeId, ExecCommand, GotoContent, MoveNavigation, SwContentType, type SwContent } from '@lo/sw/source/uibase/utlui/content.ts';
import type { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { Controller } from '../controller.ts';
import { t } from '../i18n.ts';

const MAXLEVEL = 10;
const LS_LEVEL = 'writer:navigator-level';
const LS_EXPANDED = 'writer:navigator-expanded';
/** SwContentTree's TimerUpdate: the content is gathered again this long after the last change. */
const UPDATE_MS = 400;
/** Navigate By's Page (NID_PGE), beside the content types. */
const PAGE = -1;

const typeName = (n: number) => t(`navigator.type.${n}`);
const load = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const store = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage may be unavailable */ } };

/** A row of the tree: a content type, or one of its members. */
interface Row { key: string; type: ContentTypeId; index: number; level: number; label: string; content?: SwContent; hasChildren: boolean; expanded: boolean; invisible: boolean }

/** Every content type with its members (SwContentTree::Display's m_aActiveContentArr). */
function gather(sh: SwWrtShell, nOutlineLevel: number): SwContentType[] {
  return CONTENT_TYPES.map((nType) => new SwContentType(sh, nType, nType === ContentTypeId.OUTLINE ? nOutlineLevel : MAXLEVEL));
}

const svg = (d: ReactNode) => <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const ICONS = {
  prev: svg(<path d="M5 12.5 10 7.5l5 5" />),
  next: svg(<path d="M5 7.5 10 12.5l5-5" />),
  root: svg(<><path d="M4 5h12M4 10h12M4 15h12" /><path d="M2 5h.01M2 10h.01M2 15h.01" strokeWidth="2.4" /></>),
  promote: svg(<path d="M12 5 7 10l5 5" />),
  demote: svg(<path d="M8 5l5 5-5 5" />),
  chapterup: svg(<><path d="M10 16V4M5.5 8.5 10 4l4.5 4.5" /></>),
  chapterdown: svg(<><path d="M10 4v12M5.5 11.5 10 16l4.5-4.5" /></>),
  close: svg(<path d="M6 6l8 8M14 6l-8 8" />),
};

export function Navigator({ c }: { c: Controller }) {
  const sh = c.sh;
  const [nOutlineLevel, setOutlineLevel] = useState(() => load(LS_LEVEL, MAXLEVEL));
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(load<number[]>(LS_EXPANDED, [ContentTypeId.OUTLINE])));
  /** Collapsed headings, by their paragraph. */
  const [collapsed, setCollapsed] = useState(() => new Set<object>());
  const [bIsRoot, setRoot] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [navType, setNavType] = useState<number>(PAGE);
  const [tick, setTick] = useState(0);
  const treeRef = useRef<HTMLUListElement>(null);
  const focused = useRef(false);

  // The content is gathered again a moment after the document changed, at once for another document.
  const edits = c.editCount;
  const shown = useRef(edits);
  useEffect(() => {
    if (shown.current === edits) return;
    const id = setTimeout(() => { shown.current = edits; setTick((n) => n + 1); }, UPDATE_MS);
    return () => clearTimeout(id);
  }, [edits]);
  const types = useMemo(() => gather(sh, nOutlineLevel), [sh, nOutlineLevel, tick]);

  // SwContentTree::UpdateTracking: the heading the cursor is under, unless the tree is in use.
  const nTrack = sh.GetOutlinePos();
  const outline = types[ContentTypeId.OUTLINE]!;
  const tracked = nTrack >= 0 ? outline.m_aMember.findIndex((m) => m.m_nOutlinePos === nTrack) : -1;
  // The deepest shown heading at or before the tracked one.
  const trackedKey = (() => {
    if (nTrack < 0) return null;
    let k = -1;
    outline.m_aMember.forEach((m, i) => { if (m.m_nOutlinePos! <= nTrack) k = i; });
    return k >= 0 ? `${ContentTypeId.OUTLINE}:${tracked >= 0 ? tracked : k}` : null;
  })();
  const current = focused.current || !trackedKey ? sel : trackedKey;

  const rootType = (() => {
    const k = current ?? sel;
    return k ? Number(k.split(':')[0]) as ContentTypeId : ContentTypeId.OUTLINE;
  })();

  // The rows shown: each content type (or in Content Navigation View only one) and its members.
  const rows: Row[] = [];
  for (const ct of types) {
    const nType = ct.m_nContentType;
    if (bIsRoot && nType !== rootType) continue;
    const isOpen = bIsRoot || expanded.has(nType);
    const base = bIsRoot ? 0 : 1;
    if (!bIsRoot) rows.push({ key: `t${nType}`, type: nType, index: -1, level: 0, label: typeName(nType), hasChildren: ct.GetMemberCount() > 0, expanded: isOpen && ct.GetMemberCount() > 0, invisible: ct.GetMemberCount() === 0 });
    if (!isOpen) continue;
    // Headings nest under the heading of a lower level before them; a collapsed one hides its sub-headings.
    const stack: { level: number; hidden: boolean }[] = [];
    ct.m_aMember.forEach((m, i) => {
      const nLevel = nType === ContentTypeId.OUTLINE ? m.m_nOutlineLevel! : nType === ContentTypeId.REGION ? m.m_nRegionLevel! : 0;
      while (stack.length && stack[stack.length - 1]!.level >= nLevel) stack.pop();
      const hidden = stack.some((s) => s.hidden);
      const next = ct.m_aMember[i + 1];
      const nextLevel = next ? (nType === ContentTypeId.OUTLINE ? next.m_nOutlineLevel! : nType === ContentTypeId.REGION ? next.m_nRegionLevel! : 0) : -1;
      const hasChildren = nextLevel > nLevel;
      const isCollapsed = hasChildren && !!m.m_pNode && collapsed.has(m.m_pNode);
      stack.push({ level: nLevel, hidden: hidden || isCollapsed });
      if (hidden) return;
      rows.push({ key: `${nType}:${i}`, type: nType, index: i, level: base + stack.length - 1, label: m.m_sContentName || ' ', content: m, hasChildren, expanded: hasChildren && !isCollapsed, invisible: m.m_bInvisible });
    });
  }

  const selRow = rows.find((r) => r.key === current) ?? null;
  const selHeading = selRow?.content && selRow.type === ContentTypeId.OUTLINE ? selRow.content : null;

  useEffect(() => {
    if (!current) return;
    treeRef.current?.querySelector(`[data-key="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const toggleType = (nType: number, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(nType); else next.delete(nType);
    setExpanded(next);
    store(LS_EXPANDED, [...next]);
  };
  const toggleRow = (r: Row, open = !r.expanded) => {
    if (r.index < 0) { toggleType(r.type, open); return; }
    if (!r.hasChildren || !r.content?.m_pNode) return;
    const next = new Set(collapsed);
    if (open) next.delete(r.content.m_pNode); else next.add(r.content.m_pNode);
    setCollapsed(next);
  };
  const select = (r: Row) => {
    setSel(r.key);
    // SelectHdl: the content type is chosen in Navigate By.
    setNavType(r.type);
  };

  /** ContentDoubleClickHdl: to the entry, the document focused. */
  const go = (r: Row) => {
    if (!r.content || r.invisible) { if (r.hasChildren) toggleRow(r); return; }
    if (GotoContent(sh, r.content, r.type)) {
      c.onEdit();
      c.notify();
      c.focusEditor();
    }
  };

  /** The heading commands, the heading staying selected where it went. */
  const exec = (rCmd: string, bWithChildren: boolean) => {
    if (!selHeading?.m_pNode) return;
    const node = selHeading.m_pNode;
    if (!ExecCommand(sh, rCmd, selHeading.m_nOutlinePos!, bWithChildren)) return;
    const fresh = gather(sh, nOutlineLevel);
    const k = fresh[ContentTypeId.OUTLINE]!.m_aMember.findIndex((m) => m.m_pNode === node);
    shown.current = c.editCount;
    setTick((n) => n + 1);
    if (k >= 0) setSel(`${ContentTypeId.OUTLINE}:${k}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = rows.findIndex((r) => r.key === current);
    const r = rows[i];
    const move = (j: number) => { const to = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (to) select(to); };
    switch (e.key) {
      case 'ArrowDown': move(i + 1); break;
      case 'ArrowUp': move(i < 0 ? 0 : i - 1); break;
      case 'Home': move(0); break;
      case 'End': move(rows.length - 1); break;
      case 'ArrowRight': if (r?.hasChildren && !r.expanded) toggleRow(r, true); else move(i + 1); break;
      case 'ArrowLeft': {
        if (r?.hasChildren && r.expanded) { toggleRow(r, false); break; }
        // To the parent.
        for (let j = i - 1; j >= 0; j--) if (rows[j]!.level < (r?.level ?? 0)) { select(rows[j]!); break; }
        break;
      }
      case 'Enter': case ' ': if (r) go(r); break;
      default:
        // KeyInputHdl: Ctrl with the arrows promotes, demotes and moves headings.
        if ((e.ctrlKey || e.metaKey) && selHeading && e.key.startsWith('Arrow')) {
          exec({ ArrowLeft: 'promote', ArrowRight: 'demote', ArrowUp: 'chapterup', ArrowDown: 'chapterdown' }[e.key]!, !e.shiftKey);
          break;
        }
        return;
    }
    e.preventDefault();
  };

  const nav = (bNext: boolean) => {
    if (navType === PAGE) {
      const n = sh.GetPageNumber() + (bNext ? 1 : -1);
      if (n >= 1 && n <= sh.GetPageCnt()) sh.GotoPage(n);
    } else {
      const r = MoveNavigation(sh, navType as ContentTypeId, bNext);
      if (r.wrapped) c.setMessage(t(bNext ? 'navigator.endWrapped' : 'navigator.startWrapped'), [], 3000);
    }
    c.onEdit();
    c.notify();
  };

  const nPages = sh.GetPageCnt();
  return (
    <aside className="navigator" aria-label={t('navigator.title')}>
      <header>
        <h2>{t('navigator.title')}</h2>
        <button type="button" className="nav-icon" title={t('navigator.close')} aria-label={t('navigator.close')} onClick={() => c.toggleNavigator(false)}>{ICONS.close}</button>
      </header>
      <div className="nav-row">
        <select aria-label={t('navigator.navigateBy')} title={t('navigator.navigateBy')} value={navType} onChange={(e) => setNavType(Number(e.currentTarget.value))}>
          <option value={PAGE}>{t('navigator.page')}</option>
          {types.filter((ct) => ct.m_nContentType !== ContentTypeId.REFERENCE).map((ct) => <option key={ct.m_nContentType} value={ct.m_nContentType}>{typeName(ct.m_nContentType)}</option>)}
        </select>
        <button type="button" className="nav-icon" title={t('navigator.previous')} aria-label={t('navigator.previous')} onClick={() => nav(false)}>{ICONS.prev}</button>
        <button type="button" className="nav-icon" title={t('navigator.next')} aria-label={t('navigator.next')} onClick={() => nav(true)}>{ICONS.next}</button>
        {navType === PAGE && (
          // GotoPageSpinButtonValueChangedHdl
          <input type="number" className="nav-page" min={1} max={nPages} aria-label={t('navigator.gotoPage')} title={t('navigator.gotoPage')}
            key={`${sh.GetPageNumber()}/${nPages}`} defaultValue={sh.GetPageNumber()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const n = Math.max(1, Math.min(nPages, parseInt(e.currentTarget.value, 10) || 1));
              sh.GotoPage(n);
              c.onEdit();
              c.notify();
            }} />
        )}
      </div>
      <div className="nav-row" role="toolbar" aria-label={t('navigator.title')}>
        <button type="button" className="nav-icon" aria-pressed={bIsRoot} title={t('navigator.root')} aria-label={t('navigator.root')} onClick={() => setRoot(!bIsRoot)}>{ICONS.root}</button>
        <select className="nav-level" title={t('navigator.levels')} aria-label={t('navigator.levels')} value={nOutlineLevel} onChange={(e) => { const n = Number(e.currentTarget.value); setOutlineLevel(n); store(LS_LEVEL, n); }}>
            {Array.from({ length: MAXLEVEL }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        <span className="nav-sep" />
        {(['promote', 'demote', 'chapterup', 'chapterdown'] as const).map((cmd) => (
          <button key={cmd} type="button" className="nav-icon" title={t(`navigator.${cmd}`)} aria-label={t(`navigator.${cmd}`)}
            disabled={!selHeading || ((cmd === 'chapterup' || cmd === 'chapterdown') && !selHeading.m_bIsMoveable)}
            onMouseDown={(e) => e.preventDefault()} onClick={(e) => exec(cmd, !e.shiftKey)}>{ICONS[cmd]}</button>
        ))}
      </div>
      <ul ref={treeRef} className="nav-tree" role="tree" aria-label={t('navigator.content')} tabIndex={0}
        aria-activedescendant={selRow ? `nav-${selRow.key}` : undefined}
        onFocus={() => { focused.current = true; if (!sel && current) setSel(current); }}
        onBlur={() => { focused.current = false; }}
        onKeyDown={onKeyDown}>
        {rows.map((r) => (
          <li key={r.key} id={`nav-${r.key}`} data-key={r.key} role="treeitem" aria-level={r.level + 1} aria-selected={r.key === current}
            aria-expanded={r.hasChildren ? r.expanded : undefined} aria-disabled={r.invisible || undefined}
            className={`${r.index < 0 ? 'nav-type' : 'nav-entry'}${r.invisible ? ' invisible' : ''}`} style={{ paddingInlineStart: `${4 + r.level * 14}px` }}
            title={r.content?.m_sURL ?? r.label}
            onMouseDown={(e) => { e.preventDefault(); treeRef.current?.focus(); focused.current = true; select(r); }}
            onDoubleClick={() => go(r)}>
            <span className="nav-twisty" aria-hidden="true" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); if (r.hasChildren) toggleRow(r); }}>
              {r.hasChildren ? (r.expanded ? '▾' : '▸') : ''}
            </span>
            <span className="nav-label">{r.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
