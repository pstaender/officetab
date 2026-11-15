// ScTabControl (tabcont.cxx): the sheet tabs under the grid: a click shows a sheet (and, while a
// formula is edited, picks the sheet for a reference), Ctrl and Shift select several, a
// double-click renames, dragging moves (with Ctrl copies) a sheet, the context menu is the
// sheettab popup; the add button appends a sheet (ScTabControl's "+" button).
import { useRef, useState } from 'react';
import type { Controller } from '../controller.ts';
import { ContextMenu } from '@shell/ui/Bars.tsx';
import { t } from '@shell/i18n.ts';
import { isMac } from './labels.ts';
import { IsDark } from '@lo/sc/source/ui/view/output.ts';

export function SheetTabs({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument();
  const v = c.view.GetViewData();
  const cur = v.GetTabNo();
  const rMark = v.GetMarkData();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const names = rDoc.GetAllTableNames();

  /** ScTabControl::Select: shows the sheet; with Ctrl or Shift, adds it to the selected sheets. */
  const select = (n: number, e: React.MouseEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (c.edit && !c.isFormulaEdit()) c.commitEdit('none');
    if (mod) {
      if (n === cur) return;
      rMark.SelectTable(n, !rMark.GetTableSelect(n));
      c.notify();
      return;
    }
    if (e.shiftKey) {
      const a = Math.min(cur, n), b = Math.max(cur, n);
      for (let i = a; i <= b; i++) if (rDoc.IsVisible(i)) rMark.SelectTable(i, true);
      c.notify();
      return;
    }
    // a formula being edited keeps its input: the references point at the other sheet
    c.view.SetTabNo(n);
    if (c.edit) c.focusEditor();
  };

  return (
    <div className="sheet-tabs" role="tablist" aria-label={t('calc.sheets')}>
      <button className="sheet-add" title={t('calc.addSheet')} aria-label={t('calc.addSheet')} onMouseDown={(e) => e.preventDefault()}
        onClick={() => { c.view.InsertTable(rDoc.CreateValidTabName(`Sheet${rDoc.GetTableCount() + 1}`), rDoc.GetTableCount()); c.focusEditor(); }}>+</button>
      <div className="sheet-tab-list">
        {names.map((name, n) => {
          if (!rDoc.IsVisible(n)) return null;
          const color = rDoc.GetTabBgColor(n);
          const selected = n === cur || rMark.GetTableSelect(n);
          return (
            <button key={n} role="tab" aria-selected={n === cur} data-testid="sheet-tab"
              className={`sheet-tab${n === cur ? ' current' : ''}${selected ? ' selected' : ''}${dropAt === n ? ' drop' : ''}`}
              style={color ? { background: n === cur ? undefined : color, color: n === cur ? undefined : IsDark(color) ? '#fff' : '#000', borderBottomColor: color } : undefined}
              draggable
              onDragStart={(e) => { dragFrom.current = n; e.dataTransfer.effectAllowed = 'copyMove'; }}
              onDragOver={(e) => { if (dragFrom.current !== null) { e.preventDefault(); setDropAt(n); } }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropAt(null);
                const from = dragFrom.current;
                dragFrom.current = null;
                if (from === null) return;
                const copy = isMac ? e.altKey : e.ctrlKey;
                if (!copy && (from === n)) return;
                c.view.MoveTable(n > from && !copy ? n + 1 : n, copy, from);
              }}
              onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); select(n, e); } }}
              onDoubleClick={() => { if (!c.edit) c.setDialog('renamesheet'); }}
              onContextMenu={(e) => { e.preventDefault(); if (n !== cur && !rMark.GetTableSelect(n)) c.view.SetTabNo(n); setMenu({ x: e.clientX, y: e.clientY }); }}>
              {name}
            </button>
          );
        })}
      </div>
      {menu && <ContextMenu c={c} name="sheettab" x={menu.x} y={menu.y} close={() => { setMenu(null); c.focusEditor(); }} />}
    </div>
  );
}
