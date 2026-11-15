// The AutoFilter popup (ScCheckListMenuControl, sc/uiconfig/scalc/ui/filterdropdown.ui): sorting,
// the conditions (empty, not empty, top and bottom 10, standard filter), clearing the column's
// filter, and the check list of the column's entries with a search field and "All". The data
// and what the choices do are ScGridWindow's (src/lo/sc/source/ui/view/gridwin.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Controller } from '../controller.ts';
import { t } from '@shell/i18n.ts';
import { AutoFilterMode, UpdateAutoFilterFromMenu, type ScCheckListMember } from '@lo/sc/source/ui/view/gridwin.ts';
import './data.css';

export function AutoFilterPopup({ c }: { c: Controller }) {
  const af = c.autoFilter!;
  const [members, setMembers] = useState<ScCheckListMember[]>(() => af.data.maMembers.map((m) => ({ ...m })));
  const [search, setSearch] = useState('');
  const [sub, setSub] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => { c.autoFilter = null; c.notify(); c.focusEditor(); };
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    ref.current?.querySelector<HTMLElement>('.af-search')?.focus();
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); };
  }, []);

  const label = (m: ScCheckListMember) => (m.maName === '' ? t('calc.emptyEntry') : m.maName);
  const shown = useMemo(() => {
    const s = search.toLowerCase();
    return members.map((m, i) => ({ m, i })).filter(({ m }) => !s || label(m).toLowerCase().includes(s));
  }, [members, search]);
  const allChecked = shown.length > 0 && shown.every(({ m }) => m.mbVisible);
  const anyChecked = members.some((m) => m.mbVisible);

  const run = (eMode: AutoFilterMode) => {
    const r = UpdateAutoFilterFromMenu(c.view, af.data, eMode, members);
    c.autoFilter = null;
    if (r === 'custom') c.setDialog('standardfilter');
    c.notify();
    if (r !== 'custom') c.focusEditor();
  };
  const ok = () => {
    // with a search, only the shown entries stay checked (ScCheckListMenuControl's search)
    if (search) setMembers((ms) => ms);
    run(AutoFilterMode.Normal);
  };
  const toggle = (i: number) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, mbVisible: !m.mbVisible } : m)));
  const toggleAll = () => {
    const ids = new Set(shown.map(({ i }) => i));
    setMembers((ms) => ms.map((m, j) => (ids.has(j) ? { ...m, mbVisible: !allChecked } : m)));
  };
  const item = (text: string, eMode: AutoFilterMode, testid?: string) => (
    <li><button type="button" data-testid={testid} onClick={() => run(eMode)}>{text}</button></li>
  );

  return (
    <div ref={ref} className="autofilter" role="dialog" aria-label={t('calc.autoFilter')} data-testid="autofilter-popup" style={{ left: af.x, top: af.y, minWidth: Math.max(220, af.w) }}>
      <ul className="af-menu" role="menu">
        {item(t('calc.sortAscending'), AutoFilterMode.SortAscending, 'af-sort-asc')}
        {item(t('calc.sortDescending'), AutoFilterMode.SortDescending, 'af-sort-desc')}
        <hr />
        <li className="af-sub" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
          <button type="button" aria-haspopup="menu" aria-expanded={sub} onClick={() => setSub((b) => !b)}>{t('calc.filterByCondition')} ▸</button>
          {sub && (
            <ul className="af-menu af-submenu" role="menu">
              {item(t('calc.filterEmpty'), AutoFilterMode.Empty, 'af-empty')}
              {item(t('calc.filterNotEmpty'), AutoFilterMode.NonEmpty, 'af-notempty')}
              {item(t('calc.top10'), AutoFilterMode.Top10, 'af-top10')}
              {item(t('calc.bottom10'), AutoFilterMode.Bottom10, 'af-bottom10')}
              <hr />
              {item(t('calc.standardFilterEllipsis'), AutoFilterMode.Custom, 'af-standard')}
            </ul>
          )}
        </li>
        {af.data.mbHasFilter && item(t('calc.clearFilter'), AutoFilterMode.Clear, 'af-clear')}
      </ul>
      <input className="af-search" type="search" placeholder={t('calc.search')} aria-label={t('calc.search')} value={search} onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && anyChecked) { e.preventDefault(); ok(); } }} />
      <div className="af-list" role="group" aria-label={t('calc.autoFilterValues')}>
        <label><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="af-all" /> {t('calc.all')}</label>
        {shown.map(({ m, i }) => (
          <label key={i} className={m.mbHiddenByOtherFilter ? 'hidden' : undefined}>
            <input type="checkbox" checked={m.mbVisible} onChange={() => toggle(i)} /> {label(m)}
          </label>
        ))}
      </div>
      <div className="af-actions">
        <button type="button" className="primary" disabled={!anyChecked} onClick={ok} data-testid="af-ok">{t('common.ok')}</button>
        <button type="button" onClick={close}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
