// Canvas content is invisible to assistive technology. This mirror plays the part of upstream's
// accessibility layer (sc/source/ui/Accessibility): a live region announces the cell the cursor
// is on (its address, content and, with a formula, the formula) and the selection, and a hidden
// table holds the cells around the cursor for a screen reader to browse.
import { memo, useDeferredValue } from 'react';
import type { Controller } from '../controller.ts';
import { ScAddress, ScColToAlpha, ScRefFlags } from '@lo/sc/inc/address.ts';
import { t } from '@shell/i18n.ts';

const ROWS = 10, COLS = 6;

const Cells = memo(function Cells({ c }: { c: Controller; version: number }) {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const nTab = v.GetTabNo();
  const r0 = Math.max(0, v.GetCurY() - 2), c0 = Math.max(0, v.GetCurX() - 1);
  const rows = [];
  for (let r = r0; r < Math.min(rDoc.MaxRow() + 1, r0 + ROWS); r++) {
    const cells = [];
    for (let col = c0; col < Math.min(rDoc.MaxCol() + 1, c0 + COLS); col++) cells.push(<td key={col}>{rDoc.GetString(new ScAddress(col, r, nTab))}</td>);
    rows.push(<tr key={r}><th scope="row">{r + 1}</th>{cells}</tr>);
  }
  return (
    <table aria-label={rDoc.GetName(nTab)}>
      <thead><tr><td />{Array.from({ length: COLS }, (_, i) => <th key={i} scope="col">{ScColToAlpha(c0 + i)}</th>)}</tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
});

export function A11yMirror({ c, version }: { c: Controller; version: number }) {
  const deferred = useDeferredValue(version);
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const aPos = new ScAddress(v.GetCurX(), v.GetCurY(), v.GetTabNo());
  const value = rDoc.GetString(aPos);
  const formula = rDoc.GetFormulaCell(aPos) ? rDoc.GetFormula(aPos) : '';
  const { rRange } = v.GetSimpleArea();
  const sel = v.GetMarkData().IsMarked() && !rRange.aStart.equals(rRange.aEnd)
    ? t('calc.a11y.selection', { range: `${rRange.aStart.Format(ScRefFlags.VALID, rDoc)}:${rRange.aEnd.Format(ScRefFlags.VALID, rDoc)}` }) : '';
  const announce = c.edit ? t('calc.a11y.editing', { cell: new ScAddress(c.edit.nCol, c.edit.nRow, c.edit.nTab).Format(ScRefFlags.VALID, rDoc) })
    : `${aPos.Format(ScRefFlags.VALID, rDoc)}${value ? `, ${value}` : `, ${t('calc.a11y.empty')}`}${formula ? `, ${t('calc.a11y.formula', { formula })}` : ''}${sel ? `. ${sel}` : ''}`;
  return (
    <div className="sr-only" data-testid="a11y-mirror">
      <div role="status" aria-live="polite" data-testid="a11y-cell">{announce}</div>
      <Cells c={c} version={deferred} />
    </div>
  );
}
