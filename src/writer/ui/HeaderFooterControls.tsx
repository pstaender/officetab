// The header and footer controls of the edit window (sw/source/uibase/docvw/HeaderFooterWin.cxx and
// FrameControlsManager.cxx, with SwPageFrame::PaintDecorators placing them): while a header (footer)
// is edited, or after a click in a page's header (footer) area, every page shows a dashed line at its
// body's top (bottom) and a button named after the page style. Without a header (footer) the button
// adds one; otherwise it opens hfmenubutton.ui's menu. DOM over the canvas, like the comments.
import { useEffect, useRef, useState } from 'react';
import { TWIPS_PER_CSS_PX } from '@lo/sw/source/core/view/paint.ts';
import { Point } from '@lo/tools/source/generic/gen.ts';
import { SwStartNodeType } from '@lo/sw/inc/ndtyp.ts';
import type { FrameControlType, SwPageFrame } from '@lo/sw/source/core/layout/pagechg.ts';
import type { Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { t } from '@shell/i18n.ts';

/** HeaderFooterWin.cxx's BOX_DISTANCE: the button's gap to the body's right edge, in pixels. */
const BOX_DISTANCE = 10;

/** SwHeaderFooterWin::SetOffset: "Header (%1)", or its first, left or right page variant. */
function Label(c: Controller, page: SwPageFrame, bHeader: boolean): string {
  const start = bHeader ? page.pHeader : page.pFooter;
  const style = page.pDesc.m_aName;
  const eTyp = bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode;
  // !IsHeaderShared: the style has its own left page variant, so the others are right pages.
  const bShared = !c.sh.m_pDoc.GetNodes().FindAreaSection(eTyp, 'left', style);
  const kind = start?.m_eAreaKind === 'first' ? 'first' : start?.m_eAreaKind === 'left' ? 'left' : start && !bShared ? 'right' : '';
  const key = kind ? `${kind}${bHeader ? 'Header' : 'Footer'}` : bHeader ? 'header' : 'footer';
  return t(`hf.title.${key}`, { style });
}

function Control({ c, page, bHeader, open, setOpen }: { c: Controller; page: SwPageFrame; bHeader: boolean; open: boolean; setOpen: (o: boolean) => void }) {
  const f = c.zoom / TWIPS_PER_CSS_PX;
  const style = page.pDesc.m_aName;
  // SwPageFrame::PaintDecorators: the body's top for the header, its bottom (below the footnotes) for the footer.
  const y = bHeader ? page.aPrt.Top() : Math.max(page.aPrt.Bottom(), page.aFootnote?.Bottom() ?? -Infinity);
  const bIsEmptyHeaderFooter = !(bHeader ? page.aHeader : page.aFooter);
  const label = Label(c, page, bHeader);
  // SwHeaderFooterWin::SetOffset: the box's right edge BOX_DISTANCE left of the body's; a header's
  // hangs below the line, a footer's sits on it.
  const x = (page.aPrt.Left() + page.aPrt.Width()) * f - BOX_DISTANCE;

  // SwHeaderFooterWin::ExecuteCommand.
  const execute = (rIdent: string) => {
    setOpen(false);
    switch (rIdent) {
      case 'edit': c.dialogPageStyle = style; c.setDialog(bHeader ? 'pageheader' : 'pagefooter'); break;
      case 'borderback': c.dialogPageStyle = style; c.setDialog(bHeader ? 'hfborder-header' : 'hfborder-footer'); break;
      case 'delete': void c.changeHeaderOrFooter(bHeader, false, style); break;
      case 'insert_pagenumber': dispatch(c, '.uno:InsertPageNumberField'); c.focusEditor(); break;
      case 'insert_pagecount': dispatch(c, '.uno:InsertPageCountField'); c.focusEditor(); break;
      case 'insert_pagecount_in_range': dispatch(c, '.uno:InsertPageCountInRangeField'); c.focusEditor(); break;
    }
  };
  // SwHeaderFooterWin::ClickHdl: the header or footer on, the cursor into it on this page.
  const add = () => {
    const sh = c.sh;
    sh.ChangeHeaderOrFooter(bHeader, true, false, style);
    const p = sh.m_pRoot.pages[page.nIndex];
    const r = bHeader ? p?.aHeader : p?.aFooter;
    if (r) sh.SetCursor(new Point(r.Left() + 1, r.Top() + 1));
    else sh.SetCursorInHdFt(style, bHeader, false);
    c.notify();
    c.focusEditor();
  };
  const items: [string, string][] = [
    ['edit', t(bHeader ? 'hf.formatHeader' : 'hf.formatFooter')],
    ['borderback', t('hf.borderback')],
    ['delete', t(bHeader ? 'hf.deleteHeader' : 'hf.deleteFooter')],
    ['insert_pagenumber', t('hf.insertPageNumber')],
    ['insert_pagecount', t('hf.insertPageCount')],
    ['insert_pagecount_in_range', t('hf.insertPageCountInRange')],
  ];
  return (
    <>
      <div className="hf-line" aria-hidden="true" style={{ left: page.aFrame.Left() * f, width: page.aFrame.Width() * f, top: y * f }} />
      <div className={`hf-control ${bHeader ? 'header' : 'footer'}`} style={{ left: x, top: y * f }}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
        {bIsEmptyHeaderFooter
          ? <button type="button" className="hf-button" aria-label={label} title={label} onClick={add}>{label}<span className="hf-sign" aria-hidden="true">+</span></button>
          : <button type="button" className="hf-button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>{label}<span className="hf-sign" aria-hidden="true">▾</span></button>}
        {open && !bIsEmptyHeaderFooter && (
          <ul className="menu-popup hf-menu" role="menu" aria-label={label}>
            {items.map(([id, text]) => (
              <li key={id} role="menuitem" tabIndex={-1} className="menu-item" onClick={() => execute(id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); execute(id); } }}>
                <span className="menu-check" />
                <span className="menu-label">{text}</span>
                <span className="menu-key" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function HeaderFooterControls({ c }: { c: Controller }) {
  const sh = c.sh, root = sh.m_pRoot;
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(null); c.focusEditor(); return; }
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('.hf-menu [role="menuitem"]') ?? [])];
      if (!items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open, c]);
  // SwPageFrame::PaintDecorators: not in Web view.
  if (root.m_pViewOpt.getBrowseMode()) return null;
  const types: FrameControlType[] = (['header', 'footer'] as const).filter((x) => sh.IsShowHeaderFooterSeparator(x));
  if (!types.length) return null;
  return (
    <div className="hf-controls" ref={ref}>
      {root.pages.map((page) => types.map((x) => {
        const id = `${page.nIndex}:${x}`;
        return <Control key={id} c={c} page={page} bHeader={x === 'header'} open={open === id} setOpen={(o) => setOpen(o ? id : null)} />;
      }))}
    </div>
  );
}
