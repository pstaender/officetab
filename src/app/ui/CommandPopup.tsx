// Help > Search Commands (sfx2's CommandListBox, commandpopup.ui): a search box over the menus. The
// entries found are the menus' enabled commands whose label contains the text (MenuContentHandler);
// Up and Down choose one, Enter or a click runs it. Each entry also shows the menu it is in, which
// in the ribbon is the quickest way to find it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuContentHandler, type CurrentEntry } from '@lo/sfx2/source/commandpopup/CommandPopup.ts';
import type { Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { iconClass, iconUrl } from '../icons.ts';
import { t, uiLanguage } from '../i18n.ts';
import { menuLabel, menubar, shortcutText, tooltip } from './labels.ts';
import { isEnabled, isImplemented } from './Bars.tsx';

export function CommandPopup({ c }: { c: Controller }) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  // MenuContentHandler gathers the menus once per popup; the state of commands is asked per search.
  const handler = useMemo(() => new MenuContentHandler(menubar, {
    GetLabelForCommand: menuLabel,
    GetTooltipForCommand: (cmd) => (cmd.startsWith('app:') ? menuLabel(cmd) : tooltip(cmd)),
    IsAvailable: (cmd) => isImplemented(cmd) && isEnabled(c, cmd) && cmd !== '.uno:CommandPopup',
    locale: uiLanguage(),
  }), [c]);
  const found = useMemo(() => {
    const list: CurrentEntry[] = [];
    if (text) handler.findInMenu(text, list);
    return list;
  }, [handler, text]);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const close = () => c.setDialog(null);
  /** dispatchCommandAndClose */
  const run = (e: CurrentEntry | undefined) => {
    close();
    if (e) dispatch(c, e.m_aCommandURL);
  };
  return (
    <dialog ref={ref} className="command-popup" aria-label={menuLabel('.uno:CommandPopup')} onClose={close}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <input type="search" role="combobox" aria-expanded={found.length > 0} aria-controls="command-list" aria-autocomplete="list"
        aria-activedescendant={found.length ? `command-${sel}` : undefined}
        placeholder={t('commandpopup.entry')} aria-label={t('commandpopup.entry')} value={text} autoFocus
        onChange={(e) => { setText(e.currentTarget.value); setSel(0); }}
        onKeyDown={(e) => {
          // TreeViewKeyPress
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((n) => Math.max(0, Math.min(found.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter') { e.preventDefault(); run(found[sel]); }
          // The popover closes at once, rather than the search box clearing first.
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }} />
      {text && (
        <ul ref={listRef} id="command-list" role="listbox" aria-label={t('commandpopup.results')}>
          {found.length === 0 && <li className="muted" role="presentation">{t('commandpopup.none')}</li>}
          {found.map((e, i) => {
            const url = iconUrl(e.m_aCommandURL);
            return (
              <li key={`${e.m_aMenuPath}|${e.m_aCommandURL}`} id={`command-${i}`} role="option" aria-selected={i === sel} title={e.m_aTooltip}
                onMouseMove={() => setSel(i)} onClick={() => run(e)}>
                <span className="cp-icon">{url && <img src={url} className={iconClass(e.m_aCommandURL)} alt="" draggable={false} />}</span>
                <span className="cp-label">{e.m_aMenuLabel}</span>
                <span className="cp-path">{e.m_aMenuPath}</span>
                <span className="cp-key">{shortcutText(e.m_aCommandURL)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </dialog>
  );
}
