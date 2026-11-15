// The Data menu's commands (ScCellShell::ExecuteDB and GetDBState, cellsh2.cxx): AutoFilter,
// the standard filter, removing and hiding filters, defining and selecting database ranges,
// subtotals and validity. Kept apart from commands.ts so the Data features stay together.
import type { CommandTable } from '@shell/commands.ts';
import { t } from '@shell/i18n.ts';
import type { Controller } from './controller.ts';
import { ScGetDBMode, ScGetDBSelection } from '@lo/sc/inc/global.ts';
import { ScDBDataPortion } from '@lo/sc/source/core/tool/dbdata.ts';
import { SCSIZE_MAX } from '@lo/sc/inc/address.ts';

const notEditing = (c: Controller) => !c.edit;
const cur = (c: Controller) => { const v = c.view.GetViewData(); return { nCol: v.GetCurX(), nRow: v.GetCurY(), nTab: v.GetTabNo() }; };
/** The database range at the cursor (GetDBAtCursor). */
const dbAtCursor = (c: Controller) => { const { nCol, nRow, nTab } = cur(c); return c.sh.GetDocument().GetDBAtCursor(nCol, nRow, nTab, ScDBDataPortion.AREA); };

/** After a database function: the message it left (ErrorMessage), and a repaint. */
function done(c: Controller): void {
  const e = c.sh.GetLastError();
  if (e) { c.setMessage(e); c.sh.ClearLastError(); }
  c.notify();
}

export const DATA_COMMANDS: CommandTable<Controller> = {
  // SID_AUTO_FILTER
  '.uno:DataFilterAutoFilter': {
    exec: (c) => {
      c.view.ToggleAutoFilter((fnDone) => {
        void c.queryYesNo(t('calc.autoFilter'), t('calc.autoFilterHeaderQuery')).then((b) => { fnDone(b); done(c); });
      });
      done(c);
    },
    checked: (c) => { const { nCol, nRow, nTab } = cur(c); return c.sh.GetDocument().HasAutoFilter(nCol, nRow, nTab); },
    enabled: notEditing,
  },
  // SID_FILTER: the standard filter on the database range of the selection
  '.uno:DataFilterStandardFilter': {
    exec: (c) => { if (c.view.GetDBData(true, ScGetDBMode.SC_DB_MAKE, ScGetDBSelection.RowDown)) c.setDialog('standardfilter'); },
    enabled: notEditing,
  },
  // SID_UNFILTER: all conditions of the database range at the cursor off
  '.uno:DataFilterRemoveFilter': {
    exec: (c) => {
      const pDBData = c.view.GetDBData(false, ScGetDBMode.SC_DB_OLD);
      if (!pDBData) return;
      const aParam = pDBData.GetQueryParam();
      const nEC = aParam.GetEntryCount();
      for (let i = 0; i < nEC; i++) aParam.GetEntry(i).bDoQuery = false;
      aParam.bDuplicate = true;
      c.view.Query(aParam, null, true);
      done(c);
    },
    enabled: (c) => notEditing(c) && !!dbAtCursor(c)?.HasQueryParam(),
  },
  // SID_AUTOFILTER_HIDE: the buttons go, the filter stays
  '.uno:DataFilterHideAutoFilter': {
    exec: (c) => { c.view.HideAutoFilter(); done(c); },
    enabled: (c) => notEditing(c) && !!dbAtCursor(c)?.HasAutoFilter(),
  },
  // SID_CLEAR_AUTO_FILTER: the filter of the cursor's column
  '.uno:ClearAutoFilter': {
    exec: (c) => { c.view.ClearAutoFilter(); done(c); },
    enabled: (c) => { const p = dbAtCursor(c); return notEditing(c) && !!p && p.GetQueryParam().FindAllEntriesByField(cur(c).nCol).length > 0; },
  },
  // SID_DEFINE_DBNAME, SID_SELECT_DB
  '.uno:DefineDBName': { exec: (c) => c.setDialog('definedb'), enabled: notEditing },
  '.uno:SelectDB': { exec: (c) => c.setDialog('selectdb'), enabled: (c) => notEditing(c) && !c.sh.GetDocument().GetDBCollection().getNamedDBs().empty() },
};

/** The status bar's "x of y records found" for the AutoFilter range at the cursor, when no range
    is selected (ScCellShell::GetState's SID_ROWCOL_SELCOUNT). */
export function GetFilterStatus(c: Controller): string | null {
  const v = c.view.GetViewData();
  const rMark = v.GetMarkData();
  if (rMark.IsMarked() || rMark.IsMultiMarked()) return null;
  const { nSelected, nTotal } = c.sh.GetDocument().GetFilterSelCount(v.GetCurX(), v.GetCurY(), v.GetTabNo());
  if (nTotal && nSelected !== SCSIZE_MAX) return t('calc.recordsFound', { n: nSelected, total: nTotal });
  return null;
}
